# Education workspace usability and accessibility update

Prepared 28 October 2026. Frontend-only release; no new SQL migration or change to role/location permissions.

## User-facing changes

- Role-based Dashboard, Students, Classes & locations, Enrollment, Sessions, Student attendance, Assessments, Staff/My attendance, and Administration sections replace the single long workspace page. Teachers see their location; administrators see their all-location scope. Losing a role removes its navigation entry.
- Dashboard counts describe the user's permitted view and link to the related task. Setup reminders identify teacher location assignments and preserved students needing review.
- Student attendance has a class register: select a session, review eligible enrolled students, mark individually or explicitly mark all present, then save changed records. Nothing defaults to Present. Existing records are corrected using their IDs; unchanged rows are skipped.
- Every student has an explicit saved, not-saved, or unconfirmed outcome. The class operation uses the existing per-student RPC, so partial success is possible. Confirmed successes are retained and not resubmitted. Unconfirmed or rejected rows require a fresh read and review before retrying; no automatic retry/upsert is introduced. Signing out stops subsequent writes; an already submitted request may still have committed.
- Single-record attendance entry/correction remains available in an expandable panel. Correction actions open it and move focus to the relevant field.
- Search, location/status filters where useful, ten-row pagination, counts and empty states improve record tables. These operate on already-authorized loaded rows. Server readers still fetch all permitted pages; this release does not implement server-side search or solve large-dataset loading costs.
- Saving successfully and failing to refresh are reported separately. The global status remains visible even when a failed refresh hides workspace controls. Unsaved roster choices survive temporary read failures for the same authenticated user and are cleared on sign-out or confirmed loss of module approval.
- Login and recovery have accessible show/hide password controls. Passwords are not trimmed, stored or logged. The illustration and responsive image assets are preserved.

## Accessibility implementation

Native buttons/selects retain standard keyboard behavior. Navigation exposes the current section, a skip link targets the content, and section changes focus an appropriate heading. Tables have captions/headers, their scroll regions are keyboard-focusable, and active controls generally provide at least 44 px height. Search/filter labels and roster labels identify their targets. Errors associate text with fields through aria-describedby and aria-invalid; global errors use assertive announcements. Touch layouts use an overflowable section navigation and scrollable tables without shrinking form text.

These are improvements toward WCAG 2.2 Level AA, not a claim of complete conformance or legal compliance. Automated checks cannot establish all keyboard, screen-reader, focus, zoom or cognitive-usability requirements.

## Validation results

- 128 existing functional browser checks passed.
- 101 responsive login checks passed across eight viewports and reduced keyboard-height simulation.
- 73 stateful workspace UX checks passed.
- 37 axe WCAG A/AA scans found no violations on the tested views/states.

These results use fictional fixtures and local Chromium, not real hosted accounts or a legal review.

## Repeatable checks

From the repository root with the existing Playwright/Chromium test environment:

```sh
node supabase/tests/browser.cjs
node supabase/tests/login-layout.cjs
node supabase/tests/workspace-ux.cjs
```

The stateful fictional fixture intercepts every Supabase request. UX tests cover roles, mobile/desktop overflow, search, filters, pagination, keyboard navigation, field errors, roster changes, duplicate-retry prevention, partial/uncertain outcomes, refresh failures, and sign-out during an in-flight save. No hosted student data is read or changed by these tests.

Install the optional automated accessibility checker outside the repository:

```sh
npm install --prefix /tmp/education-ui-validation --cache /tmp/education-npm-cache --no-package-lock --no-audit --no-fund axe-core@4.10.3
NODE_PATH="/tmp/education-ui-validation/node_modules:$NODE_PATH" node supabase/tests/accessibility.cjs
```

Keep any existing Node module search path when adding the checker path. Automated scans target WCAG A/AA rules including 2.1/2.2 across desktop/mobile, login/invalid-login, role-specific workspace sections, and populated rosters. They use simulated accounts and cannot certify hosted deployment behavior. SCREENSHOT_DIR can save fictional-data screenshots outside the checkout.

## Deployment and remaining review

Deploy index.html, app.js, catalog.js, **workspace.js**, styles.css, and assets/ together. Existing migration-004 RPCs remain authoritative. No privacy notice, consent policy, retention period or identity-exchange protocol has been invented as part of this UI release.

Before production, complete physical-device/keyboard testing, screen-reader testing, zoom/reflow and focus review, and real role-based acceptance tests in the isolated project. Ask the responsible team/adviser to verify applicable privacy/children's-data requirements, lawful processing, notices, retention/deletion, hosting/transfers, breach handling and organizational procedures. Those reviews are separate from a visual or automated accessibility test.
