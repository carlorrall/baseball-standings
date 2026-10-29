import { createBall } from './ball.js';
import { initStandings } from './standings.js';

const home = document.getElementById('home');
const stage = document.getElementById('stage');
const standingsView = document.getElementById('standings');

let ball = null;

// each tab has its own address, so a refresh or shared link lands on the same tab
const HASHES = {
  AL: '#/standings/al',
  NL: '#/standings/nl',
  PS: '#/postseason',
  HL: '#/highlights',
  HR: '#/derby',
};

const standings = initStandings(standingsView, {
  onLeagueChange: (league) => {
    // keep the URL in sync so a refresh / shared link lands on the same view
    const target = HASHES[league];
    if (location.hash !== target) history.replaceState(null, '', target);
  },
});

function parseHash() {
  for (const [key, hash] of Object.entries(HASHES)) {
    if (key !== 'AL' && key !== 'NL' && location.hash.toLowerCase().startsWith(hash)) return { view: 'standings', league: key };
  }
  const m = location.hash.match(/^#\/standings(?:\/(al|nl))?/i);
  return m ? { view: 'standings', league: (m[1] || 'al').toUpperCase() } : { view: 'home' };
}

function setActive(view) {
  const isHome = view === 'home';
  home.classList.toggle('is-active', isHome);
  standingsView.classList.toggle('is-active', !isHome);
  home.setAttribute('aria-hidden', String(!isHome));
  standingsView.setAttribute('aria-hidden', String(isHome));
  standingsView.inert = isHome;
  home.inert = !isHome;
  document.body.dataset.view = view;
  if (!isHome) standingsView.scrollTop = 0;
}

function route() {
  const r = parseHash();
  if (r.view === 'standings') {
    standings.show(r.league, { animate: false });
    setActive('standings');
    // stop rendering once the ball has faded out
    setTimeout(() => { if (document.body.dataset.view === 'standings') ball && ball.stop(); }, 700);
  } else {
    standings.pause();
    if (!ball) {
      ball = createBall(stage, { onOpen: () => { location.hash = '#/standings/al'; } });
    } else {
      ball.reset();
    }
    setActive('home');
    ball.start();
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('keydown', (e) => {
  if (document.body.dataset.view !== 'standings') return;
  if (e.key === 'Escape') location.hash = '';
});

document.getElementById('back').addEventListener('click', (e) => {
  e.preventDefault();
  location.hash = '';
});

route();
document.body.classList.add('is-ready');

// small hook for automated screenshots / debugging
window.__app = { get ball() { return ball; }, standings };
