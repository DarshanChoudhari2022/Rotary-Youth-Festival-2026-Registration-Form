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

function element(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

function signOut() {
  session = null;
  ++loadVersion;
  if (edit.open) edit.close();
  editForm.reset();
  selected = null;
  byId('admin-results').replaceChildren();
  byId('admin-days').replaceChildren();
  dashboard.hidden = true;
  login.hidden = false;
}

async function adminRequest(data) {
  const response = await fetch('/api/admin', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session },
    body: JSON.stringify(data), signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  if ([401, 403].includes(response.status)) signOut();
  if (!response.ok) throw new Error(result.error);
  return result;
}

function openEditor(person) {
  selected = person;
  for (const name of ['first_name', 'last_name', 'organization', 'city']) editForm.elements[name].value = person[name] || '';
  byId('edit-message').textContent = '';
  edit.showModal();
}

async function revokeTicket(person, button) {
  if (!window.confirm('Revoke this pass? It will stop being valid at the gate. No refund will be processed.')) return;
  button.disabled = true;
  try {
    await adminRequest({ action: 'revoke', ticket_id: person.ticket_id });
    await loadDashboard();
  } catch (error) {
    message.textContent = error.message;
    button.disabled = false;
  }
}

function renderPerson(person) {
  const row = document.createElement('tr');
  const visit = person.checkout_test || person.visit === 'demo' ? 'Demo'
    : { '21': '21 Nov', '22': '22 Nov', both: '21 & 22 Nov' }[person.visit];
  const age = [person.under_16_day_one && '21 Nov', person.under_16_day_two && '22 Nov'].filter(Boolean).join(', ');
  const ticket = person.ticket_id ? (person.revoked_at ? 'Revoked' : person.ticket_id) : 'Awaiting payment';
  for (const value of [person.booking_id, person.first_name + ' ' + person.last_name + (age ? ' · Under 16 on ' + age : ''),
    visit, person.status === 'paid' ? 'Paid' : 'Pending', ticket]) row.append(element('td', value));
  const actions = document.createElement('td');
  const editButton = element('button', 'Edit');
  editButton.type = 'button';
  editButton.addEventListener('click', () => openEditor(person));
  actions.append(editButton);
  if (person.ticket_id && !person.revoked_at) {
    const revoke = element('button', 'Revoke');
    revoke.type = 'button';
    revoke.addEventListener('click', () => revokeTicket(person, revoke));
    actions.append(revoke);
  }
  row.append(actions);
  return row;
}

async function loadDashboard() {
  const version = ++loadVersion;
  message.textContent = 'Loading registrations…';
  const result = await adminRequest({ action: 'list', page, find: search });
  if (version !== loadVersion) return;
  const days = result.days.map(day => {
    const card = document.createElement('article');
    card.className = 'panel';
    const title = new Intl.DateTimeFormat('en-IN', { dateStyle: 'full', timeZone: 'Asia/Kolkata' }).format(new Date(day.day));
    card.append(element('h3', title), element('p', `${day.registrations} registrations · ${day.participants} participants · ${day.under_16} under 16`),
      element('p', `${day.paid} active paid passes · ${day.paid_under_16} paid participants under 16`));
    return card;
  });
  byId('admin-days').replaceChildren(...days);
  byId('admin-results').replaceChildren(...result.participants.slice(0, 25).map(renderPerson));
  byId('admin-previous').disabled = page === 0;
  byId('admin-next').disabled = result.participants.length <= 25;
  byId('admin-page-number').textContent = 'Page ' + (page + 1);
  login.hidden = true;
  dashboard.hidden = false;
  message.textContent = result.participants.length ? '' : 'No matching registrations.';
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
  try {
    const response = await fetch(new URL('/auth/v1/token?grant_type=password', config.url), {
      method: 'POST', headers: { apikey: config.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: byId('admin-email').value.trim(), password: byId('admin-password').value }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Sign-in failed. Check your email and password.');
    session = (await response.json()).access_token;
    page = 0;
    search = '';
    byId('admin-find').value = '';
    await loadDashboard();
  } catch (error) { showError(error); }
  finally { byId('admin-password').value = ''; button.disabled = false; }
});
byId('admin-sign-out').onclick = () => { signOut(); message.textContent = 'Signed out.'; };
byId('admin-search').onsubmit = event => {
  event.preventDefault();
  search = byId('admin-find').value.trim();
  page = 0;
  loadDashboard().catch(showError);
};
byId('admin-previous').onclick = () => { page = Math.max(0, page - 1); loadDashboard().catch(showError); };
byId('admin-next').onclick = () => { page += 1; loadDashboard().catch(showError); };
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
