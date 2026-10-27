-- Apply once to the agreed shared Supabase project through a reviewed migration.
-- Deliberately fails if this table already exists: inspect it instead of replacing it.
begin;

create table public.education_employees (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete restrict,
  display_name text not null
    constraint education_employees_display_name_check
    check (char_length(btrim(display_name)) between 1 and 120),
  created_at timestamptz not null default now()
);

comment on table public.education_employees is
  'Education-owned employee profiles. Provision through a trusted administrator; employees may read only their own profile.';
comment on column public.education_employees.id is
  'Stable education employee identifier for future attendance references.';
comment on column public.education_employees.auth_user_id is
  'One-to-one link to the portal Supabase Auth account. Never assign from untrusted client metadata.';

alter table public.education_employees enable row level security;

-- Explicit grants supplement RLS, including on projects with permissive defaults.
revoke all on table public.education_employees from public, anon, authenticated;
grant select on table public.education_employees to authenticated;
grant select, insert, update, delete on table public.education_employees to service_role;

create policy education_employees_read_own
  on public.education_employees
  for select
  to authenticated
  using (auth_user_id = (select auth.uid()));

-- No employee INSERT/UPDATE/DELETE policies. Staff roles are not yet defined.
commit;
