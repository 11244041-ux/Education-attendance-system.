// Isolated PostgreSQL tests; never connects to a hosted Supabase project.
const { PGlite } = require('@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const db = new PGlite();
  let checks = 0;
  const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated;
    `);
    for (const name of ['20261027000100_create_education_employees.sql',
      '20261027000200_education_roles_students_attendance.sql']) {
      await db.exec(readFileSync(join(__dirname, '../migrations', name), 'utf8'));
    }
    checks++;
    for (let n = 1; n <= 4; n++) {
      await db.exec(`insert into auth.users values ('${uid(n)}');
        insert into public.education_employees(id,auth_user_id,display_name)
        values ('${uid(n)}','${uid(n)}','Fictional ${n}');`);
    }
    await db.exec(`insert into public.education_staff_roles values
      ('${uid(1)}','administrator'), ('${uid(2)}','teacher'), ('${uid(3)}','teacher');`);
    async function asUser(n, sql) {
      await db.exec('begin; set local role authenticated');
      try {
        await db.query("select set_config('request.jwt.claim.sub',$1,true)", [uid(n)]);
        const result = await db.query(sql);
        await db.exec('commit');
        return result.rows;
      } catch (error) {
        await db.exec('rollback');
        throw error;
      }
    }
    async function denied(n, sql) {
      await assert.rejects(() => asUser(n, sql)); checks++;
    }
    async function count(n, sql, expected) {
      assert.equal((await asUser(n, sql)).length, expected); checks++;
    }
    const student = `insert into public.education_students(id,student_number,display_name)
      values ('${uid(10)}','TEST-001','Fictional Student') returning id`;
    await count(1, student, 1);
    await count(2, 'select * from public.education_students', 1);
    await count(2, "update public.education_students set display_name='Updated' returning id", 1);
    await denied(4, `insert into public.education_students(student_number,display_name) values ('DENIED','X')`);
    await count(4, 'select * from public.education_students', 0);
    await count(2, `insert into public.education_sessions(id,title,session_date,teacher_id)
      values ('${uid(20)}','Class','2026-10-27','${uid(2)}') returning id`, 1);
    await denied(2, `insert into public.education_sessions(title,session_date,teacher_id)
      values ('Wrong teacher','2026-10-27','${uid(3)}')`);
    const attendance = `insert into public.education_student_attendance(session_id,student_id,status)
      values ('${uid(20)}','${uid(10)}','Present') returning id`;
    await denied(1, attendance); // An administrator alone is not a teacher.
    await denied(3, attendance); // Teacher not assigned to the session.
    await denied(4, attendance);
    await count(2, attendance, 1);
    await denied(2, attendance); // Unique student/session pair.
    await count(1, 'select * from public.education_student_attendance', 1);
    await count(3, 'select * from public.education_student_attendance', 0);
    await count(1, "update public.education_student_attendance set status='Late' returning id", 0);
    await count(2, "update public.education_student_attendance set status='Late' returning id", 1);
    await denied(2, "update public.education_student_attendance set status='Invalid'");
    await denied(2, `update public.education_student_attendance set recorded_by='${uid(1)}'`);
    const staff = `insert into public.education_staff_attendance(employee_id,attendance_date,status)
      values ('${uid(4)}','2026-10-27','Present') returning id`;
    await denied(2, staff);
    await denied(4, staff);
    await count(1, staff, 1);
    await denied(1, staff);
    await count(4, 'select * from public.education_staff_attendance', 1);
    await count(2, 'select * from public.education_staff_attendance', 0);
    await count(4, "update public.education_staff_attendance set status='Late' returning id", 0);
    await count(1, "update public.education_staff_attendance set status='Late' returning id", 1);
    await denied(1, 'delete from public.education_staff_attendance');
    await denied(2, 'delete from public.education_student_attendance');
    await denied(4, `insert into public.education_staff_roles values ('${uid(4)}','administrator')`);
    await denied(1, `insert into public.education_staff_roles values ('${uid(4)}','teacher')`);
    await count(4, 'select * from public.education_employees', 1);
    await count(1, 'select * from public.education_employees', 4);
    await db.exec('begin; set local role anon');
    await assert.rejects(() => db.query('select * from public.education_students'));
    await db.exec('rollback'); checks++;
    console.log(`${checks} local PostgreSQL permission checks passed (simulated Supabase Auth).`);
  } finally {
    await db.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
