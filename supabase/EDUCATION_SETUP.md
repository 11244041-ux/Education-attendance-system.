# Students, staff roles, and attendance

**Historical setup for migration 002.** Migration 003 replaces direct table access and SQL-only role provisioning with authenticated RPCs and audited module-administrator approval. Follow [TCMS_UPGRADE.md](TCMS_UPGRADE.md) for the current upgrade. Do not use the earlier role table as the active authorization source after upgrading.

## Agreed permissions

| Operation | Administrator | Teacher | Other Education staff |
| --- | --- | --- | --- |
| Manage student profiles | Yes | Yes | No |
| Record/correct student attendance | No, unless also a teacher assigned to the session | Assigned sessions only | No |
| Record/correct staff attendance | Yes | No | No |
| Read staff attendance | All Education staff | Own only | Own only |
| Read student attendance | All | Assigned sessions only | No |

Administrator and teacher roles are separate; one employee can explicitly hold both. No client can grant roles, including an administrator client. Trusted database administrators assign them. Education administrators and teachers can read the Education staff directory (currently names, identifiers, and creation timestamps); other staff retain own-profile access.

Students have no login link in this migration. Teachers and administrators manage their profiles. Student login remains undecided.

## Design choices to review

- Student attendance is one record per student per class session.
- Staff attendance is one record per staff member per calendar date; this is a proposed daily model, not a shift/time-clock implementation. The portal should supply the department's intended local date.
- Teachers may create their own sessions; administrators can create and assign sessions. A teacher must hold the teacher role and be assigned to a session to record its attendance.
- Status values remain `Present`, `Absent`, and `Late`.
- Duplicate attendance is rejected by database constraints.
- Attendance can be corrected but not deleted by application users. `recorded_by` identifies the last recording staff member when supplied on corrections; this is not a complete audit history. `created_at` is the insertion timestamp.
- Student profiles with attendance cannot be deleted due to foreign keys. No automatic cascade deletes are used.

## Apply step by step

1. Select the agreed development Supabase project and inspect its existing schema.
2. Confirm `education_employees` already exists from the first migration. Do not rerun the first migration if it has already been applied.
3. In **SQL Editor → New query**, paste all of `migrations/20261027000200_education_roles_students_attendance.sql` and run it once.
4. If it fails, preserve the error and inspect the existing objects. Do not drop existing tables to force it to run. The migration is transactional.
5. In Table Editor, check for `education_staff_roles`, `education_students`, `education_sessions`, `education_student_attendance`, and `education_staff_attendance`.
6. Use the trusted SQL Editor to assign roles to existing fictional test employees. For each assignment, replace both placeholders in this template; role must be `administrator` or `teacher`:

```sql
insert into public.education_staff_roles (employee_id, role)
select id, '<administrator-or-teacher>'
from public.education_employees
where auth_user_id = '<existing-auth-user-uuid>'::uuid
returning employee_id, role;
```

7. Confirm exactly one returned row per intended assignment. An empty result means there is no matching employee profile. Use distinct administrator, teacher, and ordinary-staff test accounts; test a second teacher for class isolation.
8. Verify the matrix using authenticated test sessions and direct REST requests. The SQL Editor's normal privileged role does not exercise RLS. Test both allowed requests and denied requests. An unauthorized UPDATE may affect zero rows rather than return an error.

## Important integration boundary

This migration does not rename, copy, or change `training_sessions` or `attendance_records`. Their actual schema and policies have not been inspected through administration tools. Existing name-based records are not automatically mapped to students or staff.

The webpage now uses Supabase Auth and the new Education tables; it no longer queries the old demo tables. It can accept the general portal's session through `window.educationPortal.setSession(...)` or sign in existing email/password accounts. See the main README for integration details. The user reports applying this migration and assigning test roles. The latest read-only check found all five tables and confirmed anonymous reads are denied. Do not rerun the migration on this project; proceed with authenticated acceptance tests. Policies on these new tables do not secure the old tables; separately review their exposure before production.

Authenticated requests need the publishable API key and the user's Supabase Auth access token. Never use a service-role key in the browser. Keep `education_private` outside Supabase's exposed API schemas; its security-definer helpers use a fixed empty search path, return only current-user authorization information, and are not user-editable.

## Repeatable local tests

Install the isolated test dependency outside the repository and run:

```sh
npm install --prefix /tmp/education-db-validation --cache /tmp/education-npm-cache --no-package-lock --no-audit --no-fund @electric-sql/pglite@0.5.12
NODE_PATH=/tmp/education-db-validation/node_modules node supabase/tests/permissions.cjs
```

Run from the repository root. These tests execute both migrations in a fresh embedded PostgreSQL instance with simulated Supabase roles and `auth.uid()`. They do not connect to, modify, or establish the configuration of the hosted project. Hosted Auth-token and portal tests remain required.
