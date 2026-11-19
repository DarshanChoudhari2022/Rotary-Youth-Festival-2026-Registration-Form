const byId = id => document.getElementById(id);
const login = byId('admin-login');
const dashboard = byId('admin-dashboard');
const message = byId('admin-message');
const edit = byId('admin-edit');
const editForm = byId('admin-edit-form');

let session;
let selected;
let page = 0;
let search = '';
let loadVersion = 0;
let listRequest;
const recentPages = new Map();
const rosterPages = new Map();
const bookingCounts = new Map();

function clearDirectoryCache() {
  recentPages.clear();
  rosterPages.clear();
  bookingCounts.clear();
}

function firstRosterPage(day) {
  const cached = rosterPages.get(day);
  if (cached && cached.expires > Date.now()) return cached.request;
  const entry = { expires: Infinity };
  entry.request = adminRequest({ action: 'day_roster', day, after: null }).then(result => {
    entry.expires = Date.now() + 10000;
    return result;
  }).catch(error => {
    if (rosterPages.get(day) === entry) rosterPages.delete(day);
    throw error;
  });
  rosterPages.set(day, entry);
  return entry.request;
}
function rememberPage(key, result) {
  if (recentPages.size >= 8) recentPages.delete(recentPages.keys().next().value);
  recentPages.set(key, { result, expires: Date.now() + 5000 });
}
function nameMatches(person, term) {
  return (person.first_name + ' ' + person.last_name).toLowerCase().includes(term);
}

function cachedSearch() {
  const term = search.toLowerCase();
  const now = Date.now();
  const exact = recentPages.get(JSON.stringify([page, term]));
  if (exact && exact.expires > now) return exact.result;
  if (page || !/^[a-z ]{2,}$/.test(term)) return;
  for (const [key, entry] of recentPages) {
    const [number, prefix] = JSON.parse(key);
    if (number || entry.expires <= now || entry.result.participants.length > 25) continue;
    if (prefix && (prefix.length < 2 || !term.startsWith(prefix))) continue;
    return { participants: entry.result.participants.filter(person => nameMatches(person, term)) };
  }
}
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
  document.body.classList.add('signed-out');
  dashboard.hidden = true;
  login.hidden = false;
  clearDirectoryCache();
  session = null;
  role = null;
  clearTimeout(attendanceTimer);
  byId('admin-daily-attendance').hidden = true;
  byId('attendance-cards').replaceChildren();
  clearTimeout(searchTimer);
  byId('admin-breakdown').open = false;
  byId('admin-operations').open = false;
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
  resetRoster();
  byId('admin-password').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'instant' });
}

async function adminRequest(data, signal = AbortSignal.timeout(15000)) {
  const requestSession = session;
  const started = performance.now();
  const response = await fetch('/api/admin', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + requestSession },
    body: JSON.stringify(data), signal });
  if (requestSession !== session) throw new Error('Your sign-in session has changed.');
  if ([401, 403].includes(response.status)) signOut();
  if (response.ok && data.action === 'download' && response.headers.get('Content-Type')?.startsWith('application/pdf')) {
    return response.blob();
  }
  const result = await response.json();
  if (requestSession !== session) throw new Error('Your sign-in session has changed.');
  if (!response.ok) throw new Error(result.error);
  if (data.action === 'download') throw new Error('The ticket PDF could not be downloaded.');
  performance.measure('festival.admin.' + data.action, { start: started });
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

async function bookingParticipants(id) {
  const participants = [];
  for (let page = 0; ; page++) {
    const result = await adminRequest({ action: 'list', find: id, page, includeDays: false });
    for (const person of result.participants.slice(0, 25)) {
      if (person.booking_id === id) participants.push(person);
    }
    if (result.participants.length <= 25) return participants;
  }
}

