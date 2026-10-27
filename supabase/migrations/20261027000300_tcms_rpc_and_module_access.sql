-- TCMS Education integration boundary. Apply after migrations 001 and 002.
-- Existing records are retained. This intentionally removes direct client table access.
begin;

create table public.education_roles (
  code text primary key,
  label text not null
);
insert into public.education_roles values
  ('administrator', 'Education administrator'), ('teacher', 'Teacher'), ('staff', 'Education staff');

create table public.education_user_roles (
  auth_user_id uuid not null references auth.users(id) on delete restrict,
  role text not null references public.education_roles(code) on delete restrict,
  primary key (auth_user_id, role)
);

create table public.education_role_audit (
  id uuid primary key default gen_random_uuid(),
  target_auth_user_id uuid not null references auth.users(id) on delete restrict,
  role text not null references public.education_roles(code) on delete restrict,
  action text not null check (action in ('grant', 'revoke', 'import')),
  actor_auth_user_id uuid references auth.users(id) on delete restrict,
  occurred_at timestamptz not null default now(),
  source text not null check (source in ('administrator', 'trusted_database', 'migration'))
);
create index education_role_audit_time_idx on public.education_role_audit(occurred_at, id);

-- Import existing approvals, not every existing employee. No implicit staff grants.
insert into public.education_user_roles (auth_user_id, role)
select e.auth_user_id, r.role from public.education_staff_roles r
join public.education_employees e on e.id = r.employee_id;
insert into public.education_role_audit (target_auth_user_id, role, action, source)
select auth_user_id, role, 'import', 'migration' from public.education_user_roles;

alter table public.education_roles enable row level security;
alter table public.education_user_roles enable row level security;
alter table public.education_role_audit enable row level security;
revoke all on public.education_roles, public.education_user_roles, public.education_role_audit
  from public, anon, authenticated;
grant select on public.education_roles, public.education_role_audit to service_role;
grant select, insert, update, delete on public.education_user_roles to service_role;

create or replace function education_private.has_role(required_role text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.education_user_roles
    where auth_user_id = (select auth.uid()) and role = required_role);
$$;

create function education_private.require_access()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.education_user_roles where auth_user_id = auth.uid()
  ) then
    raise exception 'Education access has not been approved.' using errcode = '42501';
  end if;
end;
$$;

create function education_private.audit_role_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('DELETE', 'UPDATE') then
    insert into public.education_role_audit(target_auth_user_id, role, action, actor_auth_user_id, source)
    values (old.auth_user_id, old.role, 'revoke', auth.uid(),
      case when auth.uid() is null then 'trusted_database' else 'administrator' end);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    insert into public.education_role_audit(target_auth_user_id, role, action, actor_auth_user_id, source)
    values (new.auth_user_id, new.role, 'grant', auth.uid(),
      case when auth.uid() is null then 'trusted_database' else 'administrator' end);
  end if;
  return null;
end;
$$;
create trigger education_role_change_audit after insert or update or delete
on public.education_user_roles for each row execute function education_private.audit_role_change();

-- Serialize role changes and prevent accidental removal of the last administrator.
create function education_private.guard_role_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(20261027, 2);
  if tg_op in ('DELETE', 'UPDATE') then
    if old.role = 'administrator' and
      (tg_op = 'DELETE' or new.role <> old.role or new.auth_user_id <> old.auth_user_id) and
      (select count(*) from public.education_user_roles where role = 'administrator') <= 1 then
      raise exception 'The last Education administrator cannot be removed.' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
create trigger education_role_change_guard before insert or update or delete
on public.education_user_roles for each row execute function education_private.guard_role_change();

create function public.education_get_access()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare approved boolean; profile jsonb; roles jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in is required.' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(role order by role), '[]'::jsonb) into roles
    from public.education_user_roles where auth_user_id = auth.uid();
  approved := jsonb_array_length(roles) > 0;
  if approved then
    select jsonb_build_object('id', id, 'display_name', display_name) into profile
      from public.education_employees where auth_user_id = auth.uid();
  end if;
  return jsonb_build_object('allowed', approved, 'employee', profile, 'roles', roles);
end;
$$;

