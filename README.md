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

The built-in sign-in form supports existing email/password Supabase Auth accounts and password recovery. Account invitations and MFA flows belong to the general portal. For other login methods, use the portal's existing Auth flow and hand its session to this module after `app.js` loads:

```js
await window.educationPortal.setSession(portalSupabaseSession);
```

Pass the standard Supabase session object (`access_token`, `refresh_token`, `expires_at` in Unix seconds). The module verifies the user with Supabase Auth, loads their linked profile and roles, and refreshes expiring tokens. Calls to the database carry that user's access token. Repeated session changes clear prior data and ignore stale responses.

Tokens remain in memory; reloading the page requires portal handoff or another sign-in. No tokens are stored in browser storage or accepted from cross-window messages. Password recovery is the sole supported URL-token callback: the fragment is removed immediately from history, verified with Auth, and used only to update the account password. The portal should supply normal sessions only through trusted same-page code, never an arbitrary message handler. Portal-wide sign-out should call `window.educationPortal.clearSession()` to remove module data; the module's Sign out button additionally requests local Supabase session revocation. Do not log or paste session objects into chat.

## Password recovery on GitHub Pages

In Supabase **Authentication → URL Configuration**, set the Site URL to the exact deployed page URL (normally `https://11244041-ux.github.io/training-attendance-system./`) and add that same URL, including the repository path and trailing slash, to Redirect URLs. Use the URL shown by GitHub **Settings → Pages** if a custom domain or another path is configured. Do not leave localhost as the production Site URL. For a shared portal, coordinate the project-wide Site URL with its owner; add this module's exact callback URL to Redirect URLs without replacing other departments' entries.

After the updated GitHub Pages deployment completes, enter the account email and click **Forgot password?** on the webpage. This sends a recovery request with the current page as `redirect_to`. Open the newest email link, set and confirm a new password, then sign in. Existing account IDs, employee profiles, and role links remain unchanged. Passwords must be at least eight characters and satisfy any stronger project policy. Supabase email configuration, delivery limits, and any custom email templates must support its standard recovery link with the requested redirect. The page supports standard implicit recovery fragments; PKCE `code` links require the portal's own matching flow or a fresh reset requested through this page. Never share recovery links or screenshots containing their tokens.

Restricted development environments need outbound HTTPS access to `stzxapveaocuzbidpfng.supabase.co`. A proxy CONNECT 403 indicates a network restriction before reaching Supabase. Errors returned by Supabase itself require checking its configuration and policies separately.

## Handoff and validation

See [INTEGRATION.md](INTEGRATION.md) for the data interface, team decisions, and integration checklist.

Education owns its department's employee data, the general portal uses Supabase Auth, and departments share one Supabase project. The employee table links profiles to Auth users; trusted administrators assign Education roles.

The user reports applying both migrations, testing own-profile isolation, and assigning test administrator/teacher roles. The latest read-only check confirms that all five second-migration tables are now exposed through REST and deny anonymous access with HTTP 401 / permission denied. Real authenticated role assignments and complete portal workflows still require acceptance testing.

- 34 local PostgreSQL permission checks passed using simulated Supabase Auth identities.
- 79 browser checks passed with mocked APIs: account/role visibility, student creation/editing, session creation, attendance insertion/correction, duplicate feedback, logout cleanup, missing-profile/schema errors, portal session handoff, token refresh, and password recovery including expired links.
- These tests do not establish authenticated behavior in the hosted project. No real employee credentials were used and no hosted records were changed.
- Refresh still downloads all permitted records before filtering locally; larger deployments should add server-side filtering/pagination.
- Portal embedding, real Auth-token lifecycle, and hosted allowed/denied requests require end-to-end acceptance tests.

Run database tests as documented in [Education setup](supabase/EDUCATION_SETUP.md). Browser tests require Node.js, Playwright, and Chromium:

```sh
node supabase/tests/browser.cjs
```

They start an isolated local server, intercept all Supabase requests, and never write to a hosted project. Chromium defaults to `/usr/bin/chromium`; override with `CHROMIUM_PATH`. In this cloud environment Playwright is already available. Elsewhere install Playwright into an external test directory and add its `node_modules` to `NODE_PATH`.

These validation results describe the setup session, not ongoing service availability.
