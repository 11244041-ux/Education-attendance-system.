-- Requires 001–003. Additive data migration; deploy with the matching catalog UI.
-- Legacy students/sessions keep NULL location/class links for explicit admin review.
begin;
create table public.education_locations (
  id uuid primary key default gen_random_uuid(), name text not null unique
);
insert into public.education_locations(name) values ('Ndeja'),('Kura'),('Metuchira');
create table public.education_programs (
  code text primary key check (code in ('VOCATIONAL','CRAM')), name text not null unique
);
insert into public.education_programs values ('VOCATIONAL','Vocational Training'),('CRAM','Cram School');
create table public.education_courses (
  id uuid primary key default gen_random_uuid(),
  program_code text not null references public.education_programs(code),
  name text not null check (length(btrim(name))>0),
  unique(program_code,name), unique(id,program_code)
);
insert into public.education_courses(program_code,name) values
 ('VOCATIONAL','Electricity'),('VOCATIONAL','Mechanics'),('VOCATIONAL','Sewing'),('VOCATIONAL','Bakery');
create table public.education_subjects (
  id uuid primary key default gen_random_uuid(),
  program_code text not null references public.education_programs(code),
  name text not null check (length(btrim(name))>0),
  course_id uuid,
  foreign key(course_id,program_code) references public.education_courses(id,program_code),
  check((program_code='CRAM' and course_id is null) or (program_code='VOCATIONAL' and course_id is not null)),
  unique(program_code,name), unique(id,program_code)
);
insert into public.education_subjects(program_code,name) values
 ('CRAM','Mathematics'),('CRAM','Portuguese'),('CRAM','Social Science'),('CRAM','Aphorism');
insert into public.education_subjects(program_code,name,course_id)
 select program_code,name,id from public.education_courses;
create table public.education_teacher_locations (
  employee_id uuid primary key references public.education_employees(id),
  location_id uuid not null references public.education_locations(id)
);
alter table public.education_students add column location_id uuid references public.education_locations(id);
alter table public.education_students add column active boolean not null default true;
create index education_students_location_idx on public.education_students(location_id,student_number,id);
create table public.education_classes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  location_id uuid not null references public.education_locations(id),
  program_code text not null references public.education_programs(code),
  course_id uuid,
  grade_level integer,
  shift text,
  academic_year integer not null check(academic_year between 2020 and 2100),
  teacher_id uuid not null references public.education_employees(id),
  active boolean not null default true,
  foreign key(course_id,program_code) references public.education_courses(id,program_code),
  check ((program_code='VOCATIONAL' and course_id is not null and grade_level is null and shift is null)
    or (program_code='CRAM' and course_id is null and grade_level between 1 and 8
      and grade_level is not null and shift is not null and shift in ('MORNING','AFTERNOON'))),
  unique(id,program_code,location_id), unique(id,program_code)
);
create index education_classes_teacher_idx on public.education_classes(teacher_id);
create table public.education_enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.education_students(id),
  class_id uuid not null,
  program_code text not null,
  location_id uuid not null,
  status text not null check(status in ('ACTIVE','COMPLETED','WITHDRAWN')),
  enrolled_on date not null,
  ended_on date,
  foreign key(class_id,program_code,location_id) references public.education_classes(id,program_code,location_id),
  check ((status='ACTIVE' and ended_on is null) or (status<>'ACTIVE' and ended_on is not null)),
  check(ended_on is null or ended_on>=enrolled_on),
  unique(student_id,class_id), unique(id,class_id)
);
-- The program is constrained to its class, so the partial unique index is authoritative.
create unique index education_one_active_vocational on public.education_enrollments(student_id)
  where status='ACTIVE' and program_code='VOCATIONAL';
