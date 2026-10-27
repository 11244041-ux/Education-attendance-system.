# Apply the TCMS Education RPC upgrade

For the subsequent location/class/enrollment/assessment release, apply migration 004 after this baseline and use [CATALOG_UPGRADE.md](CATALOG_UPGRADE.md). Do not deploy the new catalog frontend on a migration-003-only database.

## Before running SQL

Migration 003 requires the first two migrations and changes the API boundary: existing table-based clients stop working after direct grants are revoked. Coordinate its application with deployment of the new RPC-based webpage. Do not change or rerun already-applied migrations 001/002. Use an isolated development project first.

No hosted database changes are performed by the local tests or by this repository. Back up the project through the team's normal process and inspect any local schema modifications before applying. This migration intentionally fails on conflicting objects instead of overwriting them.

## Steps

1. Open the agreed development project's **SQL Editor → New query**.
2. Run the entire file `migrations/20261027000300_tcms_rpc_and_module_access.sql` once.
3. Confirm that `education_roles`, `education_user_roles`, and `education_role_audit` exist and that existing administrator/teacher roles were imported. Do not keep editing the old `education_staff_roles` table.
4. If no approved administrator existed before migration, a trusted database administrator must bootstrap one with an existing employee/Auth link:

```sql
-- Only if no Education administrator exists; replace with the intended existing Auth UUID.
insert into public.education_user_roles(auth_user_id, role)
select auth_user_id, 'administrator'
from public.education_employees
where auth_user_id = '<existing-admin-auth-uuid>'::uuid
on conflict do nothing;
```

5. Deploy the updated frontend with the RPC-based `app.js`. Confirm the existing administrator can sign in.
6. Under **Education access and roles**, enter an existing Portal user's Auth UUID, select `teacher` or `staff`, select **Grant role**, and save. Portal account creation/passwords stay with HR/Portal administration.
7. Confirm the audit row and refresh the user's module/Portal access.
8. For removal, choose **Revoke** beside the approved role, review the selected target, and save. A final role revocation removes module access. The last administrator is protected from removal.

Granting access creates an Education foreign-key bridge if needed, using a generic label. It never creates a new Auth account or copies Auth user metadata. Existing real display names are retained. Connect display names to the Portal's canonical profile only after that contract is supplied.

## Validation

Use separate test administrator, teacher, and unapproved accounts. Confirm role assignment and audit as well as denied operations using real signed-in tokens. An account with an employee record but no role must not access records. Teachers must not assign roles, record staff attendance, or record another teacher's session. Administrators without a teacher role must not record student attendance. Direct REST table reads/writes must be denied even for administrators; RLS must remain enabled.

Imported approvals have `source = migration` and `action = import`; they do not claim knowledge of past authors. Future trusted SQL role changes are also captured by the audit trigger. Browser clients cannot write or alter the audit table.

## Local tests

From the repository root, with Playwright/Chromium available and the pinned PGlite dependency installed as described in `EDUCATION_SETUP.md`:

```sh
NODE_PATH=/tmp/education-db-validation/node_modules node supabase/tests/permissions.cjs
NODE_PATH=/tmp/education-db-validation/node_modules node supabase/tests/rpc-permissions.cjs
node supabase/tests/browser.cjs
```

The first test suite preserves historical migration-002 validation. The second executes all three migrations and verifies the current RPC-only boundary, access gate, approval/revocation, audit, student/staff permissions, and rejected direct table access. Browser tests intercept all Supabase requests; they do not send recovery emails or write hosted records.

Do not restore direct grants as a workaround for an RPC error. Capture the error and investigate the migration, Auth session, and approved roles. This upgrade does not secure the old demonstration tables or implement the Portal's central notification system.
