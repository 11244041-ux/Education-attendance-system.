# Education: Training Attendance

Education department module for a larger company management system. Sign in, manage student profiles and class sessions, and record student or staff attendance according to assigned roles.

**Status:** frontend integration is implemented and locally tested. The user reports applying both database migrations and assigning test roles. Authenticated acceptance testing remains pending. Use fictional data during validation.

## Run locally

Requires Python 3, a modern browser, and HTTPS access to the configured Supabase project. No package installation or build step is required.

From this repository's root:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open the local server in a browser. Sign in using an existing Supabase Auth account linked to an Education employee profile, then check for “Saved records loaded.” If the port is occupied, select another port. Apply migrations and assign roles using [Education setup](supabase/EDUCATION_SETUP.md).

## Architecture

`index.html`, `styles.css`, and `app.js` contain the UI, styles, and behavior. The browser accesses Supabase Auth and REST directly. The Python server only serves files; records are stored remotely. This page no longer queries the old `training_sessions` or `attendance_records` tables and does not migrate their records.

The Supabase URL and browser publishable key are constants in `app.js`; the app does not read environment variables. Publishable keys are intended for browser use. Database policies enforce access. Never put service-role keys or other privileged credentials in the frontend. Confirm this project is the team's agreed development project before changing configuration.

## Roles and workflows

- Administrators and teachers create and edit student profiles.
- Teachers create their own class sessions and record/correct student attendance for assigned sessions.
- Administrators create/assign sessions and read student attendance, but cannot record it unless they also hold the teacher role and are assigned to that session.
- Administrators record/correct Education staff attendance. Other staff see only their own staff attendance.
- Student and staff attendance have separate tables, use stable UUID references, and reject duplicate student/session or employee/date pairs.
- Use **Correct** to edit an existing attendance record. There is no deletion UI, role-assignment UI, or student login flow.

## General portal integration

The built-in sign-in form supports existing email/password Supabase Auth accounts; account invitations, password recovery, and MFA flows belong to the general portal. For other login methods, use the portal's existing Auth flow and hand its session to this module after `app.js` loads:

```js
await window.educationPortal.setSession(portalSupabaseSession);
```

Pass the standard Supabase session object (`access_token`, `refresh_token`, `expires_at` in Unix seconds). The module verifies the user with Supabase Auth, loads their linked profile and roles, and refreshes expiring tokens. Calls to the database carry that user's access token. Repeated session changes clear prior data and ignore stale responses.

Tokens remain in memory; reloading the page requires portal handoff or another sign-in. No tokens are stored in browser storage or accepted from URLs or cross-window messages. The portal should supply sessions only through trusted same-page code, never an arbitrary message handler. Portal-wide sign-out should call `window.educationPortal.clearSession()` to remove module data; the module's Sign out button additionally requests local Supabase session revocation. Do not log or paste session objects into chat.

Restricted development environments need outbound HTTPS access to `stzxapveaocuzbidpfng.supabase.co`. A proxy CONNECT 403 indicates a network restriction before reaching Supabase. Errors returned by Supabase itself require checking its configuration and policies separately.

## Handoff and validation

See [INTEGRATION.md](INTEGRATION.md) for the data interface, team decisions, and integration checklist.

Education owns its department's employee data, the general portal uses Supabase Auth, and departments share one Supabase project. The employee table links profiles to Auth users; trusted administrators assign Education roles.

The user reports applying both migrations, testing own-profile isolation, and assigning test administrator/teacher roles. The latest read-only check confirms that all five second-migration tables are now exposed through REST and deny anonymous access with HTTP 401 / permission denied. Real authenticated role assignments and complete portal workflows still require acceptance testing.

- 34 local PostgreSQL permission checks passed using simulated Supabase Auth identities.
- 67 browser checks passed with mocked APIs: account/role visibility, student creation/editing, session creation, attendance insertion/correction, duplicate feedback, logout cleanup, missing-profile/schema errors, portal session handoff, and token refresh.
- These tests do not establish authenticated behavior in the hosted project. No real employee credentials were used and no hosted records were changed.
- Refresh still downloads all permitted records before filtering locally; larger deployments should add server-side filtering/pagination.
- Portal embedding, real Auth-token lifecycle, and hosted allowed/denied requests require end-to-end acceptance tests.

Run database tests as documented in [Education setup](supabase/EDUCATION_SETUP.md). Browser tests require Node.js, Playwright, and Chromium:

```sh
node supabase/tests/browser.cjs
```

They start an isolated local server, intercept all Supabase requests, and never write to a hosted project. Chromium defaults to `/usr/bin/chromium`; override with `CHROMIUM_PATH`. In this cloud environment Playwright is already available. Elsewhere install Playwright into an external test directory and add its `node_modules` to `NODE_PATH`.

These validation results describe the setup session, not ongoing service availability.
