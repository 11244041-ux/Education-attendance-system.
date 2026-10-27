// Run with `node supabase/tests/browser.cjs`; uses mocked APIs, never the live database.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { startStaticServer } = require('./static-server.cjs');
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const employee = { id: uid(1), auth_user_id: uid(2), display_name: 'Fictional Staff', is_teacher: true, location_id:uid(7) };
const student = { id: uid(3), student_number: 'S001', display_name: '<b>Fictional Student</b>',location_id:uid(7),active:true };
const lesson = { id: uid(4), title: 'Class One', session_date: '2026-10-27', teacher_id: employee.id,class_id:uid(10) };
const studentRecord = { id: uid(5), session_id: lesson.id, student_id: student.id, status: 'Present' };
const staffRecord = { id: uid(6), employee_id: employee.id, attendance_date: '2026-10-27', status: 'Present' };

(async () => {
  let checks = 0;
  const { server } = await startStaticServer();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    for (const role of ['teacher', 'administrator', 'staff', 'unlinked', 'broken']) {
      const page = await browser.newPage();
      const calls = [], writes = [], errors = [];
      let failWrite = false;
      let failMark = false;
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
        if (name === 'education_domain_list') {
          if (body.p_offset>0) return reply([]);
          const catalog = {
            locations:[{id:uid(7),name:'Ndeja'},{id:uid(8),name:'Kura'}],
            programs:[{code:'VOCATIONAL',name:'Vocational Training'},{code:'CRAM',name:'Cram School'}],
            courses:[{id:uid(9),program_code:'VOCATIONAL',name:'Electricity'}],
            subjects:[{id:uid(12),program_code:'VOCATIONAL',course_id:uid(9),name:'Electricity'}],
            teacher_locations:[{employee_id:employee.id,location_id:uid(7)}],
            classes:[{id:uid(10),name:'Electricity N',location_id:uid(7),program_code:'VOCATIONAL',course_id:uid(9),academic_year:2026,teacher_id:employee.id,active:true}],
            enrollments:[{id:uid(11),student_id:student.id,class_id:uid(10),student_name:student.display_name,status:'ACTIVE',enrolled_on:'2026-01-01',ended_on:null}],
            assessments:[{id:uid(13),class_id:uid(10),subject_id:uid(12),title:'Practical test',assessment_date:'2026-10-28'}],
            marks:[{id:uid(14),assessment_id:uid(13),enrollment_id:uid(11),class_id:uid(10),mark:15,revision:1}],mark_history:[]
          };
          return reply(catalog[body.p_resource] || []);
        }
        if (name !== 'education_list_records') {
          writes.push({ rpc: name, body });
          if (failMark && name==='education_save_mark') return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:'40001',message:'Mark changed. Refresh before correcting.'})});
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
        assert.equal(await page.locator('.auth-backdrop').isVisible(), false); checks++;
        if (role !== 'staff') {
          assert.equal(await page.locator('#students-body b').count(), 0); checks++;
          await page.fill('#student-number', 'S002'); await page.fill('#student-name', 'Second Student');
          if (role === 'administrator') await page.selectOption('#student-location',uid(7));
          await page.click('#student-submit'); await page.getByText('Saved.', { exact: true }).waitFor();
          assert.equal(writes.at(-1).rpc, 'education_save_student_profile'); checks++;
          await page.locator('#students-body button').click();
          await page.fill('#student-name', 'Corrected name'); await page.click('#student-submit');
          await page.waitForFunction(() => document.querySelector('#data-fields').disabled === false);
          assert.equal(writes.at(-1).rpc, 'education_save_student_profile'); checks++;
          assert.equal(writes.at(-1).body.p_id, student.id); checks++;
        }
        if (role === 'teacher') {
          await page.fill('#session-title', 'New lesson'); await page.fill('#session-date', '2026-10-28');
          await page.selectOption('#session-class',uid(10));
          await page.locator('#session-form button[type=submit]').click();
          await page.waitForFunction(() => document.querySelector('#data-fields').disabled === false);
          assert.equal(writes.at(-1).body.p_class_id, uid(10)); checks++;
          await page.selectOption('#attendance-session', lesson.id); await page.selectOption('#attendance-student', student.id);
          await page.click('#student-attendance-submit');
          await page.waitForFunction(() => document.querySelector('#data-fields').disabled === false);
          assert.equal(writes.at(-1).body.p_student_id, student.id); checks++;
          assert.equal('recorded_by' in writes.at(-1).body, false); checks++;
          await page.locator('#student-records button').click();
          assert.equal(await page.inputValue('#student-record-id'),studentRecord.id);
          await page.selectOption('#student-status', 'Late');
          await page.click('#student-attendance-submit');
          await page.waitForFunction(() => document.querySelector('#data-fields').disabled === false);
          assert.equal(writes.at(-1).rpc, 'education_save_student_attendance'); checks++;
          assert.equal(writes.at(-1).body.p_id, studentRecord.id); checks++;
          assert.equal(await page.locator('#catalog-admin').isVisible(),false); checks++;
          assert.equal(await page.locator('#classes-body tr').count(),1); checks++;
          assert.equal(await page.locator('#enrollments-body tr').count(),1); checks++;
          await page.locator('#enrollments-body button').click();
          await page.selectOption('#enrollment-status','COMPLETED');
          await page.fill('#ended-on','2026-10-31');
          await page.locator('#enrollment-form button[type=submit]').click();
          await page.waitForFunction(() => !document.querySelector('#data-fields').disabled);
          assert.equal(writes.at(-1).rpc,'education_save_enrollment'); checks++;
          assert.equal(writes.at(-1).body.p_id,uid(11)); checks++;
          assert.equal(writes.at(-1).body.p_status,'COMPLETED'); checks++;
          await page.selectOption('#assessment-class',uid(10));
          await page.selectOption('#assessment-subject',uid(12));
          await page.fill('#assessment-title','New practical test'); await page.fill('#assessment-date','2026-10-28');
          await page.locator('#assessment-form button[type=submit]').click();
          await page.waitForFunction(() => !document.querySelector('#data-fields').disabled);
          assert.equal(writes.at(-1).rpc,'education_create_assessment'); checks++;
          assert.equal(writes.at(-1).body.p_subject_id,uid(12)); checks++;
          await page.selectOption('#mark-assessment',uid(13)); await page.selectOption('#mark-enrollment',uid(11));
          await page.fill('#mark-value','21');
          assert.equal(await page.locator('#mark-value').evaluate(input=>input.checkValidity()),false); checks++;
          await page.fill('#mark-value','0');
          await page.locator('#mark-form button[type=submit]').click();
          await page.waitForFunction(() => !document.querySelector('#data-fields').disabled);
          assert.equal(writes.at(-1).rpc,'education_save_mark'); checks++;
          assert.equal(writes.at(-1).body.p_mark,0); checks++;
          await page.locator('#marks-body button').click(); await page.fill('#mark-value','20');
          await page.locator('#mark-form button[type=submit]').click();
          await page.waitForFunction(() => !document.querySelector('#data-fields').disabled);
          assert.equal(writes.at(-1).body.p_id,uid(14)); checks++;
          assert.equal(writes.at(-1).body.p_expected_revision,1); checks++;
          assert.equal(writes.at(-1).body.p_mark,20); checks++;
          failMark=true;
          await page.locator('#marks-body button').click(); await page.fill('#mark-value','18');
          await page.locator('#mark-form button[type=submit]').click();
          await page.locator('#mark-message').filter({hasText:'Mark changed. Refresh before correcting.'}).waitFor();
          assert.equal(await page.inputValue('#mark-id'),uid(14)); checks++;
          assert.equal(await page.inputValue('#mark-revision'),'1'); checks++;
          failMark=false;
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
          assert.equal(await page.locator('#catalog-admin').isVisible(),true); checks++;
          assert.equal(await page.locator('#assessment-write').isVisible(),false); checks++;
          await page.selectOption('#location-teacher',employee.id); await page.selectOption('#teacher-location',uid(7));
          await page.locator('#teacher-location-form button[type=submit]').click();
          await page.waitForFunction(() => !document.querySelector('#data-fields').disabled);
          assert.equal(writes.at(-1).rpc,'education_assign_teacher_location'); checks++;
          assert.equal(writes.at(-1).body.p_location_id,uid(7)); checks++;
          await page.fill('#class-name','Vocational class'); await page.selectOption('#class-location',uid(7));
          await page.selectOption('#class-program','VOCATIONAL'); await page.selectOption('#class-course',uid(9));
          await page.selectOption('#class-teacher',employee.id); await page.fill('#class-year','2026');
          await page.locator('#class-form button[type=submit]').click();
          await page.waitForFunction(() => !document.querySelector('#data-fields').disabled);
          assert.equal(writes.at(-1).rpc,'education_create_class'); checks++;
          assert.equal(writes.at(-1).body.p_course_id,uid(9)); checks++;
          assert.equal(writes.at(-1).body.p_grade_level,null); checks++;
          await page.fill('#class-name','Cram class'); await page.selectOption('#class-location',uid(7));
          await page.selectOption('#class-program','CRAM'); await page.fill('#class-grade','9');
          assert.equal(await page.locator('#class-grade').evaluate(input=>input.checkValidity()),false); checks++;
          await page.fill('#class-grade','3'); await page.selectOption('#class-shift','AFTERNOON');
          await page.selectOption('#class-teacher',employee.id);
          await page.locator('#class-form button[type=submit]').click();
          await page.waitForFunction(() => !document.querySelector('#data-fields').disabled);
          assert.equal(writes.at(-1).body.p_course_id,null); checks++;
          assert.equal(writes.at(-1).body.p_grade_level,3); checks++;
          assert.equal(writes.at(-1).body.p_shift,'AFTERNOON'); checks++;
          await page.selectOption('#class-location',uid(8));
          assert.equal(await page.locator('#class-teacher option').count(),1); checks++;
        }
        if (role === 'staff') {
          assert.equal(writes.length, 0); checks++;
          assert.equal(calls.some(p => p.endsWith('/education_students')), false); checks++;
          assert.equal(calls.some(p=>p.endsWith('/education_domain_list')),false); checks++;
          assert.equal(await page.locator('#assessment-section').isVisible(),false); checks++;
        }
      }
      assert.equal(calls.some(p => ['/rest/v1/training_sessions', '/rest/v1/attendance_records'].includes(p)), false); checks++;
      await page.click('#sign-out');
      await page.locator('#login-section').waitFor();
      assert.equal(await page.locator('#staff-records tr').count(), 0); checks++;
      assert.equal(await page.locator('#mark-message').textContent(),''); checks++;
      assert.equal(await page.locator('.auth-backdrop').isVisible(), true); checks++;
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
