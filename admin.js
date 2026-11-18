const byId = id => document.getElementById(id);
const login = byId('admin-login');
const dashboard = byId('admin-dashboard');
const message = byId('admin-message');
const edit = byId('admin-edit');
const editForm = byId('admin-edit-form');
let config;
let session;
let selected;
let page = 0;
let search = '';
let loadVersion = 0;
let listRequest;
let role;
let attendanceTimer;
const bookingCurrency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const attendanceDate = new Intl.DateTimeFormat('en-IN', { dateStyle: 'full', timeZone: 'Asia/Kolkata' });

function element(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

function signOut() {
  session = null;
  role = null;
  clearTimeout(attendanceTimer);
  byId('admin-daily-attendance').hidden = true;
  byId('attendance-cards').replaceChildren();
  ++loadVersion;
  listRequest?.abort();
  if (edit.open) edit.close();
  if (byId('admin-spot').open) byId('admin-spot').close();
  byId('admin-staff-form').reset();
  for (const id of ['admin-report', 'admin-staff-list', 'spot-result']) byId(id).replaceChildren();
  editForm.reset();
  selected = null;
  byId('admin-results').replaceChildren();
  byId('admin-days').replaceChildren();
  dashboard.hidden = true;
  login.hidden = false;
  byId('admin-password').focus();
}

async function adminRequest(data, signal = AbortSignal.timeout(15000)) {
  const requestSession = session;
  const response = await fetch('/api/admin', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + requestSession },
    body: JSON.stringify(data), signal });
  if (requestSession !== session) throw new Error('Your sign-in session has changed.');
  if ([401, 403].includes(response.status)) signOut();
  if (response.ok && data.action === 'download' && response.headers.get('Content-Type')?.startsWith('application/pdf')) {
    return response.blob();
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  if (data.action === 'download') throw new Error('The ticket PDF could not be downloaded.');
  return result;
}

