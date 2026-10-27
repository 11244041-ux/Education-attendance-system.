# SDS — TCMS Module 02: Education and Vocational Training

Version: 0.2 draft · 2026-10-28

Migration 004 extends this baseline with location-scoped classes, enrollment and 0–20 assessments. Its detailed design and deployment contract are in [CATALOG_UPGRADE.md](supabase/CATALOG_UPGRADE.md). The prepared upgrade has not been applied to a hosted project by this agent.

Source: TCMS Project Development Meeting Record, 2026-10-21, supplied by the project owner. Recommendations in that record remain proposals until the team approves them. This document does not claim compliance with the instructor's SBI-P-SDS v3.4, which has not been supplied.

## Scope and ownership

TCMS has a shared Portal and four business modules. Education covers vocational training and supplementary education at three locations, including teachers, students, courses, grades, and attendance. This repository now implements the prepared location/class/enrollment and assessment extension alongside the initial attendance module; hosted validation of that extension remains pending.

The Portal owns account creation, Supabase Auth, password workflows, canonical user profiles, account status, and navigation. HR/Portal administrators create accounts; there is no module signup. Education owns its educational records and module authorization. The latest integration checklist specifies separate Portal/module projects. Their local Auth UUIDs must be explicitly mapped under an agreed verification contract, not assumed identical or matched by email. The prototype currently signs in to the module project; cross-project login integration is pending.

The existing `education_employees` records are retained as a compatibility bridge for attendance foreign keys. Existing names are not deleted. New approvals create only a bridge with a generic label, not a copy of the user's Portal profile. Replacing those labels with a Portal-owned profile read requires the actual shared profile contract; no `Tbl00UserProfile` schema is assumed or created here.

## Authorization model

| Role | Capabilities |
| --- | --- |
| `administrator` | Manage student profiles and class assignments; record/correct staff attendance; read Education attendance; grant/revoke Education roles; view role audit |
| `teacher` | Manage student profiles; create own sessions; record/correct student attendance only for assigned sessions |
| `staff` | Enter the module and read own staff attendance; no student management or attendance writes |

An account with no Education role cannot enter or read Education records, even if a legacy employee bridge exists. A user may explicitly hold more than one role. Administrators cannot record student attendance unless separately granted Teacher and assigned to that session. No role is automatically granted when a Portal account or employee profile is created.

`education_roles` defines roles; `education_user_roles` maps Auth UUIDs directly to role codes. `education_staff_roles` is retained as a legacy import source, not a current authorization source. Existing administrator/teacher approvals are imported once by migration 003. Existing accounts without roles remain unapproved; grant `staff` explicitly if self-service attendance access is needed.

Role grants/revocations are transactional and audited with the target Auth ID, role, action, authorizing Auth ID, UTC time, and source. Imported approvals are marked `import`, with no invented historical authorizer. Identical grant/revoke requests return `changed: false` and do not invent audit events. The last administrator cannot be removed. Only trusted migration/SQL administration can bootstrap an installation with no existing administrator.

## Database/API boundary

RLS remains enabled on all Education tables. Migration 003 removes direct table privileges from browser roles, including Education administrators. All application data requests use authenticated RPCs with explicit operation-level authorization and bounded pages. Security-definer RPCs use a fixed empty search path and fully qualified object names. Private helper execution/schema access is revoked from client roles. Trusted database administration remains privileged.

The following table documents the migration-003 baseline. Migration 004 replaces the student/session writer contracts and adds catalog, enrollment, assessment and mark RPCs as listed in [CATALOG_UPGRADE.md](supabase/CATALOG_UPGRADE.md).

