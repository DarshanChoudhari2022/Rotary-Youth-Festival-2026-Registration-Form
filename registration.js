// Preserve section links while opening the homepage at its top.
if (!window.location.hash) {
  history.scrollRestoration = 'manual';
  window.addEventListener('pageshow', () => {
    if (!window.location.hash) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  });
}

const form = document.querySelector('#booking');
const cards = document.querySelector('#participants');
const template = document.querySelector('#participant-template');
const guardian = document.querySelector('#guardian');
const guardianRow = document.querySelector('#guardian-row');
const plus = document.querySelector('#plus');
const minus = document.querySelector('#minus');
const pay = document.querySelector('#pay');
const review = document.querySelector('#review');
const save = document.querySelector('#save-booking');
const saveStatus = document.querySelector('#save-status');
let draftKey = '';
let draftId;
let reviewedBooking;
let savedBooking;
const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 0,
});
const visits = {
  21: { label: '21 November 2026', price: 200, days: [21] },
  22: { label: '22 November 2026', price: 200, days: [22] },
  both: { label: '21–22 November 2026', price: 400, days: [21, 22] },
  demo: { label: 'Demo ticket · no festival admission', price: 1, days: [21] },
};
const offerCutoff = '2010-11-01';
const secondDay = '2026-11-22';
const eventClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
});