async function downloadTicket(person, button) {
  button.disabled = true;
  message.textContent = 'Preparing ticket…';
  try {
    const pdf = await adminRequest({ action: 'download', booking_id: person.booking_id, ticket_id: person.ticket_id });
    const url = URL.createObjectURL(pdf);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${person.booking_id}-participant-${person.position}.pdf`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    message.textContent = 'Ticket download started.';
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function openEditor(person) {
  selected = person;
  for (const name of ['first_name', 'last_name', 'organization', 'city']) editForm.elements[name].value = person[name] || '';
  byId('edit-message').textContent = '';
  edit.showModal();
}

function renderPerson(person) {
  const row = document.createElement('article');
  row.className = 'admin-record';
  const visit = person.checkout_test || person.visit === 'demo' ? 'Demo'
    : { '21': '21 November 2026', '22': '22 November 2026', both: '21–22 November 2026' }[person.visit];
  const coupon = person.food_coupon_eligible ? 'Eligible' : '';
  const ticket = person.ticket_id ? (person.revoked_at ? 'Revoked' : 'Active') : 'Not issued';
  const amount = bookingCurrency.format(person.amount_paise / 100);
  const details = document.createElement('dl');
  for (const [label, value] of [
    ['Registration', person.booking_id], ['Visit', visit],
    ['Payment', person.status === 'paid' ? 'Paid' : 'Pending'], ['Booking total', amount],
    ['Ticket status', ticket], ['Ticket ID', person.ticket_id],
    ['Free food coupon', coupon], ['College / organisation', person.organization], ['City', person.city],
  ]) {
    if (value) details.append(element('dt', label), element('dd', value));
  }
  row.append(element('h3', person.first_name + ' ' + person.last_name), details);
  const actions = document.createElement('div');
  actions.className = 'admin-actions';
  const editButton = element('button', 'Edit');
  editButton.type = 'button';
  editButton.addEventListener('click', () => openEditor(person));
  if (['super', 'operations'].includes(role)) actions.append(editButton);
  if (person.ticket_id && !person.revoked_at) {
    if (person.status === 'paid') {
      const download = element('button', 'Download ticket');
      download.type = 'button';
      download.addEventListener('click', () => downloadTicket(person, download));
      actions.append(download);
    }
  }
  if (actions.childElementCount) row.append(actions);
  return row;
}

async function loadDashboard(includeDays = true) {
  const version = ++loadVersion;
  listRequest?.abort();
  const controller = new AbortController();
  listRequest = controller;
  const timeout = setTimeout(() => controller.abort(), 15000);
  byId('admin-previous').disabled = true;
  byId('admin-next').disabled = true;
  byId('admin-empty').hidden = true;
  byId('admin-results').setAttribute('aria-busy', 'true');
  message.textContent = 'Loading registrations…';
  let result;
  try {
    result = await adminRequest({ action: 'list', page, find: search, includeDays }, controller.signal);
  } catch (error) {
    if (version !== loadVersion) {
      if (!session && ['Sign in again.', 'This account does not have festival admin access.'].includes(error.message)) showError(error);
      return;
    }
    byId('admin-previous').disabled = page === 0;
    byId('admin-next').disabled = false;
    throw controller.signal.aborted ? new Error('Search timed out. Please try again.') : error;
  } finally {
    clearTimeout(timeout);
    if (version === loadVersion) byId('admin-results').removeAttribute('aria-busy');
  }
  if (version !== loadVersion) return;
  const days = result.days.map(day => {
    const card = document.createElement('article');
    card.className = 'panel';
    const title = attendanceDate.format(new Date(day.day));
    card.append(element('h3', title), element('p', `${day.registrations} registrations · ${day.participants} participants · ${day.under_16} under 16`),
      element('p', `${day.paid} active paid passes · ${day.paid_under_16} paid participants under 16`));
    return card;
  });
  if (includeDays) byId('admin-days').replaceChildren(...days);
  byId('admin-results').replaceChildren(...result.participants.slice(0, 25).map(renderPerson));
  byId('admin-empty').hidden = result.participants.length > 0;
  byId('admin-previous').disabled = page === 0;
  byId('admin-next').disabled = result.participants.length <= 25;
  byId('admin-page-number').textContent = 'Page ' + (page + 1);
  login.hidden = true;
  dashboard.hidden = false;
  message.textContent = search
    ? `Showing ${Math.min(25, result.participants.length)} matches on this page.` : '';
}

function showError(error) { message.textContent = error.message; }
fetch('/api/scanner-config').then(response => response.json()).then(result => {
  config = result;
  login.querySelector('button').disabled = !config.adminEnabled;
  if (!config.adminEnabled) message.textContent = 'Admin access has not been configured.';
}).catch(() => { message.textContent = 'Could not load sign-in configuration.'; });

login.addEventListener('submit', async event => {
  event.preventDefault();
  if (!config?.adminEnabled) return;
  const button = login.querySelector('button');
  button.disabled = true;
  message.textContent = 'Signing in…';
  try {
    const response = await fetch(new URL('/auth/v1/token?grant_type=password', config.url), {
      method: 'POST', headers: { apikey: config.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: byId('admin-email').value.trim(), password: byId('admin-password').value }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Sign-in failed. Check your email and password.');
    session = (await response.json()).access_token;
    role = (await adminRequest({ action: 'session' })).role;
    byId('admin-add').hidden = !['super', 'registration'].includes(role);
    byId('admin-operations').hidden = role !== 'super';
    login.hidden = true;
    dashboard.hidden = false;
    if (role === 'super') {
      byId('admin-daily-attendance').hidden = false;
      byId('attendance-status').textContent = 'Loading attendance…';
      refreshAttendance();
    }
    page = 0;
    search = '';
    byId('admin-find').value = '';
    await loadDashboard();
    if (role === 'super') loadOperations();
  } catch (error) { showError(error); }
  finally { byId('admin-password').value = ''; button.disabled = false; }
});
byId('admin-sign-out').onclick = () => { signOut(); message.textContent = 'Signed out.'; };
byId('admin-search').onsubmit = event => {
  event.preventDefault();
  search = byId('admin-find').value.trim();
  page = 0;
  loadDashboard(!byId('admin-days').childElementCount).catch(showError);
};
byId('admin-clear').onclick = () => {
  byId('admin-find').value = '';
  search = '';
  page = 0;
  loadDashboard(!byId('admin-days').childElementCount).catch(showError);
};
byId('admin-previous').onclick = () => { page = Math.max(0, page - 1); loadDashboard(false).catch(showError); };
byId('admin-next').onclick = () => { page += 1; loadDashboard(false).catch(showError); };
byId('admin-cancel').onclick = () => edit.close();
editForm.onsubmit = async event => {
  event.preventDefault();
  const button = editForm.querySelector('button[type=submit], button:not([type])');
  button.disabled = true;
  try {
    await adminRequest({ action: 'edit', booking_id: selected.booking_id, position: selected.position,
      ...Object.fromEntries(new FormData(editForm)) });
    edit.close();
    await loadDashboard();
  } catch (error) {
    (edit.open ? byId('edit-message') : message).textContent = error.message;
  } finally { button.disabled = false; }
};

const spot = byId('admin-spot');
const spotForm = byId('admin-spot-form');
const spotSubmit = spotForm.querySelector('button[type=submit]');
let spotRequest;

function updateSpot() {
  const online = spotForm.elements.mode.value === 'online';
  byId('spot-reference').hidden = !online;
  spotForm.elements.reference.required = online;
  spotForm.elements.reference.disabled = !online;
  const eligible = spotForm.elements.dob.value >= '2010-11-01';
  byId('spot-price').textContent = eligible ? 'Collect ₹100 · Free food coupon' : 'Collect ₹200';
}

byId('admin-add').onclick = () => {
  spotForm.reset();
  spotRequest = crypto.randomUUID();
  spotSubmit.disabled = false;
  byId('spot-message').textContent = '';
  byId('spot-result').replaceChildren();
  updateSpot();
  spot.showModal();
};
spotForm.oninput = event => {
  if (['mode', 'dob', 'reference'].includes(event.target.name)) spotForm.elements.payment_confirmed.checked = false;
  updateSpot();
};
byId('spot-close').onclick = () => spot.close();
spot.addEventListener('cancel', event => { if (byId('spot-close').disabled) event.preventDefault(); });
spotForm.onsubmit = async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(spotForm));
  spotSubmit.disabled = true;
  byId('spot-close').disabled = true;
  byId('spot-message').textContent = 'Recording payment and check-in…';
  try {
    const result = await adminRequest({ ...data, action: 'spot', request_id: spotRequest, payment_confirmed: data.payment_confirmed === 'on' });
    byId('spot-message').textContent = `CHECKED IN · ${result.booking_id} · ${bookingCurrency.format(result.amount_paise / 100)} collected. Issue the wristband.${result.food_coupon_eligible ? ' Free food coupon eligible.' : ''}`;
    const download = element('button', 'Download ticket');
    download.type = 'button';
    download.onclick = () => downloadTicket({ ...result, position: 1 }, download);
    byId('spot-result').replaceChildren(download);
    loadDashboard().catch(showError);
    if (role === 'super') {
      refreshAttendance();
      loadOperations();
    }
  } catch (error) {
    byId('spot-message').textContent = error.message;
    spotSubmit.disabled = false;
  } finally {
    byId('spot-close').disabled = false;
  }
};

let attendanceRequest;
const attendanceUpdated = new Intl.DateTimeFormat('en-IN', { timeStyle: 'medium', timeZone: 'Asia/Kolkata' });
async function refreshAttendance() {
  clearTimeout(attendanceTimer);
  if (role !== 'super' || document.hidden || attendanceRequest === session) return;
  const currentSession = session;
  attendanceRequest = currentSession;
  const status = byId('attendance-status');
  try {
    const days = await adminRequest({ action: 'daily_attendance' });
    const cards = days.map((day, index) => {
      const card = document.createElement('article');
      card.className = 'attendance-card';
      const title = `Day ${index + 1} · ${index === 0 ? '21' : '22'} November`;
      const rows = document.createElement('dl');
      for (const [label, value] of [
        ['Registered', day.registered], ['Checked in', day.checked_in],
        ['Not checked in', day.not_checked_in], ['Attendance', `${day.percentage}%`],
      ]) rows.append(element('dt', label), element('dd', value));
      const progress = document.createElement('progress');
      progress.max = 100;
      progress.value = day.percentage;
      progress.setAttribute('aria-label', `${title} check-in percentage`);
      card.append(element('h3', title), rows, progress);
      return card;
    });
    byId('attendance-cards').replaceChildren(...cards);
    status.textContent = `Updated ${attendanceUpdated.format(new Date())} IST · refreshes every 5 seconds`;
  } catch {
    if (session === currentSession) status.textContent = 'Attendance update unavailable. Retrying shortly…';
  } finally {
    if (attendanceRequest === currentSession) attendanceRequest = null;
    if (role === 'super' && session === currentSession && !document.hidden) {
      attendanceTimer = setTimeout(refreshAttendance, 5000);
    }
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearTimeout(attendanceTimer);
  else refreshAttendance();
});

const roleLabels = {
  registration: 'Registration / cash collection',
  gate: 'Gate / check-in',
  operations: 'Event operations',
  disabled: 'Disabled',
};
const reportStatus = byId('admin-report-status');
async function loadOperations() {
  const refresh = byId('admin-report-refresh');
  if (refresh.disabled || role !== 'super') return;
  refresh.disabled = true;
  reportStatus.textContent = 'Loading event totals…';
  try {
    const { report, users } = await adminRequest({ action: 'operations' });
    const totals = document.createElement('dl');
    totals.className = 'admin-report-totals';
    for (const [label, value] of [
      ['Registered', report.registered], ['Checked in', report.checked_in], ['Not checked in', report.not_checked_in],
      ['Spot registrations', report.spot], ['Online registrations', report.online], ['Cash collected', bookingCurrency.format(report.cash_paise / 100)],
    ]) totals.append(element('dt', label), element('dd', value));
    const cash = document.createElement('ul');
    for (const entry of report.cash_by_staff) cash.append(element('li', `${entry.staff} · ${bookingCurrency.format(entry.amount_paise / 100)} · ${entry.collections} collections`));
    const gate = document.createElement('ul');
    for (const entry of report.checkins_by_staff) gate.append(element('li', `${entry.staff} · ${entry.count}`));
    if (!cash.childElementCount) cash.append(element('li', 'No cash collected yet.'));
    if (!gate.childElementCount) gate.append(element('li', 'No check-ins yet.'));
    byId('admin-report').replaceChildren(totals, element('h3', 'Cash collected by staff'), cash, element('h3', 'Check-ins by staff'), gate);
    byId('admin-staff-list').replaceChildren(...users.map(user => {
      const form = document.createElement('form');
      form.className = 'admin-toolbar';
      const label = element('label', `${user.name} · ${user.email} `);
      const select = document.createElement('select');
      for (const [key, value] of Object.entries(roleLabels)) select.add(new Option(value, key, false, key === user.role));
      label.append(select);
      const save = element('button', 'Save role');
      form.append(label, save);
      form.onsubmit = async event => {
        event.preventDefault();
        save.disabled = true;
        try {
          await adminRequest({ action: 'staff_role', id: user.id, role: select.value });
          reportStatus.textContent = 'Staff permissions updated.';
        } catch (error) { reportStatus.textContent = error.message; }
        finally { save.disabled = false; }
      };
      return form;
    }));
    reportStatus.textContent = '';
  } catch (error) { reportStatus.textContent = error.message; }
  finally { refresh.disabled = false; }
}

byId('admin-report-refresh').onclick = loadOperations;
byId('admin-staff-form').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    await adminRequest({ ...Object.fromEntries(new FormData(form)), action: 'staff_create' });
    form.reset();
    await loadOperations();
    reportStatus.textContent = 'Staff account created.';
  } catch (error) { reportStatus.textContent = error.message; }
  finally { button.disabled = false; }
};