| RPC | Purpose |
| --- | --- |
| `education_get_access()` | Return current user's `allowed`, role codes, and Education bridge; safe for Portal access-card decisions |
| `education_list_records(p_resource,p_offset,p_limit)` | Read permitted fields for a whitelisted resource; limit 1–500 |
| `education_save_student(p_id,p_student_number,p_display_name)` | Teacher/admin create or update a student |
| `education_save_session(p_title,p_session_date,p_teacher_id)` | Create a session assigned to an approved teacher |
| `education_save_student_attendance(p_id,p_session_id,p_student_id,p_status)` | Assigned teacher insert/correct; recorder comes from Auth |
| `education_save_staff_attendance(p_id,p_employee_id,p_attendance_date,p_status)` | Administrator insert/correct; recorder comes from Auth |
| `education_assign_role(p_target_auth_user_id,p_role,p_grant)` | Education administrator approve/revoke an existing Auth account |

All use POST `/rest/v1/rpc/<name>`, the public publishable API key, and the signed-in user's bearer token. No client supplies its own authorization identity or recorder ID. Anonymous calls and unapproved business-data calls are denied. Resource names are whitelisted; no client-provided SQL or table names are executed.

`education_list_records` supports `employees`, `students`, `sessions`, `student_attendance`, `staff_attendance`, and administrator-only `roles`, `user_roles`, `role_audit`. Teachers do not receive other staff's Auth UUIDs. Students have no login accounts in this phase. Staff attendance currently uses a proposed daily model; student attendance is per class session. Unique constraints prevent duplicate employee/date and student/session records.

The old `training_sessions`/`attendance_records` tables are not touched or used. Their exposure must be reviewed separately before production. No silent name-based conversion of legacy records is performed.

## Portal integration contract

The Portal must pass its existing Supabase session through trusted same-page code:

```js
await window.educationPortal.setSession(portalSession);
const { allowed, roles } = await window.educationPortal.getAccess();
```

This adapter and access RPC currently require a token recognized by the module project. With separate Portal/module projects, the approved identity-verification/exchange contract must be implemented before Portal can invoke module access on behalf of a user. Portal and module Auth UUIDs must be explicitly mapped. Cross-window token messages and URL token handoff are not implemented. The Portal should gray out Education when `allowed` is false and refresh access after approval. Disabled cards are only UI feedback; the RPCs enforce the decision independently. No changes to other modules' permissions are made here.

The standalone sign-in/reset UI currently uses module-local Auth accounts for development/testing. Integrated deployment should use the Portal's identity flow. Do not transmit tokens via chat, query strings, arbitrary message handlers, or browser storage. Password recovery uses a verified recovery-only callback and immediately strips its fragment.

The Portal's exact profile fields, account-status handling, route, navigation, session lifecycle ownership, pending notification interface, and deployment arrangement still need confirmation with its owner. The central Pending-notification workflow is not invented in this module. The current gate supports approval-driven access without that notification component.

## Team standards and outstanding work

- Keep existing table names/data intact until the team adopts naming conventions. `Tbl02...` is a meeting recommendation, not grounds for an unreviewed destructive rename.
- Confirm common button/error wording, shared styles, return-to-Portal navigation, repository organization, and migration ownership with the standards maintainer.
- Obtain SBI-P-SDS v3.4 before claiming compliance with its complete requirements.
- Validate the locally implemented three-location, course/enrollment and assessment extension using migration 004 and its test/acceptance plan.
- Add Portal-managed canonical profile display and account-status enforcement using the actual shared schema/API.
- A complete staff/student attendance audit history and production monitoring are separate work; this milestone audits role changes.

## Acceptance scenario

1. HR creates a test account through the Portal; no Education role exists.
2. The user signs in and changes the initial password through Portal flows.
3. Portal shows Education disabled; direct Education business RPCs also deny access.
4. An existing Education administrator grants `teacher` using the Education role screen or RPC, identifying the verified mapped module Auth UUID.
5. The user refreshes Portal access; Education becomes enabled while other modules remain unchanged.
6. The teacher enters Education and performs assigned-teacher operations; administrator-only role/staff-attendance writes remain denied.
7. The administrator sees the authorizer, timestamp, user, and role in the audit view.
8. Revoking the last Education role disables access on refresh and blocks subsequent data RPCs.

Automated local database/browser tests simulate these module-side contracts. They do not demonstrate an actual Portal integration or prove the hosted migration has been applied.
