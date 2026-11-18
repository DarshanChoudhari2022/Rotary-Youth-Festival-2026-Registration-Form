// Preserve section links while opening the homepage at its top.
if (!window.location.hash) {
  history.scrollRestoration = 'manual';
  window.addEventListener('pageshow', () => {
    if (!window.location.hash) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  });
}

const countdowns = document.querySelectorAll('.festival-countdown');
function updateCountdown() {
  const seconds = Math.max(0, Math.floor((Date.parse('2026-11-21T00:00:00+05:30') - Date.now()) / 1000));
  const values = [Math.floor(seconds / 86400), Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60];
  const units = values.map((value, i) => {
    const item = document.createElement('span');
    const number = document.createElement('b');
    number.textContent = String(value).padStart(2, '0');
    const label = document.createElement('small');
    label.textContent = ['Days', 'Hours', 'Minutes', 'Seconds'][i];
    item.append(number, label);
    return item;
  });
  for (const countdown of countdowns) countdown.replaceChildren(...units.map(unit => unit.cloneNode(true)));
}
updateCountdown();
setInterval(updateCountdown, 1000);

const hero = document.querySelector('.festival-hero');
const countdownSlide = document.querySelector('#festival-countdown-slide');
const offerSlide = document.querySelector('#festival-offer-slide');
const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
const hover = window.matchMedia('(hover: hover)');
let heroTimer;
let heroInView = true;

function scheduleHero() {
  clearTimeout(heroTimer);
  if (heroInView && !motion.matches && !document.hidden && !hero.contains(document.activeElement)
      && !(hover.matches && hero.matches(':hover'))) {
    heroTimer = setTimeout(toggleHero, 5000);
  }
}

function toggleHero() {
  const showingOffer = hero.dataset.slide !== 'offer';
  hero.dataset.slide = showingOffer ? 'offer' : 'countdown';
  countdownSlide.inert = showingOffer;
  countdownSlide.setAttribute('aria-hidden', String(showingOffer));
  offerSlide.inert = !showingOffer;
  offerSlide.setAttribute('aria-hidden', String(!showingOffer));
  scheduleHero();
}

hero.addEventListener('focusin', scheduleHero);
hero.addEventListener('focusout', () => setTimeout(scheduleHero, 0));
hero.addEventListener('mouseenter', scheduleHero);
hero.addEventListener('mouseleave', scheduleHero);
document.addEventListener('visibilitychange', scheduleHero);
motion.addEventListener('change', scheduleHero);
if ('IntersectionObserver' in window) {
  new IntersectionObserver(([entry]) => {
    heroInView = entry.isIntersecting;
    scheduleHero();
  }).observe(hero);
}
scheduleHero();

for (const button of document.querySelectorAll('[data-section]')) {
  button.addEventListener('click', () => {
    for (const tab of document.querySelectorAll('[data-section]')) {
      const active = tab === button;
      tab.setAttribute('aria-pressed', String(active));
      document.getElementById(tab.dataset.section).hidden = !active;
    }
  });
}
