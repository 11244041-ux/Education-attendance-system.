'use strict';

// Public browser configuration. Never add a service-role key here.
const SUPABASE_URL = 'https://stzxapveaocuzbidpfng.supabase.co';
const SUPABASE_KEY = 'sb_publishable_C1RFQbseyrN2YRnbNZENrQ_h9oHlVL4';
const el = id => document.getElementById(id);
let session = null;
let generation = 0;
let refreshPromise = null;
let busy = false;
let recoveryToken = null;
let state = emptyState();
function emptyState() {
  return { allowed: false, employee: null, roles: [], employees: [], students: [], sessions: [], studentAttendance: [], staffAttendance: [], roleCatalog: [], userRoles: [], roleAudit: [] };
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
  document.body.classList.add('auth-view');
  generation++;
  session = null;
  recoveryToken = null;
  refreshPromise = null;
  busy = false;
  state = emptyState();
  el('workspace').hidden = true;
  el('login-section').hidden = false;
  el('recovery-section').hidden = true;
  el('identity').textContent = '';
  for (const id of ['students-body', 'sessions-body', 'student-records', 'staff-records', 'user-roles-body', 'role-audit-body']) el(id).replaceChildren();
  el('data-fields').hidden = true;
  for (const form of document.querySelectorAll('form')) form.reset();
  for (const field of document.querySelectorAll('input[type=hidden]')) field.value = '';
  for (const select of document.querySelectorAll('#workspace select:not(#student-status):not(#staff-status):not(#role-action)')) select.replaceChildren();
  for (const id of ['load-message', 'student-message', 'session-message', 'student-attendance-message', 'staff-attendance-message', 'role-message']) message(id, '');
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
        session = { ...session, ...data, expires_at: Date.now() + data.expires_in * 1000 };
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

async function rpc(name, body = {}) {
  const epoch = generation;
  try {
    const data = await transport('/rest/v1/rpc/' + name, {
      method: 'POST', body, token: await accessToken()
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
async function readAll(resource) {
  const result = [];
  for (let offset = 0; ; ) {
    const rows = await rpc('education_list_records', { p_resource: resource, p_limit: 500, p_offset: offset });
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
  document.body.classList.remove('auth-view');
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
    : 'Education access awaits administrator approval.';
  el('data-fields').hidden = !state.allowed;
  const manager = managesStudents();
  for (const id of ['students-section', 'sessions-section', 'student-records-section']) el(id).hidden = !manager;
  el('student-attendance-section').hidden = !isTeacher();
  el('staff-attendance-section').hidden = !isAdmin();
  el('roles-section').hidden = !isAdmin();
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
  choices('session-teacher', isAdmin() ? state.employees.filter(row => row.is_teacher) : profile ? [profile] : [], r => r.display_name, 'Choose assigned teacher');
  if (!isAdmin() && profile) el('session-teacher').value = profile.id;
  el('session-teacher').disabled = !isAdmin();
  choices('attendance-session', state.sessions.filter(r => r.teacher_id === profile?.id), r => r.title + ' · ' + r.session_date, 'Choose your class session');
  choices('attendance-student', state.students, r => r.display_name + ' · ' + r.student_number, 'Choose student');
  choices('attendance-employee', state.employees, r => r.display_name, 'Choose staff member');
  choices('session-filter', state.sessions, r => r.title + ' · ' + r.session_date, 'All visible sessions');
  renderAttendance();
  choices('assign-role', state.roleCatalog.map(row => ({ id: row.code, label: row.label })), row => row.label, 'Choose role');
  el('user-roles-body').replaceChildren();
  for (const row of state.userRoles) tableRow('user-roles-body', [row.display_name || 'Portal user', row.auth_user_id, row.role], {
    label: 'Revoke', run: () => {
      el('target-auth-user').value = row.auth_user_id;
      el('assign-role').value = row.role;
      el('role-action').value = 'revoke';
      el('role-form').scrollIntoView({ block: 'center' });
      message('role-message', 'Review the selected user and role, then save to revoke access.');
    }
  });
  el('role-audit-body').replaceChildren();
  for (const row of state.roleAudit) tableRow('role-audit-body', [row.occurred_at, row.target_auth_user_id,
    row.role, row.action, row.actor_auth_user_id || row.source]);
}

async function loadData() {
  if (busy || !session) return false;
  const epoch = generation;
  busy = true;
  el('data-fields').disabled = true;
  message('load-message', 'Loading records…');
  try {
    const access = await rpc('education_get_access');
    if (epoch !== generation) return false;
    if (!access.allowed) {
      state = emptyState(); render();
      message('load-message', 'Education access has not been approved. Ask your Education administrator for a role.');
      return false;
    }
    const employee = access.employee, roles = access.roles;
    const manager = roles.some(r => ['administrator', 'teacher'].includes(r));
    const admin = roles.includes('administrator');
    const [employees, students, sessions, studentAttendance, staffAttendance, roleCatalog, userRoles, roleAudit] = await Promise.all([
      readAll('employees'),
      manager ? readAll('students') : Promise.resolve([]),
      manager ? readAll('sessions') : Promise.resolve([]),
      manager ? readAll('student_attendance') : Promise.resolve([]),
      readAll('staff_attendance'),
      admin ? readAll('roles') : Promise.resolve([]),
      admin ? readAll('user_roles') : Promise.resolve([]),
      admin ? readAll('role_audit') : Promise.resolve([])
    ]);
    if (epoch !== generation) return false;
    state = { allowed: true, employee, roles, employees, students, sessions, studentAttendance, staffAttendance, roleCatalog, userRoles, roleAudit };
    render();
    message('load-message', employee ? 'Saved records loaded.' : 'An administrator must link your Education staff record before you can continue.', !employee);
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
  const result = await rpc('education_save_student', {
    p_id: id || null, p_student_number: requiredText('student-number'), p_display_name: requiredText('student-name')
  });
  if (!result?.length) throw new Error('No record was changed. Refresh your permissions.');
});
bindSave('session-form', 'session-message', async () => {
  if (!managesStudents()) throw new Error('A teacher or administrator role is required.');
  const teacher = isAdmin() ? el('session-teacher').value : state.employee.id;
  if (!teacher) throw new Error('Choose a teacher.');
  const result = await rpc('education_save_session', {
    p_title: requiredText('session-title'), p_session_date: el('session-date').value, p_teacher_id: teacher
  });
  if (!result?.length) throw new Error('No session was created.');
});
for (const kind of ['student', 'staff']) {
  bindSave(kind + '-attendance-form', kind + '-attendance-message', async () => {
    if (kind === 'student' ? !isTeacher() : !isAdmin()) throw new Error('Your role cannot record this attendance.');
    const id = el(kind + '-record-id').value;
    const body = { p_id: id || null, p_status: el(kind + '-status').value,
      ...(kind === 'student'
        ? { p_session_id: el('attendance-session').value, p_student_id: el('attendance-student').value }
        : { p_employee_id: el('attendance-employee').value, p_attendance_date: el('staff-date').value }) };
    const result = await rpc('education_save_' + kind + '_attendance', body);
    if (!result?.length) throw new Error('No record was changed. Refresh your permissions.');
  });
}
bindSave('role-form', 'role-message', async () => {
  if (!isAdmin()) throw new Error('An Education administrator role is required.');
  const result = await rpc('education_assign_role', {
    p_target_auth_user_id: requiredText('target-auth-user'),
    p_role: el('assign-role').value, p_grant: el('role-action').value === 'grant'
  });
  if (!result.changed) throw new Error('No change: this role is already in the requested state.');
});
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
window.educationPortal = Object.freeze({ setSession, signOut, clearSession,
  getAccess: () => rpc('education_get_access') });

el('forgot-password').addEventListener('click', async () => {
  if (!el('email').reportValidity()) return;
  el('forgot-password').disabled = true;
  message('login-message', 'Requesting a password reset email…');
  try {
    // Use the actual deployed page, not Supabase's default localhost redirect.
    const redirect = location.origin + location.pathname;
    await transport('/auth/v1/recover?redirect_to=' + encodeURIComponent(redirect), {
      method: 'POST', body: { email: el('email').value.trim() }
    });
    message('login-message', 'If this email has an account, a reset email will arrive. Open the newest link.');
  } catch (error) {
    message('login-message', 'Could not request a reset: ' + error.message, true);
  } finally { el('forgot-password').disabled = false; }
});
el('cancel-recovery').addEventListener('click', () => {
  clearSession();
  message('login-message', 'Password reset cancelled. Request a new email when you are ready.');
});
el('recovery-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!recoveryToken) return;
  if (el('new-password').value !== el('confirm-password').value) {
    message('recovery-message', 'The passwords do not match.', true);
    return;
  }
  const epoch = generation, token = recoveryToken;
  el('recovery-submit').disabled = true;
  message('recovery-message', 'Updating your password…');
  try {
    await transport('/auth/v1/user', {
      method: 'PUT', token, body: { password: el('new-password').value }
    });
    if (epoch !== generation) return;
    clearSession();
    message('login-message', 'Password updated. Sign in with your new password.');
    // Discard the recovery session rather than retaining it as a staff login.
    try { await transport('/auth/v1/logout?scope=local', { method: 'POST', token }); } catch { /* Local recovery state is already cleared. */ }
  } catch (error) {
    if (epoch !== generation) return;
    if (error.status === 401 || error.status === 403) {
      clearSession();
      message('login-message', 'This recovery session expired. Request a new reset email.', true);
    } else message('recovery-message', 'Could not update password: ' + error.message, true);
  } finally {
    el('new-password').value = ''; el('confirm-password').value = '';
    el('recovery-submit').disabled = false;
  }
});

async function handleRecoveryLink() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const url = new URL(location.href);
  if (!hash.has('access_token') && !hash.has('error') && !hash.has('error_code') && !url.searchParams.has('code')) return;
  // Remove credentials from browser history immediately, before any await.
  url.hash = ''; url.searchParams.delete('code');
  history.replaceState(null, '', url.pathname + url.search);
  clearSession();
  if (hash.get('type') !== 'recovery' || !hash.get('access_token')) {
    message('login-message', 'This recovery link is expired or unsupported. Enter your email and request a new reset using Forgot password.', true);
    return;
  }
  const epoch = generation;
  const token = hash.get('access_token');
  el('login-section').hidden = true;
  el('recovery-section').hidden = false;
  el('recovery-submit').disabled = true;
  message('recovery-message', 'Checking your recovery link…');
  try {
    const user = await transport('/auth/v1/user', { token });
    if (!user?.id) throw new Error('Invalid recovery session.');
    if (epoch !== generation) return;
    recoveryToken = token;
    message('recovery-message', 'Recovery link verified. Enter your new password.');
    el('new-password').focus();
  } catch {
    if (epoch === generation) {
      clearSession();
      message('login-message', 'This recovery link is invalid or expired. Request a new reset email.', true);
    }
  } finally { if (epoch === generation) el('recovery-submit').disabled = false; }
}
handleRecoveryLink();
window.addEventListener('hashchange', handleRecoveryLink);
