'use strict';

// Public browser configuration. Never add a service-role key here.
const SUPABASE_URL = 'https://stzxapveaocuzbidpfng.supabase.co';
const SUPABASE_KEY = 'sb_publishable_C1RFQbseyrN2YRnbNZENrQ_h9oHlVL4';
const el = id => document.getElementById(id);
let session = null;
let generation = 0;
let refreshPromise = null;
let busy = false;
let state = emptyState();
function emptyState() {
  return { employee: null, roles: [], employees: [], students: [], sessions: [], studentAttendance: [], staffAttendance: [] };
}
function message(id, text, error = false) {
  el(id).textContent = text;
  el(id).classList.toggle('error', error);
}
const isAdmin = () => state.roles.includes('administrator');
const isTeacher = () => state.roles.includes('teacher');
const managesStudents = () => isAdmin() || isTeacher();

async function transport(path, { method = 'GET', body, token, prefer } = {}) {
  let response;
  try {
    response = await fetch(SUPABASE_URL + path, {
      method,
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(prefer ? { Prefer: prefer } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20000)
    });
  } catch {
    throw new Error('The service could not be reached. Check your connection.');
  }
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    const error = new Error(data?.code === '23505'
      ? 'This record already exists. Refresh and use Correct to change attendance.'
      : data?.message || data?.msg || data?.error_description || 'Request failed (' + response.status + ').');
    error.status = response.status;
    throw error;
  }
  return data;
}

function clearSession() {
  generation++;
  session = null;
  refreshPromise = null;
  busy = false;
  state = emptyState();
  el('workspace').hidden = true;
  el('login-section').hidden = false;
  el('identity').textContent = '';
  for (const id of ['students-body', 'sessions-body', 'student-records', 'staff-records']) el(id).replaceChildren();
  for (const form of document.querySelectorAll('form')) form.reset();
  for (const field of document.querySelectorAll('input[type=hidden]')) field.value = '';
  for (const select of document.querySelectorAll('#workspace select:not(#student-status):not(#staff-status)')) select.replaceChildren();
  for (const id of ['load-message', 'student-message', 'session-message', 'student-attendance-message', 'staff-attendance-message']) message(id, '');
}

