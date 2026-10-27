// Isolated database tests: no hosted connections or real account credentials.
const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
(async () => {
 const db = new PGlite(); let checks=0;
 const migration = async name => db.exec(fs.readFileSync(path.join(__dirname,'../migrations',name),'utf8'));
 async function asUser(n,sql,params=[]) {
  await db.exec('begin; set local role authenticated');
  try {
   await db.query("select set_config('request.jwt.claim.sub',$1,true)",[uid(n)]);
   const result=await db.query(sql,params); await db.exec('commit');return result.rows;
  } catch(error) {await db.exec('rollback');throw error;}
 }
 async function rpc(n,name,args=[]) {
  return (await asUser(n,`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args))[0].result;
 }
 async function denied(n,name,args=[]) {await assert.rejects(()=>rpc(n,name,args));checks++;}
 async function list(n,resource) {return rpc(n,'education_domain_list',[resource,0,100]);}
 async function eq(actual,expected) {assert.deepEqual(actual,expected);checks++;}
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   grant usage on schema auth to authenticated;`);
  await migration('20261027000100_create_education_employees.sql');
  await migration('20261027000200_education_roles_students_attendance.sql');
  for(let i=1;i<=6;i++) await db.query('insert into auth.users values($1);',[uid(i)]);
  for(let i=1;i<=5;i++) await db.query('insert into public.education_employees(id,auth_user_id,display_name) values($1,$1,$2)',[uid(i),'Fictional '+i]);
  await db.exec(`insert into public.education_staff_roles values ('${uid(1)}','administrator'),('${uid(2)}','teacher'),('${uid(3)}','teacher'),('${uid(5)}','teacher');
   insert into public.education_students(id,student_number,display_name) values('${uid(100)}','LEGACY','Legacy Fictional');
   insert into public.education_sessions(id,title,session_date,teacher_id) values('${uid(101)}','Legacy session','2026-10-01','${uid(2)}');
   insert into public.education_student_attendance(id,session_id,student_id,status,recorded_by) values('${uid(102)}','${uid(101)}','${uid(100)}','Present','${uid(2)}');`);
  await migration('20261027000300_tcms_rpc_and_module_access.sql');
  await rpc(1,'education_assign_role',[uid(4),'staff',true]);
  await migration('20261028000400_catalog_enrollment_assessment.sql');checks++;
  await eq((await db.query('select location_id from public.education_students where id=$1',[uid(100)])).rows[0].location_id,null);
  await eq((await db.query('select status from public.education_student_attendance where id=$1',[uid(102)])).rows[0].status,'Present');
  const locations=await list(1,'locations');await eq(locations.map(r=>r.name).sort(),['Kura','Metuchira','Ndeja']);
  const N=locations.find(r=>r.name==='Ndeja').id,K=locations.find(r=>r.name==='Kura').id;
  await eq((await list(1,'programs')).length,2);const courses=await list(1,'courses');await eq(courses.length,4);
  const E=courses.find(r=>r.name==='Electricity').id,B=courses.find(r=>r.name==='Bakery').id;
  const subjects=await list(1,'subjects');await eq(subjects.length,8);
  await denied(4,'education_domain_list',['locations',0,100]);await denied(6,'education_domain_list',['locations',0,100]);
  await denied(1,'education_domain_list',['unknown',0,100]);await denied(1,'education_domain_list',['locations',0,501]);
  await eq((await list(2,'locations')).length,0);
  await denied(2,'education_assign_teacher_location',[uid(2),N]);
  await denied(1,'education_assign_teacher_location',[uid(4),N]);
  await rpc(1,'education_assign_teacher_location',[uid(2),N]);await rpc(1,'education_assign_teacher_location',[uid(3),K]);
  await rpc(1,'education_assign_teacher_location',[uid(5),N]);
  await eq((await list(2,'locations')).map(r=>r.id),[N]);
  await eq((await list(2,'teacher_locations')).length,1);
  await eq((await db.query('select count(*)::int as n from public.education_teacher_locations where employee_id=$1',[uid(2)])).rows[0].n,1);
  await denied(2,'education_save_student_profile',[null,'X','Wrong location',K,true]);
  const S=(await rpc(2,'education_save_student_profile',[null,'N001','Fictional A',N,true]))[0];
  const T=(await rpc(3,'education_save_student_profile',[null,'K001','Fictional B',K,true]))[0];
  await denied(2,'education_save_student_profile',[T.id,'K001','Intrusion',N,true]);
  await eq((await rpc(2,'education_list_records',['students',0,100])).map(r=>r.id),[S.id]);
  await eq((await rpc(1,'education_list_records',['students',0,100])).length,3);
  await denied(2,'education_save_student',[null,'OLD','Bypass']);
  await denied(1,'education_save_session',['Bypass','2026-10-28',uid(2)]);
  await denied(2,'education_create_class',['Unauthorized',N,'VOCATIONAL',E,null,null,2026,uid(2)]);
  await denied(1,'education_create_class',['Wrong teacher',N,'VOCATIONAL',E,null,null,2026,uid(3)]);
  await denied(1,'education_create_class',['Invalid Cram',K,'CRAM',E,3,'MORNING',2026,uid(3)]);
  await denied(1,'education_create_class',['Invalid grade',K,'CRAM',null,9,'MORNING',2026,uid(3)]);
  await denied(1,'education_create_class',['No grade',K,'CRAM',null,null,'MORNING',2026,uid(3)]);
  await denied(1,'education_create_class',['No shift',K,'CRAM',null,3,null,2026,uid(3)]);
  const C=(await rpc(1,'education_create_class',['Electricity N',N,'VOCATIONAL',E,null,null,2026,uid(2)]))[0];
  const D=(await rpc(1,'education_create_class',['Bakery N',N,'VOCATIONAL',B,null,null,2026,uid(5)]))[0];
  const R=(await rpc(1,'education_create_class',['Cram K',K,'CRAM',null,3,'MORNING',2026,uid(3)]))[0];
  await eq((await list(2,'classes')).map(r=>r.id),[C.id]);
  await denied(1,'education_assign_teacher_location',[uid(2),K]);
  await denied(3,'education_save_enrollment',[null,S.id,C.id,'ACTIVE','2026-10-01',null]);
  await denied(2,'education_save_enrollment',[null,T.id,C.id,'ACTIVE','2026-10-01',null]);
  const en=(await rpc(2,'education_save_enrollment',[null,S.id,C.id,'ACTIVE','2026-10-01',null]))[0];
  await denied(1,'education_save_enrollment',[null,S.id,D.id,'ACTIVE','2026-10-01',null]);
  await denied(2,'education_save_enrollment',[null,S.id,C.id,'ACTIVE','2026-10-01',null]);
  await denied(1,'education_save_enrollment',[en.id,S.id,C.id,'WITHDRAWN','2026-10-01','2026-09-01']);
  await denied(1,'education_save_student_profile',[S.id,'N001','Fictional A',K,true]);
  await denied(1,'education_save_student_profile',[S.id,'N001','Fictional A',N,false]);
  const cramEn=(await rpc(3,'education_save_enrollment',[null,T.id,R.id,'ACTIVE','2026-10-01',null]))[0];
  await eq((await list(2,'enrollments')).length,1);
  await denied(3,'education_create_class_session',[C.id,'Other teacher','2026-10-28']);
  const session=(await rpc(2,'education_create_class_session',[C.id,'Electricity session','2026-10-28']))[0];
  await denied(1,'education_save_student_attendance',[null,session.id,S.id,'Present']);
  await denied(3,'education_save_student_attendance',[null,session.id,S.id,'Present']);
  await denied(2,'education_save_student_attendance',[null,session.id,T.id,'Present']);
  const early=(await rpc(2,'education_create_class_session',[C.id,'Early','2026-09-28']))[0];
  await denied(2,'education_save_student_attendance',[null,early.id,S.id,'Present']);
  await rpc(2,'education_save_student_attendance',[null,session.id,S.id,'Present']);checks++;
  await denied(2,'education_save_student_attendance',[null,session.id,S.id,'Present']);
  await denied(2,'education_save_student_attendance',[uid(102),session.id,S.id,'Late']);
  await eq((await rpc(2,'education_list_records',['sessions',0,100])).length,2);
  await eq((await rpc(1,'education_list_records',['sessions',0,100])).length,3);
  await denied(2,'education_link_legacy_session',[uid(101),C.id]);
  await denied(1,'education_link_legacy_session',[uid(101),D.id]);
  await denied(1,'education_link_legacy_session',[uid(101),C.id]);
  await rpc(1,'education_save_student_profile',[uid(100),'LEGACY','Legacy Fictional',N,true]);
  const legacyEnrollment=(await rpc(1,'education_save_enrollment',[null,uid(100),C.id,'ACTIVE','2026-09-01',null]))[0];
  await rpc(1,'education_link_legacy_session',[uid(101),C.id]);checks++;
  await eq((await db.query('select status from public.education_student_attendance where id=$1',[uid(102)])).rows[0].status,'Present');
  await denied(1,'education_link_legacy_session',[uid(101),C.id]);
  const electrical=subjects.find(r=>r.name==='Electricity'),math=subjects.find(r=>r.name==='Mathematics');
  const bakery=subjects.find(r=>r.name==='Bakery');
  await denied(1,'education_create_assessment',[C.id,electrical.id,'Admin test','2026-10-29']);
  await denied(3,'education_create_assessment',[C.id,electrical.id,'Other teacher','2026-10-29']);
  await denied(2,'education_create_assessment',[C.id,math.id,'Wrong program','2026-10-29']);
  await denied(2,'education_create_assessment',[C.id,bakery.id,'Wrong course','2026-10-29']);
  const A=(await rpc(2,'education_create_assessment',[C.id,electrical.id,'Practical test','2026-10-29']))[0];
  await rpc(3,'education_create_assessment',[R.id,math.id,'Math test','2026-10-29']);checks++;
  await denied(3,'education_save_mark',[null,A.id,en.id,10,null]);
  await denied(1,'education_save_mark',[null,A.id,en.id,10,null]);
  await denied(2,'education_save_mark',[null,A.id,cramEn.id,10,null]);
  await denied(2,'education_save_mark',[null,A.id,en.id,-1,null]);
  await denied(2,'education_save_mark',[null,A.id,en.id,20.001,null]);
  const M=(await rpc(2,'education_save_mark',[null,A.id,en.id,0,null]))[0];await eq(Number(M.mark),0);
  await denied(2,'education_save_mark',[null,A.id,en.id,10,null]);
  await denied(2,'education_save_mark',[M.id,A.id,en.id,15,0]);
  const corrected=(await rpc(2,'education_save_mark',[M.id,A.id,en.id,20,1]))[0];await eq(corrected.revision,2);await eq(Number(corrected.mark),20);
  await denied(2,'education_save_mark',[M.id,A.id,en.id,19,1]);
  const history=await list(2,'mark_history');await eq(history.length,2);
  await eq(history.every(r=>r.actor_auth_user_id===uid(2)),true);await eq((await list(3,'marks')).length,0);
  await eq((await list(1,'marks')).length,1);
  await denied(1,'education_save_enrollment',[en.id,S.id,C.id,'COMPLETED','2026-10-01','2026-10-27']);
  await denied(1,'education_save_enrollment',[en.id,S.id,C.id,'COMPLETED','2026-10-01','2026-10-28']);
  await denied(1,'education_set_class_active',[C.id,false]);
  await rpc(2,'education_save_enrollment',[en.id,S.id,C.id,'COMPLETED','2026-10-01','2026-10-31']);checks++;
  await rpc(1,'education_save_enrollment',[legacyEnrollment.id,uid(100),C.id,'COMPLETED','2026-09-01','2026-10-31']);
  await rpc(2,'education_save_mark',[M.id,A.id,en.id,12.5,2]);checks++;
  const lateAssessment=(await rpc(2,'education_create_assessment',[C.id,electrical.id,'November test','2026-11-01']))[0];
  await denied(2,'education_save_mark',[null,lateAssessment.id,en.id,10,null]);
  await rpc(1,'education_save_enrollment',[null,S.id,D.id,'ACTIVE','2026-11-01',null]);
  await denied(2,'education_save_enrollment',[en.id,S.id,C.id,'ACTIVE','2026-10-01',null]);
  const november=(await rpc(2,'education_create_class_session',[C.id,'November','2026-11-01']))[0];
  await denied(2,'education_save_student_attendance',[null,november.id,S.id,'Present']);
  await rpc(1,'education_set_class_active',[C.id,false]);checks++;
  await denied(2,'education_create_class_session',[C.id,'Archived','2026-11-01']);
  await rpc(1,'education_set_class_active',[C.id,true]);checks++;
  await rpc(1,'education_set_class_active',[C.id,false]);
  await rpc(1,'education_assign_teacher_location',[uid(2),K]);checks++;
  await denied(2,'education_save_mark',[M.id,A.id,en.id,10,3]);
  await denied(1,'education_set_class_active',[C.id,true]);
  for(const resource of ['education_locations','education_programs','education_courses','education_subjects','education_teacher_locations',
   'education_classes','education_enrollments','education_assessments','education_marks','education_mark_history']) {
   await assert.rejects(()=>asUser(1,'select * from public.'+resource));checks++;
  }
  await assert.rejects(()=>asUser(1,"select education_private.education_list_records_v3('students',0,100)"));checks++;
  await db.exec('begin;set local role anon');await assert.rejects(()=>db.query("select public.education_domain_list('locations',0,100)"));await db.exec('rollback');checks++;
  const disabled=await db.query("select relname from pg_class where relnamespace='public'::regnamespace and relname like 'education_%' and relkind='r' and not relrowsecurity");
  await eq(disabled.rows.length,0);
  console.log(`${checks} catalog/enrollment/assessment database checks passed with simulated Auth.`);
 } finally {await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