create function public.education_list_records(p_resource text, p_offset integer default 0, p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb; admin boolean; teacher boolean; employee uuid;
begin
  perform education_private.require_access();
  if p_offset is null or p_offset < 0 or p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'Invalid page range.' using errcode = '22023';
  end if;
  admin := education_private.has_role('administrator');
  teacher := education_private.has_role('teacher');
  employee := education_private.employee_id();
  case p_resource
  when 'employees' then
    select jsonb_agg(to_jsonb(r)) into result from (
      select e.id, e.display_name,
        case when admin then e.auth_user_id else null end as auth_user_id,
        exists(select 1 from public.education_user_roles u where u.auth_user_id=e.auth_user_id and u.role='teacher') as is_teacher
      from public.education_employees e where admin or teacher or e.id = employee
      order by e.display_name, e.id limit p_limit offset p_offset
    ) r;
  when 'students' then
    if not (admin or teacher) then raise exception 'Student access denied.' using errcode='42501'; end if;
    select jsonb_agg(to_jsonb(r)) into result from (
      select id, student_number, display_name from public.education_students
      order by student_number, id limit p_limit offset p_offset
    ) r;
  when 'sessions' then
    if not (admin or teacher) then raise exception 'Session access denied.' using errcode='42501'; end if;
    select jsonb_agg(to_jsonb(r)) into result from (
      select id, title, session_date, teacher_id from public.education_sessions
      where admin or teacher_id = employee order by session_date, id limit p_limit offset p_offset
    ) r;
  when 'student_attendance' then
    if not (admin or teacher) then raise exception 'Student attendance access denied.' using errcode='42501'; end if;
    select jsonb_agg(to_jsonb(r)) into result from (
      select a.id, a.session_id, a.student_id, a.status from public.education_student_attendance a
      where admin or education_private.teaches_session(a.session_id)
      order by a.id limit p_limit offset p_offset
    ) r;
  when 'staff_attendance' then
    select jsonb_agg(to_jsonb(r)) into result from (
      select id, employee_id, attendance_date, status from public.education_staff_attendance
      where admin or employee_id = employee order by attendance_date, id limit p_limit offset p_offset
    ) r;
  when 'roles' then
    if not admin then raise exception 'Administrator role required.' using errcode='42501'; end if;
    select jsonb_agg(to_jsonb(r)) into result from (
      select code, label from public.education_roles order by code limit p_limit offset p_offset
    ) r;
  when 'user_roles' then
    if not admin then raise exception 'Administrator role required.' using errcode='42501'; end if;
    select jsonb_agg(to_jsonb(r)) into result from (
      select u.auth_user_id, u.role, e.display_name from public.education_user_roles u
      left join public.education_employees e on e.auth_user_id=u.auth_user_id
      order by u.auth_user_id, u.role limit p_limit offset p_offset
    ) r;
  when 'role_audit' then
    if not admin then raise exception 'Administrator role required.' using errcode='42501'; end if;
    select jsonb_agg(to_jsonb(r)) into result from (
      select id, target_auth_user_id, role, action, actor_auth_user_id, occurred_at, source
      from public.education_role_audit order by occurred_at desc, id limit p_limit offset p_offset
    ) r;
  else raise exception 'Unknown Education resource.' using errcode='22023';
  end case;
  return coalesce(result, '[]'::jsonb);
end;
$$;

create function public.education_save_student(p_id uuid, p_student_number text, p_display_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved public.education_students;
begin
  perform education_private.require_access();
  if not (education_private.has_role('administrator') or education_private.has_role('teacher')) then
    raise exception 'Student management denied.' using errcode='42501';
  end if;
  if p_id is null then
    insert into public.education_students(student_number, display_name)
    values (btrim(p_student_number), btrim(p_display_name)) returning * into saved;
  else
    update public.education_students set student_number=btrim(p_student_number), display_name=btrim(p_display_name)
    where id=p_id returning * into saved;
    if not found then raise exception 'Student not found.' using errcode='P0002'; end if;
  end if;
  return jsonb_build_array(jsonb_build_object('id',saved.id,'student_number',saved.student_number,'display_name',saved.display_name));
end;
$$;

create function public.education_save_session(p_title text, p_session_date date, p_teacher_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved public.education_sessions;
begin
  perform education_private.require_access();
  if not (education_private.has_role('administrator') or
    (education_private.has_role('teacher') and p_teacher_id=education_private.employee_id())) then
    raise exception 'Session management denied.' using errcode='42501';
  end if;
  if not exists (select 1 from public.education_employees e join public.education_user_roles u
    on u.auth_user_id=e.auth_user_id where e.id=p_teacher_id and u.role='teacher') then
    raise exception 'Assign a staff member with the teacher role.' using errcode='23514';
  end if;
  insert into public.education_sessions(title,session_date,teacher_id)
  values (btrim(p_title),p_session_date,p_teacher_id) returning * into saved;
  return jsonb_build_array(jsonb_build_object('id',saved.id,'title',saved.title,'session_date',saved.session_date,'teacher_id',saved.teacher_id));
end;
$$;

create function public.education_save_student_attendance(p_id uuid, p_session_id uuid, p_student_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved public.education_student_attendance; old_session uuid;
begin
  perform education_private.require_access();
  if not education_private.teaches_session(p_session_id) then
    raise exception 'Only the assigned teacher may record student attendance.' using errcode='42501';
  end if;
  if p_id is null then
    insert into public.education_student_attendance(session_id,student_id,status,recorded_by)
    values (p_session_id,p_student_id,p_status,education_private.employee_id()) returning * into saved;
  else
    select session_id into old_session from public.education_student_attendance where id=p_id for update;
    if not found or not education_private.teaches_session(old_session) then
      raise exception 'Attendance correction denied.' using errcode='42501';
    end if;
    update public.education_student_attendance set session_id=p_session_id,student_id=p_student_id,
      status=p_status,recorded_by=education_private.employee_id() where id=p_id returning * into saved;
  end if;
  return jsonb_build_array(jsonb_build_object('id',saved.id,'session_id',saved.session_id,'student_id',saved.student_id,'status',saved.status));
end;
$$;

create function public.education_save_staff_attendance(p_id uuid, p_employee_id uuid, p_attendance_date date, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved public.education_staff_attendance;
begin
  perform education_private.require_access();
  if not education_private.has_role('administrator') then
    raise exception 'Only administrators may record staff attendance.' using errcode='42501';
  end if;
  if p_id is null then
    insert into public.education_staff_attendance(employee_id,attendance_date,status,recorded_by)
    values (p_employee_id,p_attendance_date,p_status,education_private.employee_id()) returning * into saved;
  else
    update public.education_staff_attendance set employee_id=p_employee_id,attendance_date=p_attendance_date,
      status=p_status,recorded_by=education_private.employee_id() where id=p_id returning * into saved;
    if not found then raise exception 'Attendance not found.' using errcode='P0002'; end if;
  end if;
  return jsonb_build_array(jsonb_build_object('id',saved.id,'employee_id',saved.employee_id,'attendance_date',saved.attendance_date,'status',saved.status));
end;
$$;

create function public.education_assign_role(p_target_auth_user_id uuid, p_role text, p_grant boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  -- Check permissions after locking so concurrent revocation cannot leave stale approval.
  perform pg_catalog.pg_advisory_xact_lock(20261027, 2);
  if not education_private.has_role('administrator') then
    raise exception 'Only Education administrators may assign roles.' using errcode='42501';
  end if;
  if p_target_auth_user_id is null or p_role is null or p_grant is null or
    not exists(select 1 from public.education_roles where code=p_role) then
    raise exception 'A valid user, role, and grant/revoke action are required.' using errcode='22023';
  end if;
  if p_grant then
    -- Compatibility bridge only. Portal remains responsible for real personal data.
    -- Never creates an Auth account or trusts client-supplied identity metadata.
    insert into public.education_employees(auth_user_id,display_name)
      values(p_target_auth_user_id,'Education staff') on conflict(auth_user_id) do nothing;
    insert into public.education_user_roles(auth_user_id,role)
      values(p_target_auth_user_id,p_role) on conflict do nothing;
  else
    delete from public.education_user_roles where auth_user_id=p_target_auth_user_id and role=p_role;
  end if;
  get diagnostics changed = row_count;
  return jsonb_build_object('changed',changed > 0,'auth_user_id',p_target_auth_user_id,'role',p_role,'granted',p_grant);
end;
$$;

-- Every exposed RPC is authenticated and checks module/operation authorization.
revoke all on function public.education_get_access() from public, anon;
revoke all on function public.education_list_records(text,integer,integer) from public, anon;
revoke all on function public.education_save_student(uuid,text,text) from public, anon;
revoke all on function public.education_save_session(text,date,uuid) from public, anon;
revoke all on function public.education_save_student_attendance(uuid,uuid,uuid,text) from public, anon;
revoke all on function public.education_save_staff_attendance(uuid,uuid,date,text) from public, anon;
revoke all on function public.education_assign_role(uuid,text,boolean) from public, anon;
grant execute on function public.education_get_access(),
  public.education_list_records(text,integer,integer),
  public.education_save_student(uuid,text,text), public.education_save_session(text,date,uuid),
  public.education_save_student_attendance(uuid,uuid,uuid,text),
  public.education_save_staff_attendance(uuid,uuid,date,text),
  public.education_assign_role(uuid,text,boolean) to authenticated;

revoke all on public.education_employees, public.education_staff_roles,
  public.education_students, public.education_sessions,
  public.education_student_attendance, public.education_staff_attendance
  from public, anon, authenticated;
-- Helpers are implementation details, not alternative API entry points.
revoke all on all functions in schema education_private from public, anon, authenticated;
revoke all on schema education_private from public, anon, authenticated;

comment on table public.education_staff_roles is 'Legacy role mapping, retained for migration reference only. Use education_user_roles and education_assign_role.';
comment on table public.education_employees is 'Legacy Education identity bridge. Existing names retained; newly approved users receive a placeholder. Portal is the canonical owner of personal information.';
commit;