function renderPerson(person) {
  const row = document.createElement('details');
  row.className = 'admin-record';
  const coupon = person.food_coupon_eligible ? 'Eligible' : '';
  const ticket = person.ticket_id ? (person.revoked_at ? 'Revoked' : 'Active') : 'Not issued';
  const details = document.createElement('dl');
  for (const [label, value] of [
    ['Ticket status', ticket], ['Ticket ID', person.ticket_id],
    ['Free food coupon', coupon], ['College / organisation', person.organization], ['City', person.city],
  ]) {
    if (value) details.append(element('dt', label), element('dd', value));
  }
  const summary = element('summary', [person.first_name, person.last_name].filter(Boolean).join(' '));
  row.classList.add('booking-person');
  row.append(summary, details);
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

function renderBookings(people) {
  const groups = new Map();
  for (const person of people) {
    if (!groups.has(person.booking_id)) groups.set(person.booking_id, []);
    groups.get(person.booking_id).push(person);
  }
  return Array.from(groups.values(), matches => {
    const booking = matches[0];
    const id = booking.booking_id;
    const demo = booking.checkout_test || booking.visit === 'demo';
    const visit = demo ? 'Demo' : { '21': '21 November 2026', '22': '22 November 2026', both: '21–22 November 2026' }[booking.visit];
    const row = element('details', '');
    row.className = 'admin-record booking-record';
    const summary = element('summary', '');
    const name = element('strong', id);
    name.append(element('small', matches.map(person => [person.first_name, person.last_name].filter(Boolean).join(' ')).join(', ')));
    const received = Number.isInteger(booking.received_paise);
    const label = booking.cash_received ? 'Cash received' : received ? 'Paid'
      : booking.status === 'paid' ? 'Payment amount unavailable' : 'Pending';
    const payment = element('span', label);
    payment.className = received ? 'desk-paid' : 'desk-pending';
    summary.append(name, element('span', visit), payment,
      element('strong', received ? (matches.some(person => person.position === 1)
        ? bookingCurrency.format(booking.received_paise / 100) + ' received' : 'Covered by booking payment') : ''));
    const roster = element('div', '');
    row.append(summary, roster);
    row.ontoggle = async () => {
      if (!row.open || roster.dataset.loaded) return;
      roster.textContent = 'Loading booking participants…';
      let entry = bookingCounts.get(id);
      if (!entry || entry.expires <= Date.now()) {
        entry = { request: bookingParticipants(id), expires: Date.now() + 15000 };
        bookingCounts.set(id, entry);
      }
      try {
        const participants = await entry.request;
        const under16 = participants.filter(person => booking.visit === '22' ? person.under_16_day_two : person.under_16_day_one).length;
        const note = participants.length + ' participants' + (demo ? '' : ' · ' + under16 + ' under 16');
        roster.replaceChildren(element('p', note), ...participants.map(renderPerson));
        roster.dataset.loaded = 'true';
      } catch {
        if (bookingCounts.get(id) === entry) bookingCounts.delete(id);
        roster.textContent = 'Unable to load participants. Reopen to retry.';
      }
    };
    return row;
  });
}

async function loadDashboard() {
  const version = ++loadVersion;
  listRequest?.abort();
  const key = JSON.stringify([page, search.toLowerCase()]);
  const cached = cachedSearch();
  if (cached) {
    byId('admin-results').removeAttribute('aria-busy');
    renderDirectory(cached);
    return;
  }
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
    result = await adminRequest({ action: 'list', page, find: search, includeDays: false }, controller.signal);
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
  rememberPage(key, result);
  renderDirectory(result);
}

function renderDirectory(result) {
  byId('admin-results').replaceChildren(...renderBookings(result.participants.slice(0, 25)));
  byId('admin-empty').hidden = result.participants.length > 0;
  byId('admin-previous').disabled = page === 0;
  byId('admin-next').disabled = result.participants.length <= 25;
  byId('admin-page-number').textContent = 'Page ' + (page + 1);
  login.hidden = true;
  dashboard.hidden = false;
  message.textContent = search
    ? `Showing ${Math.min(25, result.participants.length)} matches on this page.` : '';
}


const breakdown = byId('admin-breakdown');
const roster = byId('day-roster');
let rosterVersion = 0;
function resetRoster() {
  rosterVersion++;
  roster.replaceChildren();
  roster.hidden = true;
}

function openRoster(day, title, container = roster) {
  if (container === roster) resetRoster();
  const version = rosterVersion;
  container.hidden = false;
  const heading = element('h3', container === roster ? title + ' · Participants' : title);
  heading.tabIndex = -1;
  const list = element('div', '');
  const status = element('p', '');
  status.setAttribute('role', 'status');
  const more = element('button', 'Load more bookings');
  container.append(heading, list, status, more);
  if (container === roster) heading.focus();
  let after = null;
  async function load() {
    more.disabled = true;
    more.hidden = true;
    status.textContent = 'Loading bookings…';
    try {
      const data = await (after ? adminRequest({ action: 'day_roster', day, after }) : firstRosterPage(day));
      if (version !== rosterVersion) return;
      for (const booking of data.bookings) {
        const group = element('article', '');
        group.className = 'roster-booking';
        const dayAmount = booking.collected / (booking.visit === 'both' ? 2 : 1);
        const receipt = dayAmount > 0
          ? `${booking.cash_received ? 'Cash received' : 'Paid'} · ${bookingCurrency.format(dayAmount / 100)} allocated to ${day} November`
          : 'No verified receipt';
        group.append(element('h4', booking.id), element('p',
          `${booking.visit === 'both' ? '21–22' : day} November · ${booking.people.length} participant(s) · ${receipt}`));
        const names = element('ol', '');
        for (const p of booking.people) {
          const item = element('li', '');
          item.append(element('strong', p.name), element('span', [
            p.under16 && 'Under 16', p.coupon ? 'Food coupon eligible' : 'No food coupon',
            'Ticket: ' + p.ticket, p.admitted ? 'Checked in' : 'Not checked in', p.organization, p.city,
          ].filter(Boolean).join(' · ')));
          names.append(item);
        }
        group.append(names);
        list.append(group);
      }
      after = data.next;
      status.textContent = list.childElementCount ? `${list.childElementCount} bookings shown.` : 'No bookings for this date.';
      more.hidden = !after;
      more.textContent = 'Load more bookings';
    } catch (error) {
      if (version !== rosterVersion) return;
      status.textContent = error.message;
      more.hidden = false;
      more.textContent = 'Retry';
    } finally { more.disabled = false; }
  }
  more.onclick = load;
  load();
}
// Older local servers can serve the current page while still running the prior API.
// Reconstruct the registration counts from complete rosters if that API omits them.
async function overviewFigures() {
  const overview = await adminRequest({ action: 'registration_breakdown', includeTotals: true });
  if (Number.isInteger(overview.participants)) return overview;
  const bookings = new Map();
  await Promise.all(overview.days.map(async day => {
    let count = 0;
    let after = null;
    do {
      const page = await adminRequest({ action: 'day_roster', day: day.day.slice(-2), after });
      for (const booking of page.bookings) {
        bookings.set(booking.id, booking.people.length);
        count += booking.people.length;
      }
      after = page.next;
    } while (after);
    day.participants = count;
  }));
  overview.participants = Array.from(bookings.values()).reduce((sum, count) => sum + count, 0);
  return overview;
}

async function loadBreakdown() {
  const status = byId('breakdown-status');
  status.textContent = 'Loading registration totals…';
  try {
    const { days: result, participants, directoryParticipants, tickets, under16, received } = await overviewFigures();
    const money = amount => bookingCurrency.format(amount / 100).replace(/\.00$/, '');
    const festivalAmount = result.reduce((sum, day) => sum + day.collected, 0);
    const hasLedger = Number.isInteger(received);
    const choices = [
      ['Active paid festival tickets', tickets, 'paid', 'Active paid tickets by visit date'],
      [hasLedger ? 'Total money received' : 'Festival payments', money(hasLedger ? received : festivalAmount), 'collected', 'Festival collections by visit date'],
      [Number.isInteger(directoryParticipants) ? 'Total participants' : 'Festival participants',
        directoryParticipants ?? participants, 'participants', 'Festival participants by visit date'],
      ['Participants under 16', under16, 'under_16', 'Participants under 16 on each visit date'],
    ];
    const cards = element('div', '');
    cards.className = 'overview-selectors';
    const chart = element('section', '');
    chart.className = 'overview-chart';
    chart.id = 'metric-chart';
    chart.setAttribute('aria-live', 'polite');
    function select(index) {
      const [, , key, title] = choices[index];
      Array.from(cards.children).forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
      chart.replaceChildren(element('h3', title));
      if (key === 'participants' && Number.isInteger(directoryParticipants)) {
        chart.append(element('p', participants + ' festival participants + ' +
          (directoryParticipants - participants) + ' demo participants = ' + directoryParticipants));
      }
      if (key === 'collected' && hasLedger) {
        chart.append(element('p', money(festivalAmount) + ' festival payments + ' +
          money(received - festivalAmount) + ' other receipts (including demo payments) = ' + money(received)));
      }
      const max = Math.max(1, ...result.map(day => Number(day[key])));
      for (const day of result) {
        const row = element('div', '');
        const date = day.day.endsWith('21') ? 'Sat, 21 Nov' : 'Sun, 22 Nov';
        const value = key === 'collected' ? money(day[key]) : day[key];
        const track = document.createElement('progress');
        track.max = max;
        track.value = day[key];
        track.setAttribute('aria-label', date + ', ' + value);
        row.append(element('span', date), track, element('strong', value));
        chart.append(row);
      }
    }
    choices.forEach(([label, value], i) => {
      const button = element('button', '');
      button.type = 'button';
      button.setAttribute('aria-controls', chart.id);
      button.append(element('span', label), element('strong', String(value)));
      button.onclick = () => select(i);
      cards.append(button);
    });
    select(0);
    const lists = result.map(day => {
      const details = document.createElement('details');
      details.className = 'overview-roster';
      const date = day.day.slice(-2);
      const summary = element('summary', date + ' November participants');
      details.append(summary);
      // On touch screens, warm only the next relevant event date.
      if (matchMedia('(pointer: coarse)').matches) {
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
        if (date === (today < '2026-11-22' ? '21' : '22')) firstRosterPage(date).catch(() => {});
      }
      const warm = () => firstRosterPage(date).catch(() => {});
      summary.addEventListener('pointerenter', warm);
      summary.addEventListener('focus', warm);
      const container = document.createElement('div');
      details.append(container);
      details.ontoggle = () => {
        if (details.open && !container.childElementCount) {
          openRoster(date, day.registrations + ' bookings · ' + day.paid_under_16 + ' paid participants under 16', container);
        }
      };
      return details;
    });
    byId('admin-days').replaceChildren(cards, chart, ...lists);
    status.textContent = '';
  } catch (error) {
    status.textContent = error.message;
  }
}
breakdown.ontoggle = () => { if (session && breakdown.open) loadBreakdown(); };

function navigate(url) {
  history.pushState(null, '', url);
  showView();
}
function showView() {
  if (!session) return;
  clearTimeout(searchTimer);
  const params = new URLSearchParams(location.search);
  const requested = params.get('view');
  const view = requested === 'participants' || (requested === 'operations' && role === 'super') ? requested : 'overview';
  const overview = view === 'overview';
  message.textContent = '';
  ++loadVersion;
  listRequest?.abort();
  clearTimeout(attendanceTimer);
  resetRoster();
  byId('desk-directory').hidden = view !== 'participants';
  byId('admin-operations').hidden = view !== 'operations';
  byId('admin-operations').open = view === 'operations';
  byId('admin-daily-attendance').hidden = !overview || role !== 'super';
  breakdown.hidden = !overview;
  breakdown.open = overview;
  const title = { overview: 'Event overview', participants: 'Participants', operations: 'Event operations' }[view];
  byId('desk-overview').querySelector('h2').textContent = title;
  document.title = title + ' | Naya Bharat 2047';
  for (const link of document.querySelectorAll('[data-view]')) {
    if (link.dataset.view === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (overview && role === 'super') refreshAttendance();
  if (view === 'participants') {
    loadDashboard().catch(showError);
    const day = params.get('day');
    if (['21','22'].includes(day)) openRoster(day, day + ' November 2026');
  }
}
for (const link of document.querySelectorAll('[data-view]')) link.onclick = event => {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(link.href);
};
window.addEventListener('popstate', showView);

let searchTimer;
function showError(error) { message.textContent = error.message; }
login.addEventListener('submit', async event => {
  event.preventDefault();
  const feedback = login.querySelector('.login-feedback');
  feedback.textContent = '';
  const button = login.querySelector('button');
  button.disabled = true;
  message.textContent = '';
  button.textContent = 'Signing in…';
  try {
    const signInStarted = performance.now();
    const response = await fetch('/api/staff-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ workspace: 'admin', email: byId('admin-email').value, password: byId('admin-password').value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    performance.measure('festival.staff.sign-in', { start: signInStarted });
    session = result.token;
    role = result.role;
    document.body.classList.remove('signed-out');
    byId('admin-add').hidden = !['super', 'registration'].includes(role);
    byId('admin-operations').hidden = role !== 'super';
    byId('operations-link').hidden = role !== 'super';
    login.hidden = true;
    dashboard.hidden = false;
    page = 0;
    search = '';
    byId('admin-find').value = '';
    showView();
  } catch (error) { feedback.textContent = error.message; }
  finally { byId('admin-password').value = ''; button.disabled = false; button.textContent = 'Sign in'; }
});
byId('admin-sign-out').onclick = () => { signOut(); message.textContent = 'Signed out.'; };
byId('admin-search').onsubmit = event => {
  event.preventDefault();
  clearTimeout(searchTimer);
  search = byId('admin-find').value.trim();
  page = 0;
  loadDashboard().catch(showError);
};
byId('admin-find').oninput = event => {
  clearTimeout(searchTimer);
  if (event.isComposing) return;
  ++loadVersion;
  listRequest?.abort();
  search = event.target.value.trim();
  page = 0;
  const cached = cachedSearch();
  if (cached) {
    byId('admin-results').removeAttribute('aria-busy');
    renderDirectory(cached);
    return;
  }
  const term = search.toLowerCase();
  if (/^[a-z ]{2,}$/.test(term)) {
    const known = new Map();
    for (const entry of recentPages.values()) {
      for (const person of entry.result.participants) {
        if (nameMatches(person, term)) known.set(person.booking_id + '/' + person.position, person);
      }
    }
    byId('admin-results').replaceChildren(...renderBookings(Array.from(known.values()).slice(0, 25)));
  } else byId('admin-results').replaceChildren();
  byId('admin-empty').hidden = true;
  byId('admin-previous').disabled = true;
  byId('admin-next').disabled = true;
  message.textContent = 'Searching all participants…';
  searchTimer = setTimeout(() => loadDashboard().catch(showError), 100);
};
byId('admin-clear').onclick = () => {
  clearTimeout(searchTimer);
  byId('admin-find').value = '';
  search = '';
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
    clearDirectoryCache();
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
  const days = !spotForm.elements.visit.disabled && spotForm.elements.visit.value === 'both' ? 2 : 1;
  byId('spot-price').textContent = 'Collect ₹' + days * (eligible ? 100 : 200) + (eligible ? ' · Free food coupon' : '');
}

byId('admin-add').onclick = () => {
  spotForm.reset();
  spotRequest = crypto.randomUUID();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const advance = today < '2026-11-21';
  const open = today <= '2026-11-22';
  byId('spot-availability').hidden = open;
  for (const field of spotForm.querySelectorAll('label, #spot-price')) field.hidden = !open;
  byId('spot-visit').hidden = !advance;
  spotForm.elements.visit.disabled = !advance;
  spotForm.elements.mode.querySelector('[value=online]').disabled = advance;
  spotSubmit.textContent = advance ? 'Record cash and issue ticket' : 'Register and check in';
  spotSubmit.hidden = !open;
  spotSubmit.disabled = !open;
  byId('spot-message').textContent = '';
  byId('spot-result').replaceChildren();
  if (open) updateSpot();
  spot.showModal();
};
spotForm.oninput = event => {
  if (['mode', 'dob', 'reference', 'visit'].includes(event.target.name)) spotForm.elements.payment_confirmed.checked = false;
  updateSpot();
};
byId('spot-close').onclick = () => spot.close();
spot.addEventListener('cancel', event => { if (byId('spot-close').disabled) event.preventDefault(); });
spotForm.onsubmit = async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(spotForm));
  spotSubmit.disabled = true;
  byId('spot-close').disabled = true;
  byId('spot-message').textContent = 'Recording payment…';
  try {
    const result = await adminRequest({ ...data, action: 'spot', request_id: spotRequest, payment_confirmed: data.payment_confirmed === 'on' });
    byId('spot-message').textContent = `${data.visit ? 'TICKET ISSUED' : 'CHECKED IN'} · ${result.booking_id} · ${bookingCurrency.format(result.amount_paise / 100)} collected. ${data.visit ? 'Scan at the gate on arrival.' : 'Issue the wristband.'}${result.food_coupon_eligible ? ' Free food coupon eligible.' : ''}`;
    const download = element('button', 'Download ticket');
    download.type = 'button';
    download.onclick = () => downloadTicket({ ...result, position: 1 }, download);
    byId('spot-result').replaceChildren(download);
    clearDirectoryCache();
    loadDashboard().catch(showError);
    if (role === 'super') {
      refreshAttendance();
      if (byId('admin-operations').open) loadOperations();
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
  if (byId('admin-daily-attendance').hidden || role !== 'super' || document.hidden || attendanceRequest === session) return;
  const currentSession = session;
  attendanceRequest = currentSession;
  const status = byId('attendance-status');
  try {
    const days = await adminRequest({ action: 'daily_attendance' });
    const cards = days.map((day, index) => {
      const card = document.createElement('article');
      card.className = 'attendance-card';
      const title = `Day ${index + 1} · ${index === 0 ? '21' : '22'} November`;
      const count = element('strong', day.checked_in + ' of ' + day.registered + ' checked in');
      const remaining = element('small', day.not_checked_in + ' awaiting check-in');
      const progress = document.createElement('progress');
      progress.max = 100;
      progress.value = day.percentage;
      progress.setAttribute('aria-label', `${title} check-in percentage`);
      card.append(element('h3', title), count, progress, remaining);
      return card;
    });
    byId('attendance-cards').replaceChildren(...cards);
    status.textContent = `Updated ${attendanceUpdated.format(new Date())} IST · refreshes automatically`;
  } catch {
    if (session === currentSession) status.textContent = 'Attendance update unavailable. Retrying shortly…';
  } finally {
    if (attendanceRequest === currentSession) attendanceRequest = null;
    if (!byId('admin-daily-attendance').hidden && role === 'super' && session === currentSession && !document.hidden) {
      attendanceTimer = setTimeout(refreshAttendance, 5000 + Math.random() * 3000);
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

byId('admin-operations').ontoggle = () => {
  if (byId('admin-operations').open) loadOperations();
};

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