create index education_enrollments_class_idx on public.education_enrollments(class_id);
alter table public.education_sessions add column class_id uuid references public.education_classes(id);
create index education_sessions_class_idx on public.education_sessions(class_id);
create table public.education_assessments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null,
  program_code text not null,
  subject_id uuid not null,
  title text not null check(length(btrim(title)) between 1 and 120),
  assessment_date date not null,
  foreign key(class_id,program_code) references public.education_classes(id,program_code),
  foreign key(subject_id,program_code) references public.education_subjects(id,program_code),
  unique(class_id,subject_id,title,assessment_date), unique(id,class_id)
);
create table public.education_marks (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null,
  enrollment_id uuid not null,
  class_id uuid not null,
  mark numeric not null check(mark>=0 and mark<=20),
  revision integer not null default 1 check(revision>0),
  recorded_by uuid not null references public.education_employees(id),
  updated_at timestamptz not null default now(),
  foreign key(assessment_id,class_id) references public.education_assessments(id,class_id),
  foreign key(enrollment_id,class_id) references public.education_enrollments(id,class_id),
  unique(assessment_id,enrollment_id)
);
create table public.education_mark_history (
  id uuid primary key default gen_random_uuid(),
  mark_id uuid not null references public.education_marks(id),
  old_mark numeric, new_mark numeric not null, revision integer not null,
  actor_auth_user_id uuid references auth.users(id), occurred_at timestamptz not null default now()
);
create index education_marks_enrollment_idx on public.education_marks(enrollment_id);
create function education_private.audit_mark()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.education_mark_history(mark_id,old_mark,new_mark,revision,actor_auth_user_id)
 values(new.id,case when tg_op='UPDATE' then old.mark else null end,new.mark,new.revision,auth.uid());
 return null;
end; $$;
create trigger education_marks_history after insert or update on public.education_marks
for each row execute function education_private.audit_mark();

create function education_private.teacher_location()
returns uuid language sql stable security definer set search_path='' as $$
 select location_id from public.education_teacher_locations where employee_id=education_private.employee_id();
