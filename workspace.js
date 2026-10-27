'use strict';

// Presentation only. Existing RPCs remain the authority for all record access/writes.
const workspaceUI = { view:'dashboard', tables:new Map(), rosterSession:'', roster:new Map(), dataVersion:0, rosterVersion:0 };
function workspaceDataRefreshed() { workspaceUI.dataVersion++; }
const workspaceViews = [
  ['dashboard','Dashboard',['dashboard-section'],'all'],
  ['students','Students',['students-section'],'teaching'],
  ['classes','Classes & locations',['catalog-section'],'teaching'],
  ['enrollment','Enrollment',['enrollment-section'],'teaching'],
  ['sessions','Sessions',['sessions-section'],'teaching'],
  ['attendance','Student attendance',['student-attendance-section','student-records-section'],'teaching'],
  ['assessments','Assessments',['assessment-section'],'teaching'],
  ['staff','Staff attendance',['staff-attendance-section','staff-records-section'],'all'],
  ['administration','Administration',['roles-section'],'admin']
];
const workspaceAllowed = view => state.allowed && (view[3]==='all' || (view[3]==='admin' ? isAdmin() : managesStudents()));
for (const view of workspaceViews) for (const id of view[2]) el(id).dataset.workspaceView=view[0];

function navigateWorkspace(name, focus=true) {
  const view=workspaceViews.find(row=>row[0]===name && workspaceAllowed(row));
  if (!view) return;
  workspaceUI.view=name;
  for (const section of document.querySelectorAll('[data-workspace-view]')) section.classList.toggle('view-hidden',section.dataset.workspaceView!==name);
  for (const button of el('workspace-nav').querySelectorAll('button')) {
    if (button.dataset.view===name) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
  }
  if (focus) {
    const section=view[2].map(id=>el(id)).find(node=>!node.hidden), heading=section?.querySelector('h2');
    if (heading) { heading.tabIndex=-1; heading.focus({preventScroll:true}); heading.scrollIntoView({block:'start'}); }
  }
}
function updateBusyUI() {
  el('refresh').disabled=busy;
  el('refresh').textContent=busy ? 'Working…' : 'Refresh records';
  el('data-fields').setAttribute('aria-busy',String(busy));
  for (const button of el('workspace-nav').querySelectorAll('button')) button.disabled=busy;
  updateRosterSummary();
}
async function refreshWorkspace() {
  const refreshed=await loadData();
  if(refreshed) message('operation-message','Records refreshed. Review any pending choices before saving.');
}
function resetWorkspaceUI() {
  workspaceUI.view='dashboard'; workspaceUI.rosterSession=''; workspaceUI.roster.clear();
  workspaceUI.dataVersion=workspaceUI.rosterVersion=0;
  el('workspace-nav').hidden=true; el('roster-body').replaceChildren();
  el('workspace-nav').replaceChildren();el('dashboard-stats').replaceChildren();el('dashboard-tasks').replaceChildren();
  el('scope-context').textContent='';el('dashboard-intro').textContent='';
  el('single-attendance').open=false;
  for (const control of workspaceUI.tables.values()) {
    control.search.value=''; control.page=0;control.rows=[];control.count.textContent='';control.previous.disabled=control.next.disabled=true;
    for (const filter of control.filters) filter.select.value='';
  }
  for(const form of el('workspace').querySelectorAll('form')) {form.reset();for(const field of form.querySelectorAll('input[type=hidden]'))field.value='';}
  for (const form of document.forms) clearFormErrors(form);
  for (const toggle of document.querySelectorAll('[data-password]')) {
    el(toggle.dataset.password).type='password'; toggle.setAttribute('aria-pressed','false');
    toggle.textContent=toggle.dataset.showLabel;
    toggle.setAttribute('aria-label',toggle.dataset.showAria);
  }
}
function renderWorkspaceUI() {
  const permitted=workspaceViews.filter(workspaceAllowed);
  const nav=el('workspace-nav'); nav.hidden=!state.allowed; nav.replaceChildren();
  for (const view of permitted) {
    const button=document.createElement('button');button.type='button';button.textContent=view[0]==='staff'&&!isAdmin() ? 'My attendance' : view[1];button.dataset.view=view[0];
    button.setAttribute('aria-controls',view[2][0]);button.addEventListener('click',()=>navigateWorkspace(view[0]));nav.appendChild(button);
  }
  if (state.allowed && !permitted.some(row=>row[0]===workspaceUI.view)) workspaceUI.view='dashboard';
  const location=catalogRows('teacher_locations').find(row=>row.employee_id===state.employee?.id)?.location_id;
  el('scope-context').textContent=state.allowed ? (isAdmin() ? 'Administrator access · All three locations' :
    isTeacher() ? 'Teaching location: '+(catalogFind('locations',location)?.name || 'Not assigned — contact your administrator') : 'Personal attendance access') : '';
  renderDashboard(); if(state.allowed)renderRoster(); enhanceTables();
  navigateWorkspace(workspaceUI.view,false);updateBusyUI();
}
function renderDashboard() {
  el('dashboard-intro').textContent=isAdmin() ? 'Manage Education records across all three locations. Start with location and class setup.' :
    isTeacher() ? 'Your assigned classes, student attendance and assessment records are available below.' : 'Your administrator records staff attendance. You can review your own records here.';
  const stats=el('dashboard-stats');stats.replaceChildren();
  const metrics=managesStudents() ? [[state.students.length,'Students in your view','students'],
    [catalogRows('classes').filter(r=>r.active).length,'Active classes','classes'],[state.sessions.length,'Class sessions','sessions'],
    [catalogRows('assessments').length,'Assessments','assessments']] : [[state.staffAttendance.length,'My attendance records','staff']];
  for (const [number,label,view] of metrics) {
    const button=document.createElement('button');button.type='button';button.className='stat-card';
    const value=document.createElement('strong'),text=document.createElement('span');value.textContent=number;text.textContent=label;
    button.append(value,text);button.addEventListener('click',()=>navigateWorkspace(view));stats.appendChild(button);
  }
  const tasks=el('dashboard-tasks');tasks.replaceChildren();
  const add=(text,label,view)=>{
    const row=document.createElement('div'),p=document.createElement('p'),button=document.createElement('button');row.className='dashboard-task';
    p.textContent=text;button.type='button';button.textContent=label;button.addEventListener('click',()=>navigateWorkspace(view));row.append(p,button);tasks.appendChild(row);
  };
  if (isAdmin()) {
    const teachers=state.employees.filter(r=>r.is_teacher&&!r.location_id).length;
    const students=state.students.filter(r=>!r.location_id).length;
    if (teachers) add(teachers+' teacher(s) need a location assignment.','Assign locations','classes');
    if (students) add(students+' preserved student profile(s) need a location review.','Review students','students');
    add('Create classes, assign teachers and review the course catalog.','Manage classes','classes');
  }
  if (isTeacher()) add('Choose a session and review the class register before saving attendance.','Take student attendance','attendance');
  if (!managesStudents()) add('Review the attendance recorded for you.','View my attendance','staff');
}