function eventDate() {
  const parts = Object.fromEntries(eventClock.formatToParts(new Date()).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function eligibleForOffer(dob) {
  return dob.validity.valid && dob.value >= offerCutoff;
}

function bookingTotal(visit, discountCount) {
  return visit.price * cards.children.length - (visit.price / 2) * discountCount;
}

function ageOn(dob, day) {
  const [year, month, date] = dob.split('-').map(Number);
  return 2026 - year - Number(month > 11 || (month === 11 && date > day));
}

function addParticipant() {
  const card = template.content.firstElementChild.cloneNode(true);
  card.querySelector('.participant-title').textContent = `Participant ${cards.children.length + 1}`;
  card.querySelector('[name=dob]').max = eventDate();
  for (const input of card.querySelectorAll('input')) {
    const error = document.createElement('span');
    error.className = 'field-error';
    error.id = `error-${cards.children.length + 1}-${input.name}`;
    input.setAttribute('aria-describedby', error.id);
    input.closest('label').append(error);
    const showError = () => {
      error.textContent = input.validationMessage;
      input.setAttribute('aria-invalid', String(!input.validity.valid));
    };
    input.addEventListener('blur', showError);
    input.addEventListener('invalid', showError);
    input.addEventListener('input', () => {
      if (input.getAttribute('aria-invalid') === 'true') {
        updateBooking();
        showError();
      }
    });
  }
  card.open = true;
  for (const existing of cards.querySelectorAll('details[open]')) existing.open = false;
  cards.append(card);
}

function updateBooking() {
  const today = eventDate();
  for (const option of form.querySelectorAll('[name=visit]')) {
    const unavailable = today === secondDay && option.value !== '22';
    option.closest('label').hidden = unavailable;
    option.disabled = unavailable || (option.value === 'demo' && cards.children.length > 1);
    if (unavailable) option.checked = false;
  }
  const visit = visits[form.elements.visit.value];
  const quantity = cards.children.length;
  const isDemo = form.elements.visit.value === 'demo';
  let hasMinor = false;
  let discountCount = 0;
  for (const card of cards.children) {
    const inputs = [...card.querySelectorAll('input')];
    for (const input of inputs.filter(input => ['first', 'last'].includes(input.name))) {
      input.setCustomValidity(input.value && !input.value.trim() ? 'Enter a name.' : '');
    }
    const dob = card.querySelector('[name=dob]');
    dob.max = today;
    const days = visit?.days ?? [21];
    if (dob.value && dob.validity.valid) {
      hasMinor ||= ageOn(dob.value, days[0]) < 18;
    }
    const eligible = visit && !isDemo && eligibleForOffer(dob);
    if (eligible) discountCount++;
    card.querySelector('.eligibility').textContent = eligible ? '₹100 per day · Free food coupon included.' : '';
    card.querySelector('.participant-status').textContent =
      inputs.every(input => input.validity.valid) ? '✓ Completed' : '';
  }

  guardianRow.hidden = !hasMinor;
  guardian.disabled = !hasMinor;
  guardian.required = hasMinor;
  if (!hasMinor) guardian.checked = false;
  plus.disabled = quantity >= 10 || isDemo;
  minus.disabled = quantity === 1;
  document.querySelector('#count').value = quantity;
  document.querySelector('#visit-summary').textContent = visit?.label ?? 'Choose your visit';
  const participants = `${quantity} participant${quantity === 1 ? '' : 's'}`;
  const total = visit ? currency.format(bookingTotal(visit, discountCount)) : '';
  document.querySelector('#breakdown').textContent = visit
    ? `${participants}${discountCount ? ` · ${discountCount} with 50% off` : ''} · ${total}` : participants;
  pay.disabled = !visit;
  pay.textContent = visit ? `Review · ${total}` : 'Select a visit';
}

for (const link of document.querySelectorAll('[data-policy]')) {
  link.href = `policies/${link.dataset.policy}.html`;
  link.target = '_blank';
  link.rel = 'noopener';
}

plus.addEventListener('click', () => {
  if (cards.children.length >= 10) return;
  addParticipant();
  updateBooking();
  if (plus.disabled) cards.lastElementChild.querySelector('summary').focus();
});

minus.addEventListener('click', () => {
  if (cards.children.length <= 1) return;
  const last = cards.lastElementChild;
  if ([...last.querySelectorAll('input')].some(input => input.value)
      && !window.confirm(`Remove Participant ${cards.children.length} and their details?`)) return;
  last.remove();
  updateBooking();
  if (minus.disabled) plus.focus();
});

form.addEventListener('input', updateBooking);
window.addEventListener('pageshow', updateBooking);
document.addEventListener('visibilitychange', () => { if (!document.hidden) updateBooking(); });
let lastEventDate = eventDate();
setInterval(() => {
  const current = eventDate();
  if (current !== lastEventDate) { lastEventDate = current; updateBooking(); }
}, 15000);
form.addEventListener('invalid', event => {
  const card = event.target.closest('details');
  if (card) card.open = true;
}, true);

form.addEventListener('submit', event => {
  event.preventDefault();
  updateBooking();
  const visit = visits[form.elements.visit.value];
  if (!visit) return;
  const discountCount = form.elements.visit.value === 'demo' ? 0
    : [...cards.querySelectorAll('[name=dob]')].filter(eligibleForOffer).length;
  document.querySelector('#review-total').textContent =
    `${visit.label} · ${cards.children.length} ticket(s)${discountCount ? ` · ${discountCount} with 50% off` : ''} · ${currency.format(bookingTotal(visit, discountCount))}`;
  const list = document.querySelector('#review-participants');
  list.replaceChildren();
  const participants = [];
  for (const card of cards.children) {
    const item = document.createElement('li');
    const fields = Object.fromEntries([...card.querySelectorAll('input')].map(input => [input.name, input.value]));
    fields.first = fields.first.trim();
    fields.last = fields.last.trim();
    participants.push(fields);
    const name = document.createElement('strong');
    name.textContent = `${fields.first} ${fields.last}`;
    const details = document.createElement('dl');
    for (const [label, value] of [
      ['Mobile', fields.mobile && `+91 ${fields.mobile}`], ['Email', fields.email],
      ['Date of birth', fields.dob.split('-').reverse().join('/')],
      ['College / organisation', fields.organization], ['City', fields.city],
    ]) {
      if (!value?.trim()) continue;
      const term = document.createElement('dt');
      const detail = document.createElement('dd');
      term.textContent = label;
      detail.textContent = value;
      details.append(term, detail);
    }
    item.append(name, details);
    list.append(item);
  }
  const booking = { visit: form.elements.visit.value, participants,
    guardianConsent: guardian.checked,
    declarations: { accuracy: true, policies: true, refund: true, food: true } };
  const key = JSON.stringify(booking);
  if (key !== draftKey) {
    draftKey = key;
    draftId = crypto.randomUUID();
    savedBooking = null;
  }
  reviewedBooking = { ...booking, requestId: draftId };
  renderSaveStatus();
  review.showModal();
});

function renderSaveStatus() {
  saveStatus.textContent = savedBooking
    ? `Registration ${savedBooking.registration_id} · ${currency.format(savedBooking.amount_paise / 100)} · Payment pending`
    : '';
  save.disabled = Boolean(savedBooking);
}

save.addEventListener('click', async () => {
  save.disabled = true;
  saveStatus.textContent = 'Saving registration…';
  const close = review.querySelector('[type=submit]');
  close.disabled = true;
  try {
    const response = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reviewedBooking),
    });
    const result = await response.json();
    if (!response.ok) {
      const card = cards.children[result.participant - 1];
      const field = card && [...card.querySelectorAll('input')].find(input => input.name === result.field);
      if (field) {
        field.setCustomValidity(result.error);
        field.addEventListener('input', () => field.setCustomValidity(''), { once: true, capture: true });
        review.close();
        card.open = true;
        field.focus();
        field.reportValidity();
        return;
      }
      saveStatus.textContent = result.error || 'Registration could not be saved. Please retry.';
      return;
    }
    result.needsPayerMobile = !reviewedBooking.participants[0].mobile;
    savedBooking = result;
    renderSaveStatus();
    try {
      sessionStorage.setItem('festival-registration', JSON.stringify(result));
    } catch {
      // Keep the registration ID visible if session storage is unavailable.
      return;
    }
    let destination = '/thank-you.html';
    if (result.access && result.status === 'pending' && !result.needsPayerMobile) {
      saveStatus.textContent = 'Opening secure checkout…';
      try {
        const checkout = await fetch('/api/payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access: result.access, action: 'start' }),
          signal: AbortSignal.timeout(20000),
        });
        if (checkout.ok) {
          const { checkout_url: url } = await checkout.json();
          if (typeof url === 'string' && /^https:\/\/pay\.easebuzz\.in\/pay\/[A-Za-z0-9_-]+$/.test(url)) destination = url;
        }
      } catch {
        // The saved booking remains available for resuming payment.
      }
    }
    window.location.assign(destination);
  } catch {
    saveStatus.textContent = 'Registration could not be verified. Please retry.';
  } finally {
    save.disabled = Boolean(savedBooking);
    close.disabled = false;
  }
});
review.addEventListener('cancel', event => {
  if (review.querySelector('[type=submit]').disabled) event.preventDefault();
});

addParticipant();
updateBooking();

const bookingBar = document.querySelector('.summary');
function reserveBookingBarSpace() {
  document.body.style.setProperty('--booking-bar-height', `${Math.ceil(bookingBar.getBoundingClientRect().height)}px`);
}
reserveBookingBarSpace();
if ('ResizeObserver' in window) new ResizeObserver(reserveBookingBarSpace).observe(bookingBar);
else window.addEventListener('resize', reserveBookingBarSpace);
