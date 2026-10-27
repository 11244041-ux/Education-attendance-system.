# Education employee database setup

For the subsequent roles, student profiles, and separate attendance migration, follow [EDUCATION_SETUP.md](EDUCATION_SETUP.md). The own-profile-only description below covers the first migration; the second also allows administrators and teachers to read the Education staff directory.

## Scope

The portal uses Supabase Auth. The migration creates `public.education_employees` with:

| Field | Meaning |
| --- | --- |
| `id` | Generated UUID, the stable education employee identifier |
| `auth_user_id` | Required, unique reference to `auth.users.id` |
| `display_name` | Required name, 1–120 characters after trimming |
| `created_at` | Creation timestamp |

Each linked user can read only their own profile. Anonymous reads and employee writes are denied. Trusted administrative operations can provision profiles; no staff role or public signup trigger is introduced. Deleting a linked Auth user is restricted until its employee profile is handled explicitly.

This migration does not modify existing sessions, attendance records, or their permissions. Existing attendance is still name-based and must be migrated separately after reviewing the live schema. Adding this table alone does not secure the current attendance UI.

## Apply to the shared project

The user reports applying the first migration and creating two fictional profiles, and successfully testing own-profile access using simulated identities in the hosted SQL Editor. This environment has not independently inspected that hosted schema. No database administration tools are available here. The frontend publishable key cannot run schema migrations. Do not rerun the first migration on a project where it already exists.

1. Confirm the team's shared Supabase project. Do not assume the demo project's identity.
2. Inspect existing tables and migrations. This migration intentionally fails if `public.education_employees` already exists; compare schemas instead of deleting an existing table.
3. Test in the team's development Supabase project first.
4. In that project's Supabase SQL Editor, run the complete contents of `migrations/20261027000100_create_education_employees.sql` once. If the team already uses the Supabase CLI migration workflow, incorporate this file into that workflow instead and check migration history before applying.
5. Run the access checks below before applying through the team's production deployment process.

Do not put database passwords or service-role keys in chat or frontend files.

## Provision a profile

Create or invite the employee through the portal's trusted Supabase Auth administration flow first. Then an authorized database administrator can insert a profile using that account's exact Auth UUID:

```sql
-- Template only: replace the bracketed values before running.
insert into public.education_employees (auth_user_id, display_name)
values ('<existing-auth-user-uuid>'::uuid, '<employee-display-name>')
returning id;
```

Do not create Auth users by writing directly to `auth.users`. Do not use names to infer account ownership. Do not let employees submit arbitrary `auth_user_id` assignments. A shared-project backend must separately authorize any staff provisioning endpoint; possession of a service-role key is not an end-user permission check.

The portal can request `/rest/v1/education_employees?select=id,display_name,created_at` using the publishable `apikey` plus the signed-in user's `Authorization: Bearer <access-token>`. RLS restricts results to that user. Never log access tokens. The current `index.html` does not yet send an authenticated session.

## Required access checks

Local validation passed 13 checks using embedded PostgreSQL (PGlite) with simulated Supabase roles and `auth.uid()`: migration execution, trusted provisioning, isolation for two users, an unlinked user, anonymous access denial, denied employee writes, duplicate and invalid account links, blank names, and restricted Auth-account deletion. These checks do not validate the hosted project's configuration or actual Auth tokens.

Use fictional users A and B in an isolated development project, with one profile for each. Test using their actual signed-in sessions, not only the SQL Editor's privileged role:

- User A sees only A's profile; querying B's ID returns no rows.
- User B sees only B's profile.
- A signed-in user with no profile sees an empty list.
- An anonymous request is denied.
- Employees cannot insert, update, or delete profiles, including changing `auth_user_id`.
- Trusted provisioning rejects a duplicate Auth link, a nonexistent Auth user, and a blank name.
- A linked Auth account cannot be deleted without handling the employee profile.

These are acceptance checks to execute after applying the migration, not claims of completed validation. Future attendance policies must also prevent employees reading one another's attendance.