// Search/pagination apply only to records the existing server-authorized readers returned.
function enhanceTables() {
  for (const wrapper of document.querySelectorAll('#data-fields .scroll')) {
    const table=wrapper.querySelector('table'),body=table?.tBodies[0];
    if (!body?.id) continue;
    if(body.id==='roster-body'){wrapper.tabIndex=0;wrapper.setAttribute('role','region');wrapper.setAttribute('aria-label','Class attendance register, horizontally scrollable');continue;}
    let control=workspaceUI.tables.get(body.id);
    if (!control) {
      const title=table.caption?.textContent || 'records',tools=document.createElement('div');tools.className='table-tools';
      const label=document.createElement('label'),search=document.createElement('input');search.type='search';search.placeholder='Search records';search.className='table-search';
      search.id=body.id+'-search';label.htmlFor=search.id;label.append(document.createTextNode('Search '+title.toLowerCase()),search);tools.appendChild(label);
      const count=document.createElement('p');count.className='table-count';count.setAttribute('role','status');
      const pager=document.createElement('div');pager.className='table-pager';
      const previous=document.createElement('button'),next=document.createElement('button');previous.type=next.type='button';
      previous.textContent='Previous';next.textContent='Next';previous.className=next.className='secondary';
      previous.setAttribute('aria-label','Previous page of '+title.toLowerCase());next.setAttribute('aria-label','Next page of '+title.toLowerCase());pager.append(previous,count,next);
      wrapper.before(tools);wrapper.after(pager);wrapper.tabIndex=0;wrapper.setAttribute('role','region');wrapper.setAttribute('aria-label',title+' table, horizontally scrollable');
      control={body,search,tools,count,previous,next,page:0,filters:[]};workspaceUI.tables.set(body.id,control);
      search.addEventListener('input',()=>{control.page=0;filterTable(control);});
      previous.addEventListener('click',()=>{control.page--;filterTable(control);});next.addEventListener('click',()=>{control.page++;filterTable(control);});
      const definitions=body.id==='students-body' ? [[2,'Location'],[3,'Status']] : body.id==='classes-body' ? [[1,'Location'],[5,'Status']] : [];
      for (const [column,name] of definitions) {
        const label=document.createElement('label'),select=document.createElement('select');select.id=body.id+'-filter-'+column;
        label.htmlFor=select.id;label.append(document.createTextNode(name),select);tools.appendChild(label);
        control.filters.push({column,select,name});select.addEventListener('change',()=>{control.page=0;filterTable(control);});
      }
    }
    for (const row of [...body.rows]) if (row.dataset.empty) row.remove();
    control.rows=[...body.rows];
    for (const filter of control.filters) {
      const current=filter.select.value,values=[...new Set(control.rows.map(row=>row.cells[filter.column]?.textContent).filter(Boolean))].sort();
      filter.select.replaceChildren(new Option('All '+filter.name.toLowerCase()+' options',''));
      for (const value of values) filter.select.add(new Option(value,value));
      if (values.includes(current)) filter.select.value=current;
    }
    filterTable(control);
  }
}
function filterTable(control) {
  for (const row of [...control.body.rows]) if (row.dataset.empty) row.remove();
  const query=control.search.value.trim().toLocaleLowerCase();
  const rows=control.rows.filter(row=>row.textContent.toLocaleLowerCase().includes(query) && control.filters.every(f=>!f.select.value || row.cells[f.column]?.textContent===f.select.value));
  const pageCount=Math.max(1,Math.ceil(rows.length/10));control.page=Math.min(Math.max(0,control.page),pageCount-1);
  const visible=new Set(rows.slice(control.page*10,control.page*10+10));for(const row of control.rows) row.hidden=!visible.has(row);
  control.previous.disabled=control.page===0;control.next.disabled=control.page>=pageCount-1;
  control.count.textContent=rows.length ? 'Showing '+(control.page*10+1)+'–'+Math.min(rows.length,control.page*10+10)+' of '+rows.length : '0 records';
  if (!rows.length) {
    const row=control.body.insertRow();row.dataset.empty='true';const cell=row.insertCell();cell.colSpan=control.body.closest('table').tHead.rows[0].cells.length;
    cell.className='empty-state';cell.textContent=control.rows.length ? 'No matching records. Clear the search or filters to see more.' : 'No records yet.';
  }
}

