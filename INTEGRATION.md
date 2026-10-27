# TCMS Education integration handoff

This repository is **Module 02: Education and Vocational Training** in the Tzu Chi Mozambique System. The uploaded 2026-10-21 meeting record establishes its relationship to Portal and the other three business modules.

## Current implementation

- Portal/Supabase Auth accounts are reused; no separate module passwords or public signup.
- Education role definitions and direct Auth-user mappings are separate tables.
- Module access is denied until an administrator explicitly grants a role.
- Administrators approve/revoke roles through an RPC-backed screen; a transactional audit records the target, role, action, authorizer, and time.
- All webpage data requests use authorized RPCs. Migration 003 keeps RLS enabled and revokes direct browser table access.
- Student profiles, assigned-teacher class sessions, student attendance, and administrator-recorded staff attendance are implemented.
- Existing data is retained. No destructive table rename or implicit conversion of old name-based attendance is performed.

## Required deployment action

The user reports applying migrations 001–003. The migration-003 access RPC now exists and rejects anonymous execution in a read-only check. The user applied the SQL; this agent is deploying the matching RPC-based webpage. Follow [TCMS_UPGRADE.md](supabase/TCMS_UPGRADE.md) for future installations. Authenticated acceptance testing remains pending; do not rerun already-applied migrations.

## Portal owner handoff

Use `education_get_access` with the current user's session to gray out/enable Education. After an administrator grants Teacher, refresh that access result. The Portal and module use separate projects. Their Auth UUIDs must be explicitly mapped under an agreed verification contract; matching emails or forwarding the Portal token unchanged is not sufficient. Education's approval changes no other module's permissions.

For trusted same-page embedding:

```js
await window.educationPortal.setSession(portalSession);
const access = await window.educationPortal.getAccess();
// Portal renders its Education card from access.allowed.
```

A separate Portal requires an approved module identity/verification connection before invoking this RPC; no cross-window token-passing interface is provided. The Portal source is not present here, so its cards, initial-password-change workflow, navigation, and Pending notifications have not been edited or verified.

Agree the canonical Portal profile API, account-status policy, actual routes, session-refresh/sign-out ownership, and pending-access notifications before integrated deployment. Existing Education employee rows are only a compatibility bridge; new approvals create a generic label rather than duplicate personal data. No central profile table is invented or modified.

## Remaining Education scope

Migration 004 and its prepared frontend implement three-location management, programs, courses, class/enrollment catalogs, and 0–20 assessment marks. They are locally tested, not yet applied/deployed from this agent. See [catalog upgrade](supabase/CATALOG_UPGRADE.md) for permissions, ER relationships, deployment steps, and legacy record review. Student portal accounts remain undecided.

Proposed `Tbl02...` names and shared UI conventions require team agreement. Obtain the instructor's SBI-P-SDS v3.4 before claiming full compliance. The current module design and exact RPC signatures are documented in [SDS-TCMS2-Education-W01.md](SDS-TCMS2-Education-W01.md).

## Acceptance

Use the meeting's scenario: HR-created Portal user initially has no module access; Education administrator grants Teacher; Portal refresh enables only Education; teacher operations succeed and administrator-only operations fail; authorization history shows who granted access and when. Revoke the role and confirm both entry and data calls are denied.

Local tests simulate the module side. Hosted Auth sessions and the actual Portal still require acceptance testing. Do not share credentials or recovery links in the repository or chat.
