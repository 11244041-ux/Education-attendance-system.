// Run with `node supabase/tests/browser.cjs`; uses mocked APIs, never the live database.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../..');
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const employee = { id: uid(1), auth_user_id: uid(2), display_name: 'Fictional Staff', is_teacher: true };
const student = { id: uid(3), student_number: 'S001', display_name: '<b>Fictional Student</b>' };
const lesson = { id: uid(4), title: 'Class One', session_date: '2026-10-27', teacher_id: employee.id };
const studentRecord = { id: uid(5), session_id: lesson.id, student_id: student.id, status: 'Present' };
const staffRecord = { id: uid(6), employee_id: employee.id, attendance_date: '2026-10-27', status: 'Present' };

(async () => {
  let checks = 0;
  const server = http.createServer((req, res) => {
    const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'] };
    const file = files[req.url];
    if (!file) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', file[1]); res.end(fs.readFileSync(path.join(root, file[0])));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    for (const role of ['teacher', 'administrator', 'staff', 'unlinked', 'broken']) {
      const page = await browser.newPage();
      const calls = [], writes = [], errors = [];
      let failWrite = false;
      page.on('pageerror', error => errors.push(error.message));
      await page.route('https://stzxapveaocuzbidpfng.supabase.co/**', async route => {
        const request = route.request(), url = new URL(request.url());
        const body = request.postDataJSON();
        calls.push(url.pathname);
        const reply = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
        if (url.pathname === '/auth/v1/token') return reply({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600 });
        if (url.pathname === '/auth/v1/user') return reply({ id: employee.auth_user_id });
        if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204 });
        assert.equal(request.headers().authorization, 'Bearer test-access');
        assert.ok(url.pathname.startsWith('/rest/v1/rpc/'), 'Direct table request is forbidden');
        assert.equal(request.method(), 'POST');
        const name = url.pathname.split('/').pop();
        if (role === 'broken' && name === 'education_get_access') {
          return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Table missing' }) });
        }
        if (name === 'education_get_access') return reply({ allowed: role !== 'unlinked', employee: role === 'unlinked' ? null : employee,
          roles: ['teacher', 'administrator'].includes(role) ? [role] : role === 'staff' ? ['staff'] : [] });
        if (name !== 'education_list_records') {
          writes.push({ rpc: name, body });
          if (failWrite) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: '23505', message: 'duplicate' }) });
          if (name === 'education_assign_role') return reply({ changed: true });
          return reply([{ id: uid(90), ...body }]);
        }
        if (body.p_offset > 0) return reply([]);
        const data = {
          employees: [employee], students: [student], sessions: [lesson],
          student_attendance: [studentRecord], staff_attendance: [staffRecord],
          roles: [{ code: 'teacher', label: 'Teacher' }, { code: 'staff', label: 'Education staff' }],
          user_roles: [{ auth_user_id: employee.auth_user_id, display_name: employee.display_name, role: 'teacher' }],
          role_audit: [{ target_auth_user_id: employee.auth_user_id, role: 'teacher', action: 'grant', actor_auth_user_id: uid(9), occurred_at: '2026-10-27T00:00:00Z' }]
        };
        return reply(data[body.p_resource] || []);
      });
      await page.goto('http://127.0.0.1:' + server.address().port);
      assert.equal(await page.locator('#workspace').isVisible(), false); checks++;
      assert.equal(calls.length, 0); checks++;
      await page.fill('#email', 'fictional@example.test'); await page.fill('#password', 'fictional-password');
      await page.click('#login-submit');
      if (role === 'unlinked') {
        await page.getByText('Education access has not been approved. Ask your Education administrator for a role.', { exact: true }).waitFor();
        assert.equal(await page.locator('#data-fields').evaluate(node => node.disabled), true); checks++;
      } else if (role === 'broken') {
        await page.getByText(/Could not load records: Table missing/).waitFor();
        assert.equal(await page.locator('#data-fields').evaluate(node => node.disabled), true); checks++;
      } else {
        await page.getByText('Saved records loaded.', { exact: true }).waitFor();
        assert.equal(await page.locator('#student-attendance-section').isVisible(), role === 'teacher'); checks++;
        assert.equal(await page.locator('#staff-attendance-section').isVisible(), role === 'administrator'); checks++;
        assert.equal(await page.locator('#students-section').isVisible(), role !== 'staff'); checks++;
        assert.equal(await page.locator('#staff-records tr').count(), 1); checks++;
        if (role !== 'staff') {
          assert.equal(await page.locator('#students-body b').count(), 0); checks++;
          await page.fill('#student-number', 'S002'); await page.fill('#student-name', 'Second Student');
          await page.click('#student-submit'); await page.getByText('Saved.', { exact: true }).waitFor();
          assert.equal(writes.at(-1).rpc, 'education_save_student'); checks++;
          await page.locator('#students-body button').click();
          await page.fill('#student-name', 'Corrected name'); await page.click('#student-submit');
          await page.waitForFunction(() => document.querySelector('#data-fields').disabled === false);
          assert.equal(writes.at(-1).rpc, 'education_save_student'); checks++;
          assert.equal(writes.at(-1).body.p_id, student.id); checks++;
        }
        if (role === 'teacher') {
          await page.fill('#session-title', 'New lesson'); await page.fill('#session-date', '2026-10-28');
          await page.locator('#session-form button[type=submit]').click();
          await page.waitForFunction(() => document.querySelector('#data-fields').disabled === false);
          assert.equal(writes.at(-1).body.p_teacher_id, employee.id); checks++;
          await page.selectOption('#attendance-session', lesson.id); await page.selectOption('#attendance-student', student.id);
          await page.click('#student-attendance-submit');
          await page.waitForFunction(() => document.querySelector('#data-fields').disabled === false);
          assert.equal(writes.at(-1).body.p_student_id, student.id); checks++;
          assert.equal('recorded_by' in writes.at(-1).body, false); checks++;
          await page.locator('#student-records button').click(); await page.selectOption('#student-status', 'Late');
          await page.click('#student-attendance-submit');
          await page.waitForFunction(() => document.querySelector('#data-fields').disabled === false);
          assert.equal(writes.at(-1).rpc, 'education_save_student_attendance'); checks++;
          assert.equal(writes.at(-1).body.p_id, studentRecord.id); checks++;
          failWrite = true;
          await page.click('[data-cancel="student-attendance-form"]');
          await page.selectOption('#attendance-session', lesson.id); await page.selectOption('#attendance-student', student.id);
          await page.click('#student-attendance-submit');
          await page.getByText(/This record already exists/).waitFor(); checks++;
        }
        if (role === 'administrator') {
          await page.selectOption('#attendance-employee', employee.id); await page.fill('#staff-date', '2026-10-27');
          await page.click('#staff-attendance-submit');
          await page.waitForFunction(() => document.querySelector('#data-fields').disabled === false);
          assert.equal(writes.at(-1).rpc, 'education_save_staff_attendance'); checks++;
          assert.equal(writes.at(-1).body.p_employee_id, employee.id); checks++;
          assert.equal(await page.locator('#student-records button:visible').count(), 0); checks++;
          assert.equal(await page.locator('#roles-section').isVisible(), true); checks++;
          await page.fill('#target-auth-user', uid(8)); await page.selectOption('#assign-role', 'teacher');
          await page.locator('#role-form button[type=submit]').click();
          await page.waitForFunction(() => document.querySelector('#data-fields').disabled === false);
          assert.equal(writes.at(-1).rpc, 'education_assign_role'); checks++;
          assert.equal(writes.at(-1).body.p_target_auth_user_id, uid(8)); checks++;
          assert.equal(writes.at(-1).body.p_grant, true); checks++;
          await page.locator('#user-roles-body button').click();
          await page.locator('#role-form button[type=submit]').click();
          await page.waitForFunction(() => document.querySelector('#data-fields').disabled === false);
          assert.equal(writes.at(-1).body.p_grant, false); checks++;
          assert.equal(await page.locator('#role-audit-body tr').count(), 1); checks++;
        }
        if (role === 'staff') {
          assert.equal(writes.length, 0); checks++;
          assert.equal(calls.some(p => p.endsWith('/education_students')), false); checks++;
        }
      }
      assert.equal(calls.some(p => ['/rest/v1/training_sessions', '/rest/v1/attendance_records'].includes(p)), false); checks++;
      await page.click('#sign-out');
      await page.locator('#login-section').waitFor();
      assert.equal(await page.locator('#staff-records tr').count(), 0); checks++;
      assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0); checks++;
      assert.deepEqual(errors, []); checks++;
      await page.close();
    }
    // Exercise the portal handoff and token refresh separately from password login.
    const portalPage = await browser.newPage();
    let refreshed = false;
    await portalPage.route('https://stzxapveaocuzbidpfng.supabase.co/**', async route => {
      const req = route.request(), url = new URL(req.url());
      const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      if (url.pathname === '/auth/v1/user') {
        if (req.headers().authorization === 'Bearer invalid') return reply({ message: 'Invalid token' }, 401);
        return reply({ id: employee.auth_user_id });
      }
      if (url.pathname === '/auth/v1/token') {
        assert.equal(url.searchParams.get('grant_type'), 'refresh_token');
        assert.equal(req.postDataJSON().refresh_token, 'portal-refresh');
        refreshed = true;
        return reply({ access_token: 'renewed', refresh_token: 'renewed-refresh', expires_in: 3600 });
      }
      assert.equal(req.headers().authorization, 'Bearer renewed');
      return reply([]);
    });
    await portalPage.goto('http://127.0.0.1:' + server.address().port);
    const rejected = await portalPage.evaluate(async () => {
      try { await window.educationPortal.setSession({ access_token: 'invalid' }); return false; }
      catch { return true; }
    });
    assert.equal(rejected, true); checks++;
    assert.equal(await portalPage.locator('#workspace').isVisible(), false); checks++;
    await portalPage.evaluate(() => window.educationPortal.setSession({ access_token: 'old', refresh_token: 'portal-refresh', expires_in: -1 }));
    assert.equal(refreshed, true); checks++;
    await portalPage.evaluate(() => window.educationPortal.clearSession());
    assert.equal(await portalPage.locator('#workspace').isVisible(), false); checks++;
    await portalPage.close();
    const recoveryPage = await browser.newPage();
    const recoveryCalls = [];
    let passwordChanged = false;
    await recoveryPage.route('https://stzxapveaocuzbidpfng.supabase.co/**', async route => {
      const req = route.request(), url = new URL(req.url());
      recoveryCalls.push(url.pathname);
      const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      if (url.pathname === '/auth/v1/recover') {
        assert.equal(url.searchParams.get('redirect_to'), 'http://127.0.0.1:' + server.address().port + '/');
        assert.equal(req.postDataJSON().email, 'fictional@example.test');
        return reply({});
      }
      if (url.pathname === '/auth/v1/user') {
        if (req.headers().authorization !== 'Bearer recovery-token') return reply({ message: 'Invalid session' }, 401);
        if (req.method() === 'PUT') {
          assert.equal(req.postDataJSON().password, 'New-fictional-password');
          passwordChanged = true;
        }
        return reply({ id: employee.auth_user_id });
      }
      if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204 });
      throw new Error('Recovery must not access database records');
    });
    const base = 'http://127.0.0.1:' + server.address().port;
    await recoveryPage.goto(base);
    await recoveryPage.fill('#email', 'fictional@example.test'); await recoveryPage.click('#forgot-password');
    await recoveryPage.getByText(/If this email has an account/).waitFor(); checks++;
    await recoveryPage.goto(base + '/#access_token=recovery-token&refresh_token=secret-refresh&type=recovery');
    await recoveryPage.getByText('Recovery link verified. Enter your new password.', { exact: true }).waitFor();
    assert.equal(new URL(recoveryPage.url()).hash, ''); checks++;
    assert.equal(await recoveryPage.locator('#workspace').isVisible(), false); checks++;
    await recoveryPage.fill('#new-password', 'New-fictional-password');
    await recoveryPage.fill('#confirm-password', 'Wrong-password');
    await recoveryPage.click('#recovery-submit');
    await recoveryPage.getByText('The passwords do not match.', { exact: true }).waitFor();
    assert.equal(passwordChanged, false); checks++;
    await recoveryPage.fill('#confirm-password', 'New-fictional-password');
    await recoveryPage.click('#recovery-submit');
    await recoveryPage.getByText('Password updated. Sign in with your new password.', { exact: true }).waitFor();
    assert.equal(passwordChanged, true); checks++;
    assert.equal(await recoveryPage.inputValue('#new-password'), ''); checks++;
    assert.equal(await recoveryPage.evaluate(() => localStorage.length + sessionStorage.length), 0); checks++;
    assert.equal(recoveryCalls.some(p => p.startsWith('/rest/')), false); checks++;
    await recoveryPage.goto(base + '/#access_token=expired-token&type=recovery');
    await recoveryPage.getByText('This recovery link is invalid or expired. Request a new reset email.', { exact: true }).waitFor(); checks++;
    assert.equal(new URL(recoveryPage.url()).hash, ''); checks++;
    await recoveryPage.goto(base + '/#error=access_denied&error_code=otp_expired');
    await recoveryPage.getByText(/This recovery link is expired or unsupported/).waitFor(); checks++;
    assert.equal(new URL(recoveryPage.url()).hash, ''); checks++;
    await recoveryPage.close();
    console.log(`${checks} browser checks passed across roles, error states, portal handoff, and token refresh (mocked APIs).`);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