function renderRoster() {
  const current=workspaceUI.rosterSession;
  const sessions=state.sessions.filter(row=>catalogCanTeach(row.class_id) && row.teacher_id===state.employee?.id);
  choices('roster-session',sessions,row=>row.title+' · '+row.session_date,'Choose your class session');
  if (sessions.some(row=>row.id===current)) el('roster-session').value=current;
  else {workspaceUI.rosterSession='';workspaceUI.roster.clear();}
  const lesson=sessions.find(row=>row.id===workspaceUI.rosterSession);
  const eligible=catalogRows('enrollments').filter(row=>row.class_id===lesson?.class_id && catalogEligible(row,lesson?.session_date));
  const previous=workspaceUI.roster,newRows=new Map();
  const fresh=workspaceUI.dataVersion!==workspaceUI.rosterVersion;workspaceUI.rosterVersion=workspaceUI.dataVersion;
  for (const enrollment of eligible) {
    const profile=state.students.find(row=>row.id===enrollment.student_id);
    const saved=state.studentAttendance.find(row=>row.session_id===lesson.id&&row.student_id===enrollment.student_id);
    const old=previous.get(enrollment.student_id),value=old?.dirty ? old.value : saved?.status || '';
    newRows.set(enrollment.student_id,{name:enrollment.student_name || profile?.display_name || 'Student',number:profile?.student_number || '',
      value,original:saved?.status || '',recordId:saved?.id || null,dirty:value!==(saved?.status || ''),
      uncertain:!!old?.uncertain&&!fresh,needsRefresh:!!old?.needsRefresh&&!fresh,
      result:old?.uncertain ? (fresh ? (value===(saved?.status||'') ? 'Confirmed on refresh' : 'Refreshed — review before saving') : old.result) : fresh ? '' : old?.result || ''});
  }
  workspaceUI.roster=newRows;const body=el('roster-body');body.replaceChildren();
  for (const [id,row] of newRows) {
    const tr=body.insertRow(),name=tr.insertCell(),input=tr.insertCell(),result=tr.insertCell();name.textContent=row.name+(row.number ? ' · '+row.number : '');
    const select=document.createElement('select');select.setAttribute('aria-label','Attendance status for '+row.name);select.add(new Option('Choose status',''));
    for (const status of ['Present','Absent','Late']) select.add(new Option(status,status));select.value=row.value;input.appendChild(select);
    row.select=select;row.resultCell=result;select.addEventListener('change',()=>{row.value=select.value;row.dirty=row.value!==row.original;row.result='';updateRosterSummary();});
  }
  if (!newRows.size) {const cell=body.insertRow().insertCell();cell.colSpan=3;cell.className='empty-state';cell.textContent=lesson ? 'No students were enrolled on this session date. Review enrollment first.' : 'Choose a session to load its enrolled students.';}
  updateRosterSummary();
}
function updateRosterSummary() {
  const rows=[...workspaceUI.roster.values()],dirty=rows.filter(row=>row.dirty).length;
  for (const row of rows) {row.resultCell.textContent=row.result || (row.dirty ? 'Unsaved choice' : row.original ? 'Saved: '+row.original : 'Not recorded');row.resultCell.classList.toggle('error',!!row.uncertain || row.result?.startsWith('Not saved'));}
  message('roster-summary',rows.length ? rows.length+' enrolled student(s) · '+dirty+' unsaved choice(s).' : '');
  el('roster-present').disabled=!rows.length || busy || rows.some(row=>row.uncertain||row.needsRefresh);el('roster-discard').disabled=!dirty || busy;
  el('roster-save').disabled=!dirty || busy || rows.some(row=>row.uncertain||row.needsRefresh);
}
el('roster-session').addEventListener('change',()=>{
  if ([...workspaceUI.roster.values()].some(row=>row.dirty)) {
    el('roster-session').value=workspaceUI.rosterSession;message('roster-summary','Save or discard the unsaved choices before changing sessions.',true);return;
  }
  workspaceUI.rosterSession=el('roster-session').value;workspaceUI.roster.clear();renderRoster();
});
el('roster-present').addEventListener('click',()=>{
  for(const row of workspaceUI.roster.values()) {row.value='Present';row.select.value='Present';row.dirty=row.original!=='Present';row.result='';}
  updateRosterSummary();
});
el('roster-discard').addEventListener('click',()=>{
  if([...workspaceUI.roster.values()].some(row=>row.uncertain)){message('roster-summary','Refresh records to check the unconfirmed saves before discarding or retrying.',true);return;}
  for(const row of workspaceUI.roster.values()) {row.dirty=false;row.uncertain=false;}
  renderRoster();
});
el('roster-save').addEventListener('click',async()=>{
  const lesson=state.sessions.find(row=>row.id===workspaceUI.rosterSession);
  if (busy || !lesson || !catalogCanTeach(lesson.class_id)) return;
  const blank=[...workspaceUI.roster.values()].find(row=>row.dirty&&!row.value);
  if(blank){blank.select.focus();message('roster-summary','Choose a status for every changed student before saving.',true);return;}
  const pending=[...workspaceUI.roster.entries()].filter(([,row])=>row.dirty&&row.value&&!row.uncertain&&!row.needsRefresh);
  if (!pending.length) {message('roster-summary','Choose an attendance status before saving.',true);return;}
  const epoch=generation;let saved=0,failed=0,unconfirmed=0;
  busy=true;el('data-fields').disabled=true;updateBusyUI();
  message('operation-message','Saving attendance for '+pending.length+' changed student record(s). Keep this page open.');
  try {
    for(const [studentId,row] of pending) {
      if (epoch!==generation) return;
      row.result='Saving…';updateRosterSummary();
      try {
        const result=await rpc('education_save_student_attendance',{p_id:row.recordId,p_session_id:lesson.id,p_student_id:studentId,p_status:row.value});
        if (epoch!==generation) return;
        if (!result?.[0]?.id || result[0].student_id!==studentId || result[0].session_id!==lesson.id || result[0].status!==row.value) throw new Error('Save response could not be verified.');
        row.recordId=result[0].id;row.original=row.value;row.dirty=false;row.result='Saved';saved++;
        const index=state.studentAttendance.findIndex(record=>record.id===row.recordId);
        const record={id:row.recordId,session_id:lesson.id,student_id:studentId,status:row.value};
        if (index<0) state.studentAttendance.push(record);else state.studentAttendance[index]=record;
      } catch(error) {
        if (epoch!==generation) return;
        const rejected=['23505','23514','23503','23502','42501','40001','22023'].includes(error.code);
        if (rejected) {row.result='Not saved: '+error.message+' Refresh and review.';row.needsRefresh=true;failed++;} else {row.result='Unconfirmed — refresh before retrying';row.uncertain=true;unconfirmed++;}
        if (!rejected || error.status===401 || error.status===403) break;
      }
      updateRosterSummary();
    }
    if (epoch!==generation) return;
    renderAttendance();enhanceTables();
    message('operation-message','Saved '+saved+' of '+pending.length+' changed record(s).'+
      (failed ? ' '+failed+' not saved.' : '')+(unconfirmed ? ' '+unconfirmed+' unconfirmed; refresh before retrying.' : '')+
      (saved+failed+unconfirmed<pending.length ? ' Remaining choices have not been submitted.' : ''),failed+unconfirmed>0);
  } finally {
    if (epoch===generation) {busy=false;el('data-fields').disabled=!state.employee;updateBusyUI();updateRosterSummary();}
  }
});

