'use strict';

async function loadCatalog(manager) {
  if (!manager) return {};
  const names = ['locations','programs','courses','subjects','teacher_locations','classes','enrollments','assessments','marks','mark_history'];
  const rows = await Promise.all(names.map(name => readAll(name,true)));
  return Object.fromEntries(names.map((name,index) => [name,rows[index]]));
}
const catalogRows = name => state.catalog?.[name] || [];
const catalogFind = (name,id) => catalogRows(name).find(row => row.id === id);
const catalogClassName = id => catalogFind('classes',id)?.name || 'Unclassified class';
function catalogCanTeach(id) {
  const lesson = catalogFind('classes',id);
  const location = catalogRows('teacher_locations').find(row => row.employee_id === state.employee?.id)?.location_id;
  return !!lesson && isTeacher() && lesson.teacher_id === state.employee?.id && lesson.location_id === location;
}
function catalogEnrollmentLabel(row) {
  return (row.student_name || state.students.find(s => s.id === row.student_id)?.display_name || row.student_id) + ' · ' + catalogClassName(row.class_id);
}
function catalogEligible(row,date) {
  return date && row.enrolled_on <= date && (!row.ended_on || row.ended_on >= date);
}
function updateAttendanceStudents() {
  const lesson = state.sessions.find(row => row.id === el('attendance-session').value);
  const eligible = catalogRows('enrollments').filter(row => row.class_id === lesson?.class_id && catalogEligible(row,lesson?.session_date));
  choices('attendance-student',state.students.filter(row => eligible.some(e => e.student_id === row.id)),
    row => row.display_name + ' · ' + row.student_number,'Choose enrolled student');
}
function updateLegacyClass() {
  const lesson=state.sessions.find(row=>row.id===el('legacy-session').value);
  choices('legacy-class',catalogRows('classes').filter(row=>row.active && row.teacher_id===lesson?.teacher_id),row=>row.name,'Choose reviewed class');
}
function updateClassFields() {
  const vocational = el('class-program').value === 'VOCATIONAL', cram = el('class-program').value === 'CRAM';
  el('course-fields').hidden = !vocational; el('cram-fields').hidden = !cram;
  el('class-course').disabled = !vocational; el('class-course').required = vocational;
  el('class-grade').disabled = !cram; el('class-grade').required = cram;
  el('class-shift').disabled = !cram; el('class-shift').required = cram;
  choices('class-course',catalogRows('courses').filter(row => row.program_code === el('class-program').value),row => row.name,'Choose course');
  choices('class-teacher',state.employees.filter(row => row.is_teacher && row.location_id === el('class-location').value),row => row.display_name,'Choose teacher at this location');
}
function updateEnrollmentFields() {
  const editing = !!el('enrollment-id').value;
  const lesson = catalogFind('classes',el('enrollment-class').value);
  choices('enrollment-student',state.students.filter(row => row.location_id === lesson?.location_id && (editing || row.active)),
    row => row.display_name + ' · ' + row.student_number,'Choose student at class location');
  el('enrollment-class').disabled = editing; el('enrollment-student').disabled = editing;
  const ended = el('enrollment-status').value !== 'ACTIVE';
  el('ended-on-field').hidden = !ended; el('ended-on').required = ended; el('ended-on').disabled = !ended;
  el('ended-on').min = el('enrolled-on').value;
}
function updateAssessmentFields() {
  const lesson = catalogFind('classes',el('assessment-class').value);
  choices('assessment-subject',catalogRows('subjects').filter(row => row.program_code === lesson?.program_code &&
    (lesson?.program_code === 'CRAM' || row.course_id === lesson?.course_id)),row => row.name,'Choose class subject');
  const assessment = catalogFind('assessments',el('mark-assessment').value);
  choices('mark-enrollment',catalogRows('enrollments').filter(row => row.class_id === assessment?.class_id && catalogEligible(row,assessment?.assessment_date)),
    catalogEnrollmentLabel,'Choose eligible student');
  const correcting = !!el('mark-id').value;
  el('mark-assessment').disabled = correcting; el('mark-enrollment').disabled = correcting;
}
function renderCatalog() {
  const manager = managesStudents(), admin = isAdmin();
  for (const id of ['catalog-section','enrollment-section','assessment-section']) el(id).hidden = !manager;
  el('catalog-admin').hidden = !admin; el('assessment-write').hidden = !isTeacher();
  el('legacy-link-section').hidden = !admin;
  choices('legacy-session',state.sessions.filter(row=>!row.class_id),row=>row.title+' · '+row.session_date,'Choose preserved session');
  updateLegacyClass();
  const locations = catalogRows('locations'), classes = catalogRows('classes');
  const ownLocation = catalogRows('teacher_locations').find(row => row.employee_id === state.employee?.id)?.location_id;
  el('catalog-summary').textContent = admin ? 'Manage Ndeja, Kura and Metuchira. Assign each teacher one location before creating classes.'
    : ownLocation ? 'Your location: ' + (catalogFind('locations',ownLocation)?.name || '') + '. Attendance and assessments are limited to your assigned classes.'
    : 'Ask an administrator to assign your location before creating teaching records.';
  choices('student-location',locations,row => row.name,'Choose student location');
  if (!admin && ownLocation) el('student-location').value = ownLocation;
  el('student-location').disabled = !admin;
  choices('location-teacher',state.employees.filter(row => row.is_teacher),row => row.display_name,'Choose teacher');
  choices('teacher-location',locations,row => row.name,'Choose location');
  choices('class-location',locations,row => row.name,'Choose location');
  choices('class-program',catalogRows('programs').map(row => ({ ...row,id:row.code })),row => row.name,'Choose program');
  if (!el('class-year').value) el('class-year').value = new Date().getFullYear();
  updateClassFields();
  choices('class-state-id',classes,row => row.name + (row.active ? ' · Active' : ' · Archived'),'Choose class');
  choices('session-class',classes.filter(row => row.active),row => row.name,'Choose class');
  choices('enrollment-class',classes.filter(row => row.active || !!el('enrollment-id').value),row => row.name,'Choose class');
  updateEnrollmentFields();
  const ownClasses = classes.filter(row => catalogCanTeach(row.id));
  choices('assessment-class',ownClasses.filter(row => row.active),row => row.name,'Choose your class');
  choices('mark-assessment',catalogRows('assessments').filter(row => ownClasses.some(c => c.id === row.class_id)),
    row => row.title + ' · ' + catalogClassName(row.class_id) + ' · ' + row.assessment_date,'Choose assessment');
  updateAssessmentFields(); updateAttendanceStudents();
  for (const id of ['teacher-locations-body','classes-body','enrollments-body','assessments-body','marks-body','mark-history-body']) el(id).replaceChildren();
  for (const row of catalogRows('teacher_locations')) tableRow('teacher-locations-body',[
    state.employees.find(e => e.id === row.employee_id)?.display_name || row.employee_id,catalogFind('locations',row.location_id)?.name]);
  for (const row of classes) tableRow('classes-body',[row.name,catalogFind('locations',row.location_id)?.name,
    row.program_code === 'VOCATIONAL' ? catalogFind('courses',row.course_id)?.name : 'Cram · Grade ' + row.grade_level + ' · ' + row.shift,
    row.academic_year,state.employees.find(e => e.id === row.teacher_id)?.display_name || row.teacher_id,row.active ? 'Active' : 'Archived']);
  for (const row of catalogRows('enrollments')) tableRow('enrollments-body',[row.student_name,catalogClassName(row.class_id),row.status,row.enrolled_on,row.ended_on], {
    label:'Edit',run:() => {
      el('enrollment-id').value = row.id; el('enrollment-class').value = row.class_id;
      el('enrollment-status').value = row.status; el('enrolled-on').value = row.enrolled_on; el('ended-on').value = row.ended_on || '';
      updateEnrollmentFields(); el('enrollment-student').value = row.student_id; el('enrollment-form').scrollIntoView({block:'center'});
    }
  });
  for (const row of catalogRows('assessments')) tableRow('assessments-body',[row.title,catalogClassName(row.class_id),catalogFind('subjects',row.subject_id)?.name,row.assessment_date]);
  for (const row of catalogRows('marks')) {
    const enrollment = catalogRows('enrollments').find(e => e.id === row.enrollment_id), assessment = catalogFind('assessments',row.assessment_id);
    const canCorrect = isTeacher() && ownClasses.some(c => c.id === row.class_id);
    tableRow('marks-body',[assessment?.title,enrollment?.student_name,row.mark,row.revision],canCorrect ? {
      label:'Correct',run:() => {
        el('mark-id').value = row.id; el('mark-revision').value = row.revision;
        el('mark-assessment').value = row.assessment_id; updateAssessmentFields();
        el('mark-enrollment').value = row.enrollment_id; el('mark-value').value = row.mark;
        el('mark-form').scrollIntoView({block:'center'});
      }
    } : null);
  }
  for (const row of catalogRows('mark_history')) {
    const mark = catalogFind('marks',row.mark_id), enrollment = catalogFind('enrollments',mark?.enrollment_id);
    tableRow('mark-history-body',[row.occurred_at,(enrollment?.student_name || '') + ' · ' + (catalogFind('assessments',mark?.assessment_id)?.title || ''),row.old_mark,row.new_mark,row.revision]);
  }
}
function requireSaved(rows) { if (!rows?.length) throw new Error('No record was saved. Refresh and check your permissions.'); }
bindSave('teacher-location-form','teacher-location-message',async () => {
  await rpc('education_assign_teacher_location',{p_employee_id:el('location-teacher').value,p_location_id:el('teacher-location').value});
});
bindSave('legacy-link-form','legacy-link-message',async () => {
  await rpc('education_link_legacy_session',{p_session_id:el('legacy-session').value,p_class_id:el('legacy-class').value});
});
bindSave('class-form','class-message',async () => {
  const vocational = el('class-program').value === 'VOCATIONAL';
  requireSaved(await rpc('education_create_class',{p_name:requiredText('class-name'),p_location_id:el('class-location').value,
    p_program_code:el('class-program').value,p_course_id:vocational ? el('class-course').value : null,
    p_grade_level:vocational ? null : Number(el('class-grade').value),p_shift:vocational ? null : el('class-shift').value,
    p_academic_year:Number(el('class-year').value),p_teacher_id:el('class-teacher').value}));
});
bindSave('class-state-form','class-state-message',async () => {
  await rpc('education_set_class_active',{p_class_id:el('class-state-id').value,p_active:el('class-state-active').value === 'true'});
});
bindSave('enrollment-form','enrollment-message',async () => {
  requireSaved(await rpc('education_save_enrollment',{p_id:el('enrollment-id').value || null,p_student_id:el('enrollment-student').value,
    p_class_id:el('enrollment-class').value,p_status:el('enrollment-status').value,p_enrolled_on:el('enrolled-on').value,
    p_ended_on:el('enrollment-status').value === 'ACTIVE' ? null : el('ended-on').value}));
});
bindSave('assessment-form','assessment-message',async () => {
  requireSaved(await rpc('education_create_assessment',{p_class_id:el('assessment-class').value,p_subject_id:el('assessment-subject').value,
    p_title:requiredText('assessment-title'),p_assessment_date:el('assessment-date').value}));
});
bindSave('mark-form','mark-message',async () => {
  requireSaved(await rpc('education_save_mark',{p_id:el('mark-id').value || null,p_assessment_id:el('mark-assessment').value,
    p_enrollment_id:el('mark-enrollment').value,p_mark:Number(el('mark-value').value),
    p_expected_revision:el('mark-id').value ? Number(el('mark-revision').value) : null}));
});
for (const id of ['class-program','class-location']) el(id).addEventListener('change',updateClassFields);
for (const id of ['enrollment-class','enrollment-status','enrolled-on']) el(id).addEventListener('change',updateEnrollmentFields);
for (const id of ['assessment-class','mark-assessment']) el(id).addEventListener('change',updateAssessmentFields);
el('attendance-session').addEventListener('change',updateAttendanceStudents);
el('legacy-session').addEventListener('change',updateLegacyClass);