$$;
create function education_private.teaches_class(target uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select education_private.has_role('teacher') and exists(select 1 from public.education_classes
   where id=target and teacher_id=education_private.employee_id()
   and location_id=education_private.teacher_location());
$$;
create or replace function education_private.teaches_session(target_session uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.education_sessions where id=target_session
   and teacher_id=education_private.employee_id() and education_private.teaches_class(class_id));
$$;
create function education_private.domain_write()
returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(20261028,4);
 perform education_private.require_access();
end; $$;

create function public.education_assign_teacher_location(p_employee_id uuid,p_location_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform education_private.domain_write();
 if not education_private.has_role('administrator') then raise exception 'Administrator role required.' using errcode='42501'; end if;
 if p_location_id is null or not exists(select 1 from public.education_employees e join public.education_user_roles u
   on u.auth_user_id=e.auth_user_id where e.id=p_employee_id and u.role='teacher') then
   raise exception 'Choose an approved teacher and location.' using errcode='23514'; end if;
 if exists(select 1 from public.education_classes where teacher_id=p_employee_id and active and location_id<>p_location_id) then
   raise exception 'Archive the teacher''s active classes before a location transfer.' using errcode='23514'; end if;
 insert into public.education_teacher_locations values(p_employee_id,p_location_id)
 on conflict(employee_id) do update set location_id=excluded.location_id;
 return jsonb_build_object('employee_id',p_employee_id,'location_id',p_location_id);
end; $$;

create function public.education_save_student_profile(p_id uuid,p_student_number text,p_display_name text,p_location_id uuid,p_active boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.education_students; old_location uuid;
begin
 perform education_private.domain_write();
 if not (education_private.has_role('administrator') or education_private.has_role('teacher')) then raise exception 'Student management denied.' using errcode='42501'; end if;
 if p_location_id is null then raise exception 'Choose the student''s location.' using errcode='23514'; end if;
 if not education_private.has_role('administrator') then
   if p_location_id is distinct from education_private.teacher_location() then raise exception 'Student belongs to another location.' using errcode='42501'; end if;
   if p_id is not null and not exists(select 1 from public.education_students where id=p_id and location_id=p_location_id) then
     raise exception 'Student management denied.' using errcode='42501'; end if;
 end if;
 if p_id is null then
   insert into public.education_students(student_number,display_name,location_id,active)
   values(btrim(p_student_number),btrim(p_display_name),p_location_id,p_active) returning * into saved;
 else
   select location_id into old_location from public.education_students where id=p_id for update;
   if not found then raise exception 'Student not found.' using errcode='P0002'; end if;
   if (old_location is distinct from p_location_id or not p_active) and exists(
     select 1 from public.education_enrollments where student_id=p_id and status='ACTIVE') then
     raise exception 'End active enrollments before transfer or deactivation.' using errcode='23514'; end if;
   update public.education_students set student_number=btrim(p_student_number),display_name=btrim(p_display_name),
     location_id=p_location_id,active=p_active where id=p_id returning * into saved;
 end if;
 return jsonb_build_array(to_jsonb(saved));
end; $$;
create or replace function public.education_save_student(p_id uuid,p_student_number text,p_display_name text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 raise exception 'Use education_save_student_profile with an explicit location.' using errcode='22023';
end; $$;

create function public.education_create_class(p_name text,p_location_id uuid,p_program_code text,p_course_id uuid,
 p_grade_level integer,p_shift text,p_academic_year integer,p_teacher_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.education_classes;
begin
 perform education_private.domain_write();
 if not education_private.has_role('administrator') then raise exception 'Administrator role required.' using errcode='42501'; end if;
 if not exists(select 1 from public.education_teacher_locations l join public.education_employees e on e.id=l.employee_id
   join public.education_user_roles u on u.auth_user_id=e.auth_user_id and u.role='teacher'
   where l.employee_id=p_teacher_id and l.location_id=p_location_id) then
   raise exception 'Assign a teacher from this location.' using errcode='23514'; end if;
 insert into public.education_classes(name,location_id,program_code,course_id,grade_level,shift,academic_year,teacher_id)
 values(btrim(p_name),p_location_id,p_program_code,p_course_id,p_grade_level,p_shift,p_academic_year,p_teacher_id) returning * into saved;
 return jsonb_build_array(to_jsonb(saved));
end; $$;
create function public.education_set_class_active(p_class_id uuid,p_active boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform education_private.domain_write();
 if not education_private.has_role('administrator') then raise exception 'Administrator role required.' using errcode='42501'; end if;
 if p_active is null then raise exception 'Specify active status.' using errcode='22023'; end if;
 if not p_active and exists(select 1 from public.education_enrollments where class_id=p_class_id and status='ACTIVE') then
   raise exception 'End active enrollments before archiving a class.' using errcode='23514'; end if;
 if p_active and not exists(select 1 from public.education_classes c join public.education_teacher_locations l
   on l.employee_id=c.teacher_id and l.location_id=c.location_id join public.education_employees e on e.id=c.teacher_id
   join public.education_user_roles u on u.auth_user_id=e.auth_user_id and u.role='teacher' where c.id=p_class_id) then
   raise exception 'Class requires a teacher assigned to its location.' using errcode='23514'; end if;
 update public.education_classes set active=p_active where id=p_class_id;
 if not found then raise exception 'Class not found.' using errcode='P0002'; end if;
 return jsonb_build_object('changed',true);
end; $$;

create function public.education_save_enrollment(p_id uuid,p_student_id uuid,p_class_id uuid,p_status text,p_enrolled_on date,p_ended_on date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare lesson public.education_classes; saved public.education_enrollments;
begin
 perform education_private.domain_write();
 select * into lesson from public.education_classes where id=p_class_id;
 if not found or not (education_private.has_role('administrator') or education_private.teaches_class(p_class_id)) then
   raise exception 'Enrollment management denied.' using errcode='42501'; end if;
 if not lesson.active and p_status='ACTIVE' then raise exception 'Class is archived.' using errcode='23514'; end if;
 if not exists(select 1 from public.education_students where id=p_student_id and active and location_id=lesson.location_id) then
   raise exception 'Choose an active student from the class location.' using errcode='23514'; end if;
 if p_id is null then
   insert into public.education_enrollments(student_id,class_id,program_code,location_id,status,enrolled_on,ended_on)
   values(p_student_id,p_class_id,lesson.program_code,lesson.location_id,p_status,p_enrolled_on,p_ended_on) returning * into saved;
 else
   if not exists(select 1 from public.education_enrollments where id=p_id and student_id=p_student_id and class_id=p_class_id) then
     raise exception 'Enrollment student and class cannot be changed.' using errcode='23514'; end if;
   if exists(select 1 from public.education_student_attendance a join public.education_sessions s on s.id=a.session_id
     where a.student_id=p_student_id and s.class_id=p_class_id and
     (s.session_date<p_enrolled_on or (p_ended_on is not null and s.session_date>p_ended_on))) or
     exists(select 1 from public.education_marks m join public.education_assessments a on a.id=m.assessment_id
     where m.enrollment_id=p_id and (a.assessment_date<p_enrolled_on or (p_ended_on is not null and a.assessment_date>p_ended_on))) then
       raise exception 'Enrollment dates must preserve recorded attendance and marks.' using errcode='23514'; end if;
   update public.education_enrollments set status=p_status,enrolled_on=p_enrolled_on,ended_on=p_ended_on
   where id=p_id returning * into saved;
 end if;
 return jsonb_build_array(to_jsonb(saved));
end; $$;

create function public.education_create_class_session(p_class_id uuid,p_title text,p_session_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare lesson public.education_classes; saved public.education_sessions;
begin
 perform education_private.domain_write();
 select * into lesson from public.education_classes where id=p_class_id;
 if not found or not lesson.active or not (education_private.has_role('administrator') or education_private.teaches_class(p_class_id)) then
   raise exception 'Session creation denied for this class.' using errcode='42501'; end if;
 if not exists(select 1 from public.education_teacher_locations l join public.education_employees e on e.id=l.employee_id
   join public.education_user_roles u on u.auth_user_id=e.auth_user_id and u.role='teacher'
   where l.employee_id=lesson.teacher_id and l.location_id=lesson.location_id) then
   raise exception 'Class teacher must be approved and assigned to this location.' using errcode='23514'; end if;
 insert into public.education_sessions(class_id,title,session_date,teacher_id)
 values(p_class_id,btrim(p_title),p_session_date,lesson.teacher_id) returning * into saved;
 return jsonb_build_array(to_jsonb(saved));
end; $$;
create or replace function public.education_save_session(p_title text,p_session_date date,p_teacher_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 raise exception 'Use education_create_class_session with an assigned class.' using errcode='22023';
end; $$;
create function public.education_link_legacy_session(p_session_id uuid,p_class_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old_session public.education_sessions; lesson public.education_classes;
begin
 perform education_private.domain_write();
 if not education_private.has_role('administrator') then raise exception 'Administrator role required.' using errcode='42501'; end if;
 select * into old_session from public.education_sessions where id=p_session_id for update;
 if not found or old_session.class_id is not null then raise exception 'Choose an unclassified session.' using errcode='23514'; end if;
 select * into lesson from public.education_classes where id=p_class_id and teacher_id=old_session.teacher_id and active;
 if not found then raise exception 'Choose an active class with the original teacher.' using errcode='23514'; end if;
 if exists(select 1 from public.education_student_attendance a where a.session_id=p_session_id and not exists(
   select 1 from public.education_enrollments e where e.class_id=p_class_id and e.student_id=a.student_id
   and e.enrolled_on<=old_session.session_date and (e.ended_on is null or e.ended_on>=old_session.session_date))) then
   raise exception 'Enroll every recorded student for the original session date before linking.' using errcode='23514'; end if;
 update public.education_sessions set class_id=p_class_id where id=p_session_id;
 return jsonb_build_object('linked',true);
end; $$;
create or replace function public.education_save_student_attendance(p_id uuid,p_session_id uuid,p_student_id uuid,p_status text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare lesson public.education_sessions; saved public.education_student_attendance; old_session uuid;
begin
 perform education_private.domain_write();
 select * into lesson from public.education_sessions where id=p_session_id;
 if not found or not education_private.teaches_session(p_session_id) then
   raise exception 'Only the assigned teacher at this location may record attendance.' using errcode='42501'; end if;
 if not exists(select 1 from public.education_enrollments where student_id=p_student_id and class_id=lesson.class_id
   and enrolled_on<=lesson.session_date and (ended_on is null or ended_on>=lesson.session_date)) then
   raise exception 'Student was not enrolled on this session date.' using errcode='23514'; end if;
 if p_id is null then
   insert into public.education_student_attendance(session_id,student_id,status,recorded_by)
   values(p_session_id,p_student_id,p_status,education_private.employee_id()) returning * into saved;
 else
   select session_id into old_session from public.education_student_attendance where id=p_id for update;
   if not found or not education_private.teaches_session(old_session) then raise exception 'Correction denied.' using errcode='42501'; end if;
   update public.education_student_attendance set session_id=p_session_id,student_id=p_student_id,status=p_status,
     recorded_by=education_private.employee_id() where id=p_id returning * into saved;
 end if;
 return jsonb_build_array(to_jsonb(saved));
end; $$;

create function public.education_create_assessment(p_class_id uuid,p_subject_id uuid,p_title text,p_assessment_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare lesson public.education_classes; saved public.education_assessments;
begin
 perform education_private.domain_write();
 if not education_private.teaches_class(p_class_id) then raise exception 'Only the assigned teacher may create assessments.' using errcode='42501'; end if;
 select * into lesson from public.education_classes where id=p_class_id and active;
 if not found then raise exception 'Class is archived.' using errcode='23514'; end if;
 if not exists(select 1 from public.education_subjects where id=p_subject_id and program_code=lesson.program_code
   and (lesson.program_code='CRAM' or course_id=lesson.course_id)) then
   raise exception 'Choose a subject belonging to this program and course.' using errcode='23514'; end if;
 insert into public.education_assessments(class_id,program_code,subject_id,title,assessment_date)
 values(p_class_id,lesson.program_code,p_subject_id,btrim(p_title),p_assessment_date) returning * into saved;
 return jsonb_build_array(to_jsonb(saved));
end; $$;
create function public.education_save_mark(p_id uuid,p_assessment_id uuid,p_enrollment_id uuid,p_mark numeric,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare assessment public.education_assessments; saved public.education_marks;
begin
 perform education_private.domain_write();
 select * into assessment from public.education_assessments where id=p_assessment_id;
 if not found or not education_private.teaches_class(assessment.class_id) then raise exception 'Only the assigned teacher may record marks.' using errcode='42501'; end if;
 if not exists(select 1 from public.education_enrollments where id=p_enrollment_id and class_id=assessment.class_id
   and enrolled_on<=assessment.assessment_date and (ended_on is null or ended_on>=assessment.assessment_date)) then
   raise exception 'Enrollment is not eligible for this assessment.' using errcode='23514'; end if;
 if p_id is null then
   insert into public.education_marks(assessment_id,enrollment_id,class_id,mark,recorded_by)
   values(p_assessment_id,p_enrollment_id,assessment.class_id,p_mark,education_private.employee_id()) returning * into saved;
 else
   update public.education_marks set mark=p_mark,recorded_by=education_private.employee_id(),
     updated_at=now(),revision=revision+1 where id=p_id and assessment_id=p_assessment_id and enrollment_id=p_enrollment_id
     and revision=p_expected_revision returning * into saved;
   if not found then raise exception 'Mark changed or is unavailable. Refresh before correcting.' using errcode='40001'; end if;
 end if;
 return jsonb_build_array(to_jsonb(saved));
end; $$;

-- Preserve the v3 reader privately; override resources requiring location/class scoping.
alter function public.education_list_records(text,integer,integer) rename to education_list_records_v3;
alter function public.education_list_records_v3(text,integer,integer) set schema education_private;
revoke all on function education_private.education_list_records_v3(text,integer,integer) from public,anon,authenticated;
create function public.education_list_records(p_resource text,p_offset integer default 0,p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; admin boolean;
begin
 perform education_private.require_access();
 if p_offset is null or p_offset<0 or p_limit is null or p_limit<1 or p_limit>500 then raise exception 'Invalid page range.' using errcode='22023'; end if;
 admin:=education_private.has_role('administrator');
 case p_resource
 when 'students' then
   if not (admin or education_private.has_role('teacher')) then raise exception 'Student access denied.' using errcode='42501'; end if;
   select jsonb_agg(to_jsonb(r)) into result from(select id,student_number,display_name,location_id,active from public.education_students
     where admin or location_id=education_private.teacher_location() order by student_number,id limit p_limit offset p_offset) r;
 when 'sessions' then
   if not (admin or education_private.has_role('teacher')) then raise exception 'Session access denied.' using errcode='42501'; end if;
   select jsonb_agg(to_jsonb(r)) into result from(select id,title,session_date,teacher_id,class_id from public.education_sessions
     where admin or education_private.teaches_session(id) order by session_date,id limit p_limit offset p_offset) r;
 when 'student_attendance' then
   if not (admin or education_private.has_role('teacher')) then raise exception 'Attendance access denied.' using errcode='42501'; end if;
   select jsonb_agg(to_jsonb(r)) into result from(select id,session_id,student_id,status from public.education_student_attendance
     where admin or education_private.teaches_session(session_id) order by id limit p_limit offset p_offset) r;
 when 'employees' then
   select jsonb_agg(to_jsonb(r)) into result from(select e.id,e.display_name,
     case when admin then e.auth_user_id else null end as auth_user_id,l.location_id,
     exists(select 1 from public.education_user_roles u where u.auth_user_id=e.auth_user_id and u.role='teacher') as is_teacher
     from public.education_employees e left join public.education_teacher_locations l on l.employee_id=e.id
     where admin or e.id=education_private.employee_id() or
       (education_private.has_role('teacher') and l.location_id=education_private.teacher_location())
     order by e.display_name,e.id limit p_limit offset p_offset) r;
 else return education_private.education_list_records_v3(p_resource,p_offset,p_limit);
 end case;
 return coalesce(result,'[]'::jsonb);
end; $$;

create function public.education_domain_list(p_resource text,p_offset integer default 0,p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; admin boolean;
begin
 perform education_private.require_access();
 admin:=education_private.has_role('administrator');
 if not (admin or education_private.has_role('teacher')) then raise exception 'Education teaching access required.' using errcode='42501'; end if;
 if p_offset is null or p_offset<0 or p_limit is null or p_limit<1 or p_limit>500 then raise exception 'Invalid page range.' using errcode='22023'; end if;
 case p_resource
 when 'locations' then select jsonb_agg(to_jsonb(r)) into result from(select * from public.education_locations
   where admin or id=education_private.teacher_location() order by name,id limit p_limit offset p_offset) r;
 when 'programs' then select jsonb_agg(to_jsonb(r)) into result from(select * from public.education_programs order by code limit p_limit offset p_offset) r;
 when 'courses' then select jsonb_agg(to_jsonb(r)) into result from(select * from public.education_courses order by name,id limit p_limit offset p_offset) r;
 when 'subjects' then select jsonb_agg(to_jsonb(r)) into result from(select * from public.education_subjects order by name,id limit p_limit offset p_offset) r;
 when 'teacher_locations' then select jsonb_agg(to_jsonb(r)) into result from(select * from public.education_teacher_locations
   where admin or employee_id=education_private.employee_id() order by employee_id limit p_limit offset p_offset) r;
 when 'classes' then select jsonb_agg(to_jsonb(r)) into result from(select * from public.education_classes
   where admin or education_private.teaches_class(id) order by academic_year desc,name,id limit p_limit offset p_offset) r;
 when 'enrollments' then select jsonb_agg(to_jsonb(r)) into result from(select e.*,s.display_name as student_name
   from public.education_enrollments e join public.education_students s on s.id=e.student_id
   where admin or education_private.teaches_class(e.class_id) order by e.id limit p_limit offset p_offset) r;
 when 'assessments' then select jsonb_agg(to_jsonb(r)) into result from(select * from public.education_assessments
   where admin or education_private.teaches_class(class_id) order by assessment_date desc,id limit p_limit offset p_offset) r;
 when 'marks' then select jsonb_agg(to_jsonb(r)) into result from(select m.* from public.education_marks m
   where admin or education_private.teaches_class(m.class_id) order by m.id limit p_limit offset p_offset) r;
 when 'mark_history' then select jsonb_agg(to_jsonb(r)) into result from(select h.* from public.education_mark_history h
   join public.education_marks m on m.id=h.mark_id where admin or education_private.teaches_class(m.class_id)
   order by h.occurred_at desc,h.id limit p_limit offset p_offset) r;
 else raise exception 'Unknown catalog resource.' using errcode='22023';
 end case;
 return coalesce(result,'[]'::jsonb);
end; $$;

-- Explicit table/function privileges. Private helpers never become client RPCs.
do $$ declare t text; f regprocedure; begin
 foreach t in array array['education_locations','education_programs','education_courses','education_subjects',
   'education_teacher_locations','education_classes','education_enrollments','education_assessments','education_marks','education_mark_history'] loop
   execute format('alter table public.%I enable row level security',t);
   execute format('revoke all on public.%I from public,anon,authenticated',t);
   execute format('grant select on public.%I to service_role',t);
 end loop;
 foreach f in array array[
   'public.education_assign_teacher_location(uuid,uuid)'::regprocedure,
   'public.education_save_student_profile(uuid,text,text,uuid,boolean)'::regprocedure,
   'public.education_create_class(text,uuid,text,uuid,integer,text,integer,uuid)'::regprocedure,
   'public.education_set_class_active(uuid,boolean)'::regprocedure,
   'public.education_save_enrollment(uuid,uuid,uuid,text,date,date)'::regprocedure,
   'public.education_create_class_session(uuid,text,date)'::regprocedure,
   'public.education_link_legacy_session(uuid,uuid)'::regprocedure,
   'public.education_create_assessment(uuid,uuid,text,date)'::regprocedure,
   'public.education_save_mark(uuid,uuid,uuid,numeric,integer)'::regprocedure,
   'public.education_domain_list(text,integer,integer)'::regprocedure,
   'public.education_list_records(text,integer,integer)'::regprocedure] loop
   execute format('revoke all on function %s from public,anon,authenticated',f);
   execute format('grant execute on function %s to authenticated',f);
 end loop;
end; $$;
revoke all on all functions in schema education_private from public,anon,authenticated;
commit;
