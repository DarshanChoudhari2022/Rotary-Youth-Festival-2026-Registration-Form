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
};
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

function ageOn(dob, day) {
  const [year, month, date] = dob.split('-').map(Number);
  return 2026 - year - Number(month > 11 || (month === 11 && date > day));
}

function addParticipant() {
  const card = template.content.firstElementChild.cloneNode(true);
  card.querySelector('.participant-title').textContent = `Participant ${cards.children.length + 1}`;
  card.querySelector('[name=dob]').max = today;
  card.open = true;
  for (const existing of cards.children) existing.open = false;
  cards.append(card);
}

function updateBooking() {
  const visit = visits[form.elements.visit.value];
  const quantity = cards.children.length;
  let hasMinor = false;
  for (const card of cards.children) {
    const inputs = [...card.querySelectorAll('input')];
    for (const input of inputs.filter(input => ['first', 'last'].includes(input.name))) {
      input.setCustomValidity(input.value && !input.value.trim() ? 'Enter a name.' : '');
    }
    const dob = card.querySelector('[name=dob]');
    const days = visit?.days ?? [21];
    if (dob.value && dob.validity.valid) {
      hasMinor ||= ageOn(dob.value, days[0]) < 18;
    }
    card.querySelector('.eligibility').textContent = dob.value && dob.validity.valid && visit
      ? days.filter(day => ageOn(dob.value, day) < 16)
        .map(day => `Food coupon eligible on ${day} November.`).join(' ')
      : '';
    card.querySelector('.participant-status').textContent =
      inputs.every(input => input.validity.valid) ? '✓ Completed' : '';
  }

  guardianRow.hidden = !hasMinor;
  guardian.disabled = !hasMinor;
  guardian.required = hasMinor;
  if (!hasMinor) guardian.checked = false;
  plus.disabled = quantity === 10;
  minus.disabled = quantity === 1;
  document.querySelector('#count').value = quantity;
  document.querySelector('#visit-summary').textContent = visit?.label ?? 'Choose your visit';
  const participants = `${quantity} participant${quantity === 1 ? '' : 's'}`;
  const total = visit ? currency.format(visit.price * quantity) : '';
  document.querySelector('#breakdown').textContent = visit
    ? `${participants} · ${currency.format(visit.price)} × ${quantity} = ${total}` : participants;
  pay.disabled = !visit;
  pay.textContent = visit ? `PAY ${total}` : 'Select a visit';
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
form.addEventListener('invalid', event => {
  const card = event.target.closest('details');
  if (card) card.open = true;
}, true);

form.addEventListener('submit', event => {
  event.preventDefault();
  const visit = visits[form.elements.visit.value];
  document.querySelector('#review-total').textContent =
    `${visit.label} · ${cards.children.length} ticket(s) · ${currency.format(visit.price * cards.children.length)}`;
  const list = document.querySelector('#review-participants');
  list.replaceChildren();
  const participants = [];
  for (const card of cards.children) {
    const item = document.createElement('li');
    const fields = Object.fromEntries([...card.querySelectorAll('input')].map(input => [input.name, input.value]));
    fields.first = fields.first.trim();
    fields.last = fields.last.trim();
    participants.push(fields);
    item.textContent = `${fields.first.trim()} ${fields.last.trim()} · +91 ${fields.mobile} · ${fields.email} · ${fields.dob}`;
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
      saveStatus.textContent = result.error || 'Registration could not be saved. Please retry.';
      return;
    }
    savedBooking = result;
    renderSaveStatus();
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