async function accessToken() {
  if (!session) throw new Error('Sign in to continue.');
  if (session.expires_at > Date.now() + 60000) return session.access_token;
  if (!session.refresh_token) {
    clearSession();
    throw new Error('Your portal session expired. Sign in again.');
  }
  if (!refreshPromise) {
    const epoch = generation;
    const refreshToken = session.refresh_token;
    refreshPromise = (async () => {
      try {
        const data = await transport('/auth/v1/token?grant_type=refresh_token', {
          method: 'POST', body: { refresh_token: refreshToken }
        });
        if (epoch !== generation) throw new Error('The session changed.');
        session = { ...data, expires_at: Date.now() + data.expires_in * 1000 };
        return session.access_token;
      } catch (error) {
        if (epoch === generation) {
          clearSession();
          message('login-message', 'Your session could not be refreshed. Sign in again.', true);
        }
        throw error;
      } finally {
        if (epoch === generation) refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

async function request(query, method = 'GET', body) {
  const epoch = generation;
  try {
    const data = await transport('/rest/v1/' + query, {
      method, body, token: await accessToken(),
      ...(method === 'GET' ? {} : { prefer: 'return=representation' })
    });
    if (epoch !== generation) throw new Error('The session changed.');
    return data;
  } catch (error) {
    if (error.status === 401 && epoch === generation) {
      clearSession();
      message('login-message', 'Your session was rejected. Sign in again.', true);
    }
    throw error;
  }
}
async function readAll(query) {
  const result = [];
  for (let offset = 0; ; ) {
    const rows = await request(query + '&limit=500&offset=' + offset);
    if (!Array.isArray(rows)) throw new Error('The database returned an unexpected response.');
    result.push(...rows);
    if (!rows.length) return result;
    offset += rows.length;
  }
}

// Called by the trusted portal in the same page, or by the development login.
// Tokens remain in memory; no localStorage, URL tokens, or cross-window messages.
async function setSession(tokens) {
  clearSession();
  const epoch = generation;
  if (!tokens?.access_token) throw new Error('A signed-in portal session is required.');
  const user = await transport('/auth/v1/user', { token: tokens.access_token });
  if (epoch !== generation) return;
  session = {
    access_token: tokens.access_token, refresh_token: tokens.refresh_token,
    expires_at: tokens.expires_at ? tokens.expires_at * 1000 : Date.now() + (tokens.expires_in || 300) * 1000,
    user
  };
  el('login-section').hidden = true;
  el('workspace').hidden = false;
  await loadData();
}

function choices(id, rows, label, placeholder) {
  const select = el(id), previous = select.value;
  select.replaceChildren(new Option(placeholder, ''));
  for (const row of rows) select.add(new Option(label(row), row.id));
  if (rows.some(row => row.id === previous)) select.value = previous;
}
function tableRow(body, values, edit) {
  const row = document.createElement('tr');
  for (const value of values) {
    const cell = document.createElement('td');
    cell.textContent = value ?? '';
    row.appendChild(cell);
  }
  if (edit) {
    const cell = document.createElement('td'), button = document.createElement('button');
    button.type = 'button'; button.textContent = edit.label; button.addEventListener('click', edit.run);
    cell.appendChild(button); row.appendChild(cell);
  }
  el(body).appendChild(row);
}
function editAttendance(kind, record) {
  el(kind + '-record-id').value = record.id;
  if (kind === 'student') {
    el('attendance-session').value = record.session_id;
    el('attendance-student').value = record.student_id;
  } else {
    el('attendance-employee').value = record.employee_id;
    el('staff-date').value = record.attendance_date;
  }
  el(kind + '-status').value = record.status;
  el(kind + '-attendance-submit').textContent = 'Save correction';
  el(kind + '-attendance-form').scrollIntoView({ block: 'center' });
  message(kind + '-attendance-message', 'Editing an existing record.');
}
function renderAttendance() {
  const students = new Map(state.students.map(row => [row.id, row]));
  const employees = new Map(state.employees.map(row => [row.id, row]));
  const sessions = new Map(state.sessions.map(row => [row.id, row]));
  el('student-records').replaceChildren();
  const filter = el('session-filter').value;
  const records = state.studentAttendance.filter(row => !filter || row.session_id === filter);
  for (const row of records) {
    const lesson = sessions.get(row.session_id);
    tableRow('student-records', [lesson?.title || row.session_id, lesson?.session_date,
      students.get(row.student_id)?.display_name || row.student_id, row.status], {
      label: 'Correct', run: () => editAttendance('student', row)
    });
    el('student-records').lastElementChild.lastElementChild.hidden =
      !isTeacher() || lesson?.teacher_id !== state.employee?.id;
  }
  el('student-count').textContent = records.length + ' student attendance record(s).';
  el('staff-records').replaceChildren();
  for (const row of state.staffAttendance) {
    tableRow('staff-records', [employees.get(row.employee_id)?.display_name || row.employee_id,
      row.attendance_date, row.status], isAdmin() ? { label: 'Correct', run: () => editAttendance('staff', row) } : null);
  }
  el('staff-count').textContent = state.staffAttendance.length + ' staff attendance record(s).';
}
function render() {
  const profile = state.employee;
  el('identity').textContent = profile
    ? profile.display_name + ' · ' + (state.roles.join(', ') || 'Education staff')
    : 'No Education staff profile is linked to this account. Contact an administrator.';
  const manager = managesStudents();
  for (const id of ['students-section', 'sessions-section', 'student-records-section']) el(id).hidden = !manager;
  el('student-attendance-section').hidden = !isTeacher();
  el('staff-attendance-section').hidden = !isAdmin();
  el('staff-heading').textContent = isAdmin() ? 'Education staff attendance' : 'My staff attendance';
  el('students-body').replaceChildren();
  for (const student of state.students) tableRow('students-body', [student.student_number, student.display_name], {
    label: 'Edit', run: () => {
      el('student-id').value = student.id;
      el('student-number').value = student.student_number;
      el('student-name').value = student.display_name;
      el('student-submit').textContent = 'Save changes';
      el('student-name').focus();
    }
  });
  el('sessions-body').replaceChildren();
  const employeeName = id => state.employees.find(row => row.id === id)?.display_name || id;
  for (const lesson of state.sessions) tableRow('sessions-body', [lesson.title, lesson.session_date, employeeName(lesson.teacher_id)]);
  choices('session-teacher', isAdmin() ? state.employees : profile ? [profile] : [], r => r.display_name, 'Choose staff member with teacher role');
  if (!isAdmin() && profile) el('session-teacher').value = profile.id;
  el('session-teacher').disabled = !isAdmin();
  choices('attendance-session', state.sessions.filter(r => r.teacher_id === profile?.id), r => r.title + ' · ' + r.session_date, 'Choose your class session');
  choices('attendance-student', state.students, r => r.display_name + ' · ' + r.student_number, 'Choose student');
  choices('attendance-employee', state.employees, r => r.display_name, 'Choose staff member');
  choices('session-filter', state.sessions, r => r.title + ' · ' + r.session_date, 'All visible sessions');
  renderAttendance();
}

async function loadData() {
  if (busy || !session) return false;
  const epoch = generation;
  busy = true;
  el('data-fields').disabled = true;
  message('load-message', 'Loading records…');
  try {
    const profiles = await readAll('education_employees?select=id,auth_user_id,display_name&auth_user_id=eq.' + encodeURIComponent(session.user.id));
    const employee = profiles[0];
    const roles = employee ? await readAll('education_staff_roles?select=role&employee_id=eq.' + employee.id) : [];
    const manager = roles.some(r => ['administrator', 'teacher'].includes(r.role));
    const [employees, students, sessions, studentAttendance, staffAttendance] = employee ? await Promise.all([
      manager ? readAll('education_employees?select=id,display_name&order=display_name,id') : Promise.resolve(profiles),
      manager ? readAll('education_students?select=id,student_number,display_name&order=student_number,id') : Promise.resolve([]),
      manager ? readAll('education_sessions?select=id,title,session_date,teacher_id&order=session_date,id') : Promise.resolve([]),
      manager ? readAll('education_student_attendance?select=id,session_id,student_id,status&order=id') : Promise.resolve([]),
      readAll('education_staff_attendance?select=id,employee_id,attendance_date,status&order=attendance_date,id')
    ]) : [[], [], [], [], []];
    if (epoch !== generation) return false;
    state = { employee, roles: roles.map(r => r.role), employees, students, sessions, studentAttendance, staffAttendance };
    render();
    message('load-message', employee ? 'Saved records loaded.' : 'Ask an administrator to link your Auth account to an Education staff profile.', !employee);
    return !!employee;
  } catch (error) {
    if (epoch === generation) {
      message('load-message', 'Could not load records: ' + error.message + ' Confirm the Education migrations are applied, then refresh.', true);
      // Fail closed rather than leave controls enabled with stale roles or data.
      state = emptyState(); render();
    }
    return false;
  } finally {
    if (epoch === generation) {
      busy = false;
      el('data-fields').disabled = !state.employee;
    }
  }
}

function resetForm(id) {
  el(id).reset();
  for (const field of el(id).querySelectorAll('input[type=hidden]')) field.value = '';
  const labels = { 'student-form': ['student-submit', 'Save student'],
    'student-attendance-form': ['student-attendance-submit', 'Save student attendance'],
    'staff-attendance-form': ['staff-attendance-submit', 'Save staff attendance'] };
  if (labels[id]) el(labels[id][0]).textContent = labels[id][1];
  if (id === 'session-form' && !isAdmin() && state.employee) el('session-teacher').value = state.employee.id;
}
function bindSave(formId, messageId, action) {
  el(formId).addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !state.employee) return;
    const epoch = generation;
    busy = true; el('data-fields').disabled = true;
    message(messageId, 'Saving…');
    try {
      await action();
      if (epoch !== generation) return;
      resetForm(formId);
      message(messageId, 'Saved.');
      busy = false;
      await loadData();
    } catch (error) {
      if (epoch === generation) message(messageId,
        'Save could not be confirmed: ' + error.message + ' Refresh before retrying.', true);
    } finally {
      if (epoch === generation) { busy = false; el('data-fields').disabled = !state.employee; }
    }
  });
}
function requiredText(id) {
  const value = el(id).value.trim();
  if (!value) throw new Error('Enter a value, not only spaces.');
  return value;
}
bindSave('student-form', 'student-message', async () => {
  if (!managesStudents()) throw new Error('A teacher or administrator role is required.');
  const id = el('student-id').value;
  const result = await request('education_students' + (id ? '?id=eq.' + encodeURIComponent(id) : ''), id ? 'PATCH' : 'POST', {
    student_number: requiredText('student-number'), display_name: requiredText('student-name')
  });
  if (!result?.length) throw new Error('No record was changed. Refresh your permissions.');
});
bindSave('session-form', 'session-message', async () => {
  if (!managesStudents()) throw new Error('A teacher or administrator role is required.');
  const teacher = isAdmin() ? el('session-teacher').value : state.employee.id;
  if (!teacher) throw new Error('Choose a teacher.');
  const result = await request('education_sessions', 'POST', {
    title: requiredText('session-title'), session_date: el('session-date').value, teacher_id: teacher
  });
  if (!result?.length) throw new Error('No session was created.');
});
for (const kind of ['student', 'staff']) {
  bindSave(kind + '-attendance-form', kind + '-attendance-message', async () => {
    if (kind === 'student' ? !isTeacher() : !isAdmin()) throw new Error('Your role cannot record this attendance.');
    const id = el(kind + '-record-id').value;
    const body = { status: el(kind + '-status').value, recorded_by: state.employee.id,
      ...(kind === 'student'
        ? { session_id: el('attendance-session').value, student_id: el('attendance-student').value }
        : { employee_id: el('attendance-employee').value, attendance_date: el('staff-date').value }) };
    const result = await request('education_' + kind + '_attendance' + (id ? '?id=eq.' + encodeURIComponent(id) : ''), id ? 'PATCH' : 'POST', body);
    if (!result?.length) throw new Error('No record was changed. Refresh your permissions.');
  });
}
for (const button of document.querySelectorAll('[data-cancel]')) button.addEventListener('click', () => {
  resetForm(button.dataset.cancel);
});
el('session-filter').addEventListener('change', renderAttendance);
el('refresh').addEventListener('click', loadData);
el('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const epoch = generation;
  el('login-submit').disabled = true;
  message('login-message', 'Signing in…');
  try {
    const data = await transport('/auth/v1/token?grant_type=password', {
      method: 'POST', body: { email: el('email').value.trim(), password: el('password').value }
    });
    el('password').value = '';
    if (epoch !== generation) return;
    await setSession(data);
  } catch (error) {
    message('login-message', error.message, true);
  } finally { el('password').value = ''; el('login-submit').disabled = false; }
});
async function signOut() {
  const token = session?.access_token;
  clearSession();
  message('login-message', 'Signed out of this module.');
  if (token) {
    try { await transport('/auth/v1/logout?scope=local', { method: 'POST', token }); }
    catch { message('login-message', 'Local data cleared. Server sign-out could not be confirmed; sign out through the portal too.', true); }
  }
}
el('sign-out').addEventListener('click', signOut);
window.educationPortal = Object.freeze({ setSession, signOut, clearSession });