function clearFormErrors(form) {
  for(const error of form.querySelectorAll('.field-error')) error.remove();
  for(const field of form.querySelectorAll('input,select')) {
    field.removeAttribute('aria-invalid');
    const descriptions=(field.getAttribute('aria-describedby')||'').split(' ').filter(id=>id&&id!==field.id+'-error');
    if(descriptions.length) field.setAttribute('aria-describedby',descriptions.join(' '));else field.removeAttribute('aria-describedby');
    if(field.dataset.whitespaceError) {field.setCustomValidity('');delete field.dataset.whitespaceError;}
  }
}
for(const form of document.forms) {
  form.addEventListener('invalid',event=>{
    const field=event.target;if(!field.id)return;
    let error=document.getElementById(field.id+'-error');
    if(!error){error=document.createElement('p');error.id=field.id+'-error';error.className='field-error';field.after(error);}
    error.textContent=field.validationMessage;field.setAttribute('aria-invalid','true');
    field.setAttribute('aria-describedby',[...(field.getAttribute('aria-describedby')||'').split(' ').filter(Boolean),error.id].filter((id,index,ids)=>ids.indexOf(id)===index).join(' '));
  },true);
  for(const eventName of ['input','change']) form.addEventListener(eventName,event=>{
    const field=event.target;
    if(field.dataset.whitespaceError){field.setCustomValidity('');delete field.dataset.whitespaceError;}
    if(field.validity?.valid){document.getElementById(field.id+'-error')?.remove();field.removeAttribute('aria-invalid');
      const ids=(field.getAttribute('aria-describedby')||'').split(' ').filter(id=>id&&id!==field.id+'-error');
      if(ids.length)field.setAttribute('aria-describedby',ids.join(' '));else field.removeAttribute('aria-describedby');}
  });
  form.addEventListener('submit',event=>{
    for(const field of form.querySelectorAll('input[required]')) {
      if(field.disabled || field.type!=='text' || field.autocomplete.includes('password') || !field.value || field.value.trim()) continue;
      field.setCustomValidity('Enter a value, not only spaces.');field.dataset.whitespaceError='true';
      event.preventDefault();event.stopImmediatePropagation();field.reportValidity();break;
    }
  },true);
}
for(const toggle of document.querySelectorAll('[data-password]')) {
  toggle.dataset.showAria=toggle.textContent;toggle.dataset.showLabel='Show';toggle.textContent='Show';toggle.setAttribute('aria-label',toggle.dataset.showAria);
  const input=el(toggle.dataset.password),wrapper=document.createElement('div');wrapper.className='password-field';input.before(wrapper);wrapper.append(input,toggle);
  toggle.addEventListener('click',()=>{
    const input=el(toggle.dataset.password),show=input.type==='password';input.type=show ? 'text' : 'password';
    toggle.textContent=show ? 'Hide' : 'Show';toggle.setAttribute('aria-pressed',String(show));
    toggle.setAttribute('aria-label',show ? toggle.dataset.showAria.replace(/^Show/,'Hide') : toggle.dataset.showAria);
  });
}
window.addEventListener('beforeunload',event=>{
  if([...workspaceUI.roster.values()].some(row=>row.dirty)){event.preventDefault();event.returnValue='';}
});
