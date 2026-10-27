// Stateful fictional API fixture. All Supabase calls are intercepted by Playwright.
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function installUXFixture(page,role='teacher') {
 const employee={id:uid(1),auth_user_id:uid(1000),display_name:'Fictional Teacher',is_teacher:true,location_id:uid(7)};
 const students=Array.from({length:25},(_,i)=>({id:uid(200+i),student_number:'S'+String(i+1).padStart(3,'0'),display_name:'Fictional Student '+String(i+1).padStart(2,'0'),location_id:uid(i===24?8:7),active:true}));
 const lesson={id:uid(4),title:'Morning lesson',session_date:'2026-10-28',teacher_id:employee.id,class_id:uid(10)};
 const catalog={locations:[{id:uid(7),name:'Ndeja'},{id:uid(8),name:'Kura'},{id:uid(9),name:'Metuchira'}],
  programs:[{code:'VOCATIONAL',name:'Vocational Training'}],courses:[{id:uid(11),program_code:'VOCATIONAL',name:'Electricity'}],subjects:[],
  teacher_locations:[{employee_id:employee.id,location_id:uid(7)}],classes:[{id:uid(10),name:'Electricity N',location_id:uid(7),program_code:'VOCATIONAL',course_id:uid(11),academic_year:2026,teacher_id:employee.id,active:true}],
  enrollments:students.slice(0,3).map((s,i)=>({id:uid(300+i),student_id:s.id,student_name:s.display_name,class_id:uid(10),status:'ACTIVE',enrolled_on:'2026-01-01',ended_on:null})),
  assessments:[],marks:[],mark_history:[]};
 const fixture={employee,students,lesson,catalog,writes:[],reads:[],failStudents:new Set(),uncertainStudents:new Set(),commitUncertain:false,failRefresh:false,failRefreshAfterWrite:false,holdStudent:null,release:null};
 const attendance=[{id:uid(400),session_id:lesson.id,student_id:students[0].id,status:'Present'},{id:uid(401),session_id:lesson.id,student_id:students[1].id,status:'Absent'}];
 await page.route('https://stzxapveaocuzbidpfng.supabase.co/**',async route=>{
  const request=route.request(),url=new URL(request.url()),name=url.pathname.split('/').pop(),body=request.postDataJSON();
  const reply=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  if(url.pathname==='/auth/v1/token')return reply({access_token:'fictional-token',refresh_token:'fictional-refresh',expires_in:3600});
  if(url.pathname==='/auth/v1/user')return reply({id:employee.auth_user_id});
  if(url.pathname==='/auth/v1/logout')return route.fulfill({status:204});
  if(!url.pathname.startsWith('/rest/v1/rpc/'))throw Error('Unexpected direct table request');
  if(name==='education_get_access')return reply({allowed:true,employee,roles:[role]});
  if(name==='education_list_records'||name==='education_domain_list'){
   fixture.reads.push(body.p_resource);
   if(fixture.failRefresh)return reply({message:'Records are temporarily unavailable'},503);
   if(body.p_offset>0)return reply([]);
   const data=name==='education_domain_list'?catalog:{employees:[employee],students:role==='administrator'?students:students.filter(s=>s.location_id===uid(7)),sessions:[lesson,{...lesson,id:uid(5),title:'Next lesson',session_date:'2026-10-29'}],student_attendance:attendance,staff_attendance:[],roles:[{code:'teacher',label:'Teacher'}],user_roles:[],role_audit:[]};
   return reply(data[body.p_resource]||[]);
  }
  fixture.writes.push({name,body});
  if(name==='education_save_student_attendance'){
   if(fixture.holdStudent===body.p_student_id)await new Promise(resolve=>fixture.release=resolve);
   if(fixture.failStudents.has(body.p_student_id))return reply({code:'23514',message:'Enrollment needs review'},400);
   const record={id:body.p_id||uid(500+fixture.writes.length),session_id:body.p_session_id,student_id:body.p_student_id,status:body.p_status};
   if(!fixture.uncertainStudents.has(body.p_student_id)||fixture.commitUncertain){const index=attendance.findIndex(r=>r.id===record.id);if(index<0)attendance.push(record);else attendance[index]=record;}
   if(fixture.uncertainStudents.has(body.p_student_id))return route.abort('failed');
   return reply([record]);
  }
  if(name==='education_save_student_profile'){
   const record={id:body.p_id||uid(9000),student_number:body.p_student_number,display_name:body.p_display_name,location_id:body.p_location_id,active:body.p_active};
   const index=students.findIndex(s=>s.id===record.id);if(index<0)students.push(record);else students[index]=record;
   if(fixture.failRefreshAfterWrite)fixture.failRefresh=true;
   return reply([record]);
  }
  return reply([{id:uid(9999),...body}]);
 });
 return fixture;
}
module.exports={installUXFixture,uid};
