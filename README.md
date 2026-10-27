# TCMS — Education and Vocational Training

Module 02 of the Tzu Chi Mozambique System. Manage student profiles, class sessions, and student/staff attendance using the Portal's shared Supabase Auth identity and Education-specific roles.

**Status:** the TCMS RPC/access-control upgrade is implemented and locally tested. The user reports applying migrations 001–003. A read-only check confirms the access RPC exists and denies anonymous execution. Authenticated hosted acceptance testing and integration with the actual Portal remain pending. See [TCMS upgrade steps](supabase/TCMS_UPGRADE.md).

## Run locally

Requires Python 3, a modern browser, and HTTPS access to the configured Supabase project. No package installation or build step is required.

From this repository's root:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open the local server in a browser. Use an existing Portal/Supabase Auth account with an approved Education role, then check for “Saved records loaded.” An employee profile alone no longer grants entry. If the port is occupied, select another port. Apply migrations and assign roles using [TCMS upgrade steps](supabase/TCMS_UPGRADE.md).

## Architecture

`index.html`, `styles.css`, and `app.js` contain the UI, styles, and behavior. The browser uses Supabase Auth plus authenticated RPCs under `/rest/v1/rpc/`; it never requests database tables directly. The Python server only serves files; records are stored remotely. The old `training_sessions`/`attendance_records` records are not used or migrated.

The Supabase URL and browser publishable key are constants in `app.js`; the app does not read environment variables. Publishable keys are intended for browser use. RLS stays enabled, browser table grants are revoked, and RPCs explicitly enforce identity, module membership, and operation permissions. Never put service-role keys or other privileged credentials in the frontend. Confirm this project is the team's agreed development project before changing configuration.

## Roles and workflows

- Administrators and teachers create and edit student profiles.
- Teachers create their own class sessions and record/correct student attendance for assigned sessions.
- Administrators create/assign sessions and read student attendance, but cannot record it unless they also hold the teacher role and are assigned to that session.
- Administrators record/correct Education staff attendance. Approved `staff` users see only their own staff attendance.
- Student and staff attendance have separate tables, use stable UUID references, and reject duplicate student/session or employee/date pairs.
- Administrators grant/revoke Education roles using an existing Portal Auth UUID. Every actual role change is audited; users cannot grant themselves access, and the last administrator cannot be removed.
- No Education role means no module access; there is no automatic module enrollment.
- Use **Correct** to edit attendance. There is no deletion UI or student login flow.

## General portal integration

Portal owns identity, account creation, passwords, status, and canonical personal information; Education owns module permissions. The built-in email/password and recovery screens support standalone development/testing using the same Auth accounts, not separate module passwords. Invitations and MFA belong to Portal. Hand its existing session to this module after `app.js` loads:

```js
await window.educationPortal.setSession(portalSupabaseSession);
const { allowed, roles } = await window.educationPortal.getAccess();
```

Pass the standard Supabase session object (`access_token`, `refresh_token`, `expires_at` in Unix seconds). The module verifies the user, checks approval, and refreshes expiring tokens. Calls carry that user's access token; repeated session changes clear prior data and ignore stale responses. Portal can use `education_get_access` with its own authenticated client to enable/disable its Education card; other modules' access remains unchanged. The actual Portal code is not in this repository.

Tokens remain in memory; reloading the page requires portal handoff or another sign-in. No tokens are stored in browser storage or accepted from cross-window messages. Password recovery is the sole supported URL-token callback: the fragment is removed immediately from history, verified with Auth, and used only to update the account password. The portal should supply normal sessions only through trusted same-page code, never an arbitrary message handler. Portal-wide sign-out should call `window.educationPortal.clearSession()` to remove module data; the module's Sign out button additionally requests local Supabase session revocation. Do not log or paste session objects into chat.

## Password recovery on GitHub Pages

In Supabase **Authentication → URL Configuration**, set the Site URL to the exact deployed page URL (normally `https://11244041-ux.github.io/training-attendance-system./`) and add that same URL, including the repository path and trailing slash, to Redirect URLs. Use the URL shown by GitHub **Settings → Pages** if a custom domain or another path is configured. Do not leave localhost as the production Site URL. For a shared portal, coordinate the project-wide Site URL with its owner; add this module's exact callback URL to Redirect URLs without replacing other departments' entries.

After the updated GitHub Pages deployment completes, enter the account email and click **Forgot password?** on the webpage. This sends a recovery request with the current page as `redirect_to`. Open the newest email link, set and confirm a new password, then sign in. Existing account IDs, employee profiles, and role links remain unchanged. Passwords must be at least eight characters and satisfy any stronger project policy. Supabase email configuration, delivery limits, and any custom email templates must support its standard recovery link with the requested redirect. The page supports standard implicit recovery fragments; PKCE `code` links require the portal's own matching flow or a fresh reset requested through this page. Never share recovery links or screenshots containing their tokens.

Restricted development environments need outbound HTTPS access to `stzxapveaocuzbidpfng.supabase.co`. A proxy CONNECT 403 indicates a network restriction before reaching Supabase. Errors returned by Supabase itself require checking its configuration and policies separately.

## Handoff and validation

See [INTEGRATION.md](INTEGRATION.md) for the handoff and [SDS-TCMS2-Education-W01.md](SDS-TCMS2-Education-W01.md) for scope, API, security decisions, meeting alignment, and remaining team agreements.

The meeting record calls for centralized Portal personal information. Existing Education profiles are preserved as a compatibility bridge for attendance IDs; newly approved accounts receive a generic bridge label instead of copied personal information. Canonical display names/account status must be integrated when the Portal owner supplies its profile/API contract. Existing tables are not destructively renamed to the proposed `Tbl02...` convention before team approval.

The user reports applying migrations 001–003, testing own-profile isolation, and assigning test administrator/teacher roles. Read-only checks confirmed the earlier tables deny anonymous access and the migration-003 access RPC now exists and denies anonymous execution. The migrations were run by the user, not this agent. Full Portal acceptance tests still need the Portal owner and real test sessions.

- 34 historical migration-002 database checks and 83 current TCMS RPC/database checks passed with simulated Supabase Auth identities.
- 85 browser checks passed with mocked APIs, including role grants/revocation review, audit display, RPC-only requests, access gating, attendance/profile workflows, portal handoff, token refresh, and password recovery.
- These tests do not establish authenticated behavior in the hosted project. No real employee credentials were used and no hosted records were changed.
- Refresh still downloads all permitted records before filtering locally; larger deployments should add server-side filtering/pagination.
- Portal embedding, real Auth-token lifecycle, and hosted allowed/denied requests require end-to-end acceptance tests.

Run database tests as documented in [TCMS upgrade](supabase/TCMS_UPGRADE.md). Browser tests require Node.js, Playwright, and Chromium:

```sh
node supabase/tests/browser.cjs
```

They start an isolated local server, intercept all Supabase requests, and never write to a hosted project. Chromium defaults to `/usr/bin/chromium`; override with `CHROMIUM_PATH`. In this cloud environment Playwright is already available. Elsewhere install Playwright into an external test directory and add its `node_modules` to `NODE_PATH`.

These validation results describe the setup session, not ongoing service availability.
