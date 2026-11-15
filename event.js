// Preserve section links while opening the homepage at its top.
if (!window.location.hash) {
  history.scrollRestoration = 'manual';
  window.addEventListener('pageshow', () => {
    if (!window.location.hash) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  });
}

const countdown = document.querySelector('#countdown');
function updateCountdown() {
  const seconds = Math.max(0, Math.floor((Date.parse('2026-11-21T00:00:00+05:30') - Date.now()) / 1000));
  const values = [Math.floor(seconds / 86400), Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60];
  countdown.replaceChildren(...values.map((value, i) => {
    const item = document.createElement('span');
    const number = document.createElement('b');
    number.textContent = String(value).padStart(2, '0');
    const label = document.createElement('small');
    label.textContent = ['Days', 'Hours', 'Minutes', 'Seconds'][i];
    item.append(number, label);
    return item;
  }));
}
updateCountdown();
setInterval(updateCountdown, 1000);
for (const button of document.querySelectorAll('[data-section]')) {
  button.addEventListener('click', () => {
    for (const tab of document.querySelectorAll('[data-section]')) {
      const active = tab === button;
      tab.setAttribute('aria-pressed', String(active));
      document.getElementById(tab.dataset.section).hidden = !active;
    }
  });
}
