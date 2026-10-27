-- Requires 20261027000100. Run once; existing demo tables are untouched.
begin;

create schema education_private;
revoke all on schema education_private from public;
grant usage on schema education_private to authenticated, service_role;

create table public.education_staff_roles (
  employee_id uuid not null references public.education_employees(id) on delete restrict,
  role text not null check (role in ('administrator', 'teacher')),
  primary key (employee_id, role)
);
alter table public.education_staff_roles enable row level security;
revoke all on public.education_staff_roles from public, anon, authenticated;
grant select on public.education_staff_roles to authenticated;
grant all on public.education_staff_roles to service_role;

-- Roles are provisioned only by trusted database administration, never by the client.
create function education_private.has_role(required_role text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.education_staff_roles r
    join public.education_employees e on e.id = r.employee_id
    where e.auth_user_id = (select auth.uid()) and r.role = required_role
  );
$$;
revoke all on function education_private.has_role(text) from public;
grant execute on function education_private.has_role(text) to authenticated;

create function education_private.employee_id()
returns uuid language sql stable security definer set search_path = ''
as $$
  select id from public.education_employees where auth_user_id = (select auth.uid());
$$;
revoke all on function education_private.employee_id() from public;
grant execute on function education_private.employee_id() to authenticated, service_role;

create policy education_roles_read on public.education_staff_roles
for select to authenticated using (
  employee_id = education_private.employee_id()
  or education_private.has_role('administrator')
);

-- Administrators need staff lists to record attendance. Teachers see names for classes.
create policy education_staff_directory on public.education_employees
for select to authenticated using (
  education_private.has_role('administrator') or education_private.has_role('teacher')
);

create table public.education_students (
  id uuid primary key default gen_random_uuid(),
  student_number text not null unique check (char_length(btrim(student_number)) between 1 and 60),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  created_at timestamptz not null default now()
);

create table public.education_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  session_date date not null,
  teacher_id uuid not null references public.education_employees(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index education_sessions_teacher_idx on public.education_sessions(teacher_id);

create table public.education_student_attendance (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.education_sessions(id) on delete restrict,
  student_id uuid not null references public.education_students(id) on delete restrict,
  status text not null check (status in ('Present', 'Absent', 'Late')),
  recorded_by uuid not null default education_private.employee_id()
    references public.education_employees(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (session_id, student_id)
);
create index education_student_attendance_student_idx on public.education_student_attendance(student_id);

create table public.education_staff_attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.education_employees(id) on delete restrict,
  attendance_date date not null,
  status text not null check (status in ('Present', 'Absent', 'Late')),
  recorded_by uuid not null default education_private.employee_id()
    references public.education_employees(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (employee_id, attendance_date)
);

alter table public.education_students enable row level security;
alter table public.education_sessions enable row level security;
alter table public.education_student_attendance enable row level security;
alter table public.education_staff_attendance enable row level security;
revoke all on public.education_students, public.education_sessions,
  public.education_student_attendance, public.education_staff_attendance
  from public, anon, authenticated;
grant all on public.education_students, public.education_sessions,
  public.education_student_attendance, public.education_staff_attendance to service_role;
grant select, insert, update, delete on public.education_students to authenticated;
grant select, insert, update on public.education_sessions,
  public.education_student_attendance, public.education_staff_attendance to authenticated;

create policy education_students_manage on public.education_students
for all to authenticated
using (education_private.has_role('administrator') or education_private.has_role('teacher'))
with check (education_private.has_role('administrator') or education_private.has_role('teacher'));

create policy education_sessions_read on public.education_sessions
for select to authenticated using (
  education_private.has_role('administrator')
  or (education_private.has_role('teacher') and teacher_id = education_private.employee_id())
);
create policy education_sessions_insert on public.education_sessions
for insert to authenticated with check (
  education_private.has_role('administrator')
  or (education_private.has_role('teacher') and teacher_id = education_private.employee_id())
);
create policy education_sessions_update on public.education_sessions
for update to authenticated
using (education_private.has_role('administrator') or
  (education_private.has_role('teacher') and teacher_id = education_private.employee_id()))
with check (education_private.has_role('administrator') or
  (education_private.has_role('teacher') and teacher_id = education_private.employee_id()));

create function education_private.teaches_session(target_session uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select education_private.has_role('teacher') and exists (
    select 1 from public.education_sessions
    where id = target_session and teacher_id = education_private.employee_id()
  );
$$;
revoke all on function education_private.teaches_session(uuid) from public;
grant execute on function education_private.teaches_session(uuid) to authenticated;

create policy education_student_attendance_read on public.education_student_attendance
for select to authenticated using (
  education_private.has_role('administrator') or education_private.teaches_session(session_id)
);
create policy education_student_attendance_insert on public.education_student_attendance
for insert to authenticated with check (
  education_private.teaches_session(session_id)
  and recorded_by = education_private.employee_id()
);
create policy education_student_attendance_update on public.education_student_attendance
for update to authenticated
using (education_private.teaches_session(session_id))
with check (education_private.teaches_session(session_id)
  and recorded_by = education_private.employee_id());

create policy education_staff_attendance_read on public.education_staff_attendance
for select to authenticated using (
  employee_id = education_private.employee_id() or education_private.has_role('administrator')
);
create policy education_staff_attendance_insert on public.education_staff_attendance
for insert to authenticated with check (
  education_private.has_role('administrator') and recorded_by = education_private.employee_id()
);
create policy education_staff_attendance_update on public.education_staff_attendance
for update to authenticated using (education_private.has_role('administrator'))
with check (education_private.has_role('administrator') and recorded_by = education_private.employee_id());

-- No attendance DELETE grants. Corrections use UPDATE; no full audit history is provided.
commit;
