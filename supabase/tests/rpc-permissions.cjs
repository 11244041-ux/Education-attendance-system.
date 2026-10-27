// Isolated PostgreSQL tests for migration 003. Never connects to hosted Supabase.
const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

(async () => {
  const db = new PGlite(); let checks = 0;
  async function asUser(n, sql, params = []) {
    await db.exec('begin; set local role authenticated');
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [uid(n)]);
      const result = await db.query(sql, params);
      await db.exec('commit'); return result.rows;
    } catch (error) { await db.exec('rollback'); throw error; }
  }
  async function rpc(n, name, params = []) {
    const args = params.map((_, i) => '$' + (i + 1)).join(',');
    return (await asUser(n, `select public.${name}(${args}) as result`, params))[0].result;
  }
  async function denied(n, name, params = []) {
    await assert.rejects(() => rpc(n, name, params)); checks++;
  }
  async function list(n, resource, count) {
    const result = await rpc(n, 'education_list_records', [resource, 0, 100]);
    assert.equal(result.length, count); checks++; return result;
  }
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated;`);
    for (const file of ['20261027000100_create_education_employees.sql', '20261027000200_education_roles_students_attendance.sql']) {
      await db.exec(fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8'));
    }
    for (let n = 1; n <= 6; n++) {
      await db.query('insert into auth.users values ($1)', [uid(n)]);
      if (n <= 4) await db.query('insert into public.education_employees(id,auth_user_id,display_name) values ($1,$1,$2)', [uid(n), 'Fictional ' + n]);
    }
    await db.exec(`insert into public.education_staff_roles values
      ('${uid(1)}','administrator'), ('${uid(2)}','teacher'), ('${uid(3)}','teacher');`);
    await db.exec(fs.readFileSync(path.join(__dirname, '../migrations/20261027000300_tcms_rpc_and_module_access.sql'), 'utf8'));
    checks++;
    assert.equal((await rpc(1, 'education_get_access')).allowed, true); checks++;
    assert.equal((await rpc(4, 'education_get_access')).allowed, false); checks++;
    assert.equal((await rpc(5, 'education_get_access')).allowed, false); checks++;
    await denied(4, 'education_list_records', ['staff_attendance', 0, 100]);
    await denied(5, 'education_list_records', ['students', 0, 100]);
    const audit = await list(1, 'role_audit', 3);
    assert.ok(audit.every(r => r.action === 'import' && r.source === 'migration' && r.actor_auth_user_id === null)); checks++;
    await list(1, 'roles', 3);
    await denied(2, 'education_list_records', ['roles', 0, 100]);
    await denied(2, 'education_list_records', ['user_roles', 0, 100]);
    await denied(2, 'education_list_records', ['role_audit', 0, 100]);
    await denied(1, 'education_list_records', ['students; drop table auth.users', 0, 100]);
    await denied(1, 'education_list_records', ['students', -1, 100]);
    await denied(1, 'education_list_records', ['students', 0, 501]);
    // Direct access is denied even to an Education administrator.
    for (const table of ['education_employees','education_staff_roles','education_students','education_sessions',
      'education_student_attendance','education_staff_attendance','education_roles','education_user_roles','education_role_audit']) {
      await assert.rejects(() => asUser(1, 'select * from public.' + table)); checks++;
    }
    await assert.rejects(() => asUser(1, 'select education_private.has_role(\'administrator\')')); checks++;
    await db.exec('begin; set local role anon');
    await assert.rejects(() => db.query('select public.education_get_access()'));
    await db.exec('rollback'); checks++;
    await denied(2, 'education_assign_role', [uid(2), 'administrator', true]);
    await denied(4, 'education_assign_role', [uid(4), 'teacher', true]);
    await denied(1, 'education_assign_role', [uid(4), 'superuser', true]);
    await denied(1, 'education_assign_role', [uid(99), 'teacher', true]);
    await denied(1, 'education_assign_role', [uid(1), 'administrator', false]);
    const approval = await rpc(1, 'education_assign_role', [uid(5), 'teacher', true]);
    assert.equal(approval.changed, true); checks++;
    const access = await rpc(5, 'education_get_access');
    assert.equal(access.allowed, true); assert.deepEqual(access.roles, ['teacher']); checks++;
    assert.equal(access.employee.display_name, 'Education staff'); checks++;
    const grantedAudit = await list(1, 'role_audit', 4);
    assert.ok(grantedAudit.some(r => r.target_auth_user_id === uid(5) && r.actor_auth_user_id === uid(1) && r.action === 'grant')); checks++;
    assert.equal((await rpc(1, 'education_assign_role', [uid(5), 'teacher', true])).changed, false); checks++;
    await list(1, 'role_audit', 4); // No duplicate grant or misleading audit event.
    await rpc(1, 'education_assign_role', [uid(4), 'staff', true]);
    assert.equal((await rpc(4, 'education_get_access')).allowed, true); checks++;
    await denied(4, 'education_list_records', ['students', 0, 100]);
    const students = await rpc(2, 'education_save_student', [null, 'S001', ' Fictional Student ']);
    const student = students[0]; assert.equal(student.display_name, 'Fictional Student'); checks++;
    await denied(4, 'education_save_student', [null, 'S002', 'X']);
    await denied(2, 'education_save_student', [null, 'S001', 'Duplicate']);
    await denied(2, 'education_save_student', [null, 'S003', '   ']);
    await rpc(1, 'education_save_student', [student.id, 'S001', 'Updated Student']); checks++;
    const lessons = await rpc(2, 'education_save_session', ['Class A', '2026-10-27', uid(2)]);
    const lesson = lessons[0]; checks++;
    await denied(2, 'education_save_session', ['Not mine', '2026-10-27', uid(3)]);
    await denied(1, 'education_save_session', ['Not teacher', '2026-10-27', uid(4)]);
    const secondLesson = (await rpc(1, 'education_save_session', ['Assigned B', '2026-10-27', uid(3)]))[0]; checks++;
    await list(2, 'sessions', 1); await list(1, 'sessions', 2);
    await denied(1, 'education_save_student_attendance', [null, lesson.id, student.id, 'Present']);
    await denied(3, 'education_save_student_attendance', [null, lesson.id, student.id, 'Present']);
    const attendance = (await rpc(2, 'education_save_student_attendance', [null, lesson.id, student.id, 'Present']))[0]; checks++;
    await denied(2, 'education_save_student_attendance', [null, lesson.id, student.id, 'Present']);
    await denied(2, 'education_save_student_attendance', [attendance.id, lesson.id, student.id, 'Invalid']);
    await denied(3, 'education_save_student_attendance', [attendance.id, lesson.id, student.id, 'Late']);
    await denied(3, 'education_save_student_attendance', [attendance.id, secondLesson.id, student.id, 'Late']);
    await rpc(2, 'education_save_student_attendance', [attendance.id, lesson.id, student.id, 'Late']); checks++;
    const studentRecorder = await db.query('select recorded_by from public.education_student_attendance where id=$1', [attendance.id]);
    assert.equal(studentRecorder.rows[0].recorded_by, uid(2)); checks++;
    await list(3, 'student_attendance', 0); await list(1, 'student_attendance', 1);
    const staff = (await rpc(1, 'education_save_staff_attendance', [null, uid(4), '2026-10-27', 'Present']))[0]; checks++;
    const staffRecorder = await db.query('select recorded_by from public.education_staff_attendance where id=$1', [staff.id]);
    assert.equal(staffRecorder.rows[0].recorded_by, uid(1)); checks++;
    await denied(2, 'education_save_staff_attendance', [null, uid(4), '2026-10-27', 'Present']);
    await denied(4, 'education_save_staff_attendance', [staff.id, uid(4), '2026-10-27', 'Late']);
    await denied(1, 'education_save_staff_attendance', [null, uid(4), '2026-10-27', 'Present']);
    await list(4, 'staff_attendance', 1); await list(2, 'staff_attendance', 0);
    const directory = await list(2, 'employees', 5);
    assert.ok(directory.every(r => r.auth_user_id === null)); checks++;
    await rpc(1, 'education_assign_role', [uid(5), 'teacher', false]);
    assert.equal((await rpc(5, 'education_get_access')).allowed, false); checks++;
    await denied(5, 'education_list_records', ['students', 0, 100]);
    const before = (await list(1, 'role_audit', 6)).length;
    // Rolling back a grant also rolls back its audit row and compatibility profile.
    await db.exec('begin');
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [uid(1)]);
    await db.query('select public.education_assign_role($1,$2,$3)', [uid(6), 'teacher', true]);
    await db.exec('rollback');
    assert.equal((await rpc(6, 'education_get_access')).allowed, false); checks++;
    await list(1, 'role_audit', before);
    // A second administrator permits an intentional handover; the former admin loses rights.
    await rpc(1, 'education_assign_role', [uid(6), 'administrator', true]);
    await rpc(6, 'education_assign_role', [uid(1), 'administrator', false]);
    assert.equal((await rpc(1, 'education_get_access')).allowed, false); checks++;
    await denied(1, 'education_assign_role', [uid(1), 'administrator', true]);
    await denied(6, 'education_assign_role', [uid(6), 'administrator', false]);
    const handoverAudit = await rpc(6, 'education_list_records', ['role_audit', 0, 100]);
    assert.ok(handoverAudit.some(r => r.actor_auth_user_id === uid(6) && r.target_auth_user_id === uid(1) && r.action === 'revoke')); checks++;
    await assert.rejects(() => asUser(6, `insert into public.education_user_roles values ('${uid(1)}','administrator')`)); checks++;
    await assert.rejects(() => asUser(6, 'delete from public.education_role_audit')); checks++;
    const rls = await db.query("select relname from pg_class where relnamespace='public'::regnamespace and relname like 'education_%' and relkind='r' and not relrowsecurity");
    assert.equal(rls.rows.length, 0); checks++;
    console.log(`${checks} TCMS RPC/database checks passed with simulated Supabase identities.`);
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
