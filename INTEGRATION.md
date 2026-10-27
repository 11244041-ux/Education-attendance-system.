# Education module integration handoff

## Current boundary

This module manages Education student profiles, class sessions, and separate student/staff attendance through Supabase REST with Supabase Auth. The frontend now supports role-based workflows and a trusted portal session handoff. Shared portal navigation and hosted authenticated acceptance testing remain pending. There is no application API server.

## Confirmed integration direction

- Education owns employee data for the education department. This does not establish ownership of other departments' employee data.
- A general company portal will provide employee access to their own information.
- All departments will use one shared Supabase project. Confirm its project identity with the team before treating the current demonstration project as the shared database.

The portal uses Supabase Auth. Employee access is enforced in the database, not just by hiding UI sections. The first migration links `education_employees.auth_user_id` uniquely to `auth.users.id`, while `education_employees.id` is the stable UUID used by the new attendance interface. The user reports applying this first migration and checking own-profile isolation. The second migration additionally permits teachers and administrators to read the Education staff directory. Employee profile writes remain restricted to trusted provisioning. See [database setup](supabase/README.md).

Confirmed permissions: administrators and teachers manage student profiles; only teachers record student attendance; only administrators record Education staff attendance. Staff can view their own staff attendance. The prepared second migration and new frontend implement these rules, with teachers limited to assigned sessions. They also grant administrators read access to attendance for oversight and propose one staff attendance record per date. See [Education setup](supabase/EDUCATION_SETUP.md) for the exact matrix, design choices, and deployment steps. The user reports applying the second migration and assigning test roles. All five tables now deny anonymous reads in the latest REST check; authenticated hosted acceptance testing remains pending.

Do not connect real employee data until access policies have been reviewed and verified.

## Legacy demo data contract

The interface described in this section is retained for migration reference only. The webpage now uses `education_employees`, `education_staff_roles`, `education_students`, `education_sessions`, `education_student_attendance`, and `education_staff_attendance`. Their exact definitions and policies are in the two migrations under `supabase/migrations`; see [Education setup](supabase/EDUCATION_SETUP.md). Legacy records are not automatically copied or mapped.

This table describes frontend expectations, not verified SQL definitions. Obtain the actual database types, constraints, grants, and row-level security policies from the database owner before writing migrations.

| Table | Field | Frontend expectation |
| --- | --- | --- |
| `training_sessions` | `id` | Returned session identifier |
| `training_sessions` | `title` | Required, trimmed name; form maximum 120 characters |
| `training_sessions` | `session_date` | Required date from an HTML date input |
| `attendance_records` | `id` | Returned attendance identifier |
| `attendance_records` | `session_id` | Session reference; converted to a JavaScript number on submission |
| `attendance_records` | `participant_name` | Required, trimmed fictional name; form maximum 100 characters |
| `attendance_records` | `status` | UI choices: `Present`, `Absent`, `Late` |

Attendance reads expect a foreign-key relationship exposed as `training_sessions(title,session_date)`. Database nullability, uniqueness, and server-side validation are not recorded here. Form validation does not establish database enforcement.

Paths below are relative to the configured Supabase URL plus `/rest/v1/`:

| Operation | Method and path | Body fields |
| --- | --- | --- |
| List sessions | `GET training_sessions?select=id,title,session_date&order=id` | None |
| List attendance | `GET attendance_records?select=id,session_id,participant_name,status,training_sessions(title,session_date)&order=id` | None |
| Create session | `POST training_sessions` | `title`, `session_date` |
| Record attendance | `POST attendance_records` | `session_id`, `participant_name`, `status` |

Requests send an `apikey` header and JSON content type. Inserts request `Prefer: return=representation`; session creation expects an array containing the inserted row and ID. Reads append `limit=500` and increasing `offset` values until an empty page is returned. The frontend has no update or delete calls.

## Team decisions before implementation

The confirmed direction above is agreed; the following implementation details remain proposals.

| Decision | Recommendation | Suggested owner |
| --- | --- | --- |
| Employee identity | Education owns its employee data. Agree a stable employee identifier and how it maps to portal login accounts; reference employees instead of typing names. | Education and portal teams |
| Authentication | Reuse the confirmed Supabase Auth login; agree how the portal supplies its session to this module. | Integration team |
| Permissions | Enforce employees' access to their own information. Define staff rights to manage sessions, record attendance, and correct records. | Education and database owners |
| Database ownership | Use one shared Supabase project; confirm its identity, schema boundaries, migration ownership, and test databases. | Database owners |
| Application structure | Agree route, navigation, layout, deployment, and session sharing. | Integration team |
| Duplicate attendance | Decide whether each employee may have one record per session; enforce an employee/session unique constraint if agreed. | Education and database owners |
| Corrections | Decide who may edit records and whether an audit history is required. | Education owner |
| Demo data migration | Decide whether fictional records are discarded or explicitly mapped. Never automatically match employees by name alone. | Education and HR teams |
| Cross-department reporting | Agree explicit interfaces and required reports instead of relying on undocumented table access. | Department leads |

Confirm these decisions together before choosing a new employee ID type, authentication mechanism, or shared schema within this module. Implement agreed changes through reviewed migrations and frontend changes in a separate coding task.

## Integration acceptance checklist

- [x] Confirm Education ownership of its employee data, a general portal for access to personal information, and one shared Supabase project.
- [ ] Confirm employee identifiers, login-to-employee mapping, the shared project's identity, and the education route.
- [ ] Obtain and review actual schema and access policies; commit reproducible migrations without records or credentials.
- [ ] Provide an isolated development/test backend with fictional employees and sessions.
- [ ] Implement shared authentication and test allowed and denied operations for each agreed role, including direct REST calls.
- [ ] Replace name-only attendance with the agreed employee relationship and migration plan.
- [ ] Enforce required fields, statuses, foreign keys, and agreed duplicate rules in the database.
- [ ] Verify session creation, attendance creation, filtering, refresh, empty states, and request failures in the browser.
- [ ] Test duplicate and concurrent submissions and agreed correction behavior.
- [ ] Investigate the live-browser loading timeout; successful API reads alone do not prove page behavior.
- [ ] Add repeatable automated tests using an isolated backend or clearly identified mocks.
- [ ] Verify the module inside the combined company's login, navigation, and deployment.

## Share with colleagues now

Share the repository and these documents as a prototype for review. Explain that the role-based frontend and local database/browser tests are implemented, but the user reports completing both migrations and test role assignments; real authenticated acceptance tests and general-portal embedding remain pending. Do not share privileged credentials or use real company records in the demonstration database.
