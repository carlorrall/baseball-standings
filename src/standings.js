import { LEAGUES, STATUS, loadStandings, logoUrl } from './data.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// "-" from the API means leader; show an en dash
const gbText = (v) => (!v || v === '-' ? '–' : v);

function teamCell(t) {
  // eliminated rows are already greyed out; only clinched teams get a letter
  const tag = t.status && t.status !== 'e' ? `<abbr class="tag" title="${STATUS[t.status]}">${t.status}</abbr>` : '';
  return (
    `<span class="team" role="cell" title="${esc(t.name)}">` +
    `<img class="logo" src="${logoUrl(t.id)}" alt="" width="22" height="22" loading="lazy" onerror="this.style.visibility='hidden'">` +
    `<span class="nick">${esc(t.nick)}</span>${tag}</span>`
  );
}

function table({ label, cols, rows, cutAfter, kind }) {
  const head =
    '<div class="row row-head" role="row">' +
    cols.map((c) => `<span role="columnheader" class="${c.cls || ''}">${c.label}</span>`).join('') +
    '</div>';
  const body = rows
    .map((t, i) => {
      const cls = ['row', t.status ? `is-${t.status}` : '', cutAfter === i + 1 ? 'is-cut' : ''].join(' ');
      return `<div class="${cls}" role="row">${cols.map((c) => c.cell(t, i)).join('')}</div>`;
    })
    .join('');
  return `<div class="table table-${kind}" role="table" aria-label="${esc(label)}">${head}${body}</div>`;
}

const num = (v, cls = '') => `<span class="num ${cls}" role="cell">${esc(v)}</span>`;

const DIVISION_COLS = [
  { label: '#', cls: 'rank', cell: (t, i) => `<span class="rank" role="cell">${i + 1}</span>` },
  { label: 'Team', cls: 'team-col', cell: teamCell },
  { label: 'W', cell: (t) => num(t.w) },
  { label: 'L', cell: (t) => num(t.l) },
  { label: 'Pct', cell: (t) => num(t.pct) },
  { label: 'GB', cell: (t) => num(gbText(t.gb), 'soft') },
  { label: 'L10', cls: 'opt', cell: (t) => num(t.l10, 'soft opt') },
];

const WILDCARD_COLS = [
  { label: '#', cls: 'rank', cell: (t, i) => `<span class="rank" role="cell">${i + 1}</span>` },
  { label: 'Team', cls: 'team-col', cell: teamCell },
  { label: 'W', cell: (t) => num(t.w) },
  { label: 'L', cell: (t) => num(t.l) },
  { label: 'Pct', cell: (t) => num(t.pct) },
  { label: 'WCGB', cell: (t) => num(gbText(t.wcgb), 'soft') },
  { label: 'L10', cls: 'opt', cell: (t) => num(t.l10, 'soft opt') },
  { label: 'Strk', cls: 'opt', cell: (t) => num(t.streak, 'soft opt') },
];

function section(title, html, i, extra = '') {
  return `<article class="card ${extra}" style="--i:${i}"><header class="card-head"><h2>${title}</h2></header>${html}</article>`;
}

function legend() {
  return (
    '<ul class="legend">' +
    Object.entries(STATUS)
      .map(([k, v]) => `<li class="is-${k}"><span class="tag">${k}</span>${v}</li>`)
      .join('') +
    '</ul>'
  );
}

const fmtUpdated = (d) =>
  d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function initStandings(root, { onLeagueChange } = {}) {
  const grid = root.querySelector('#divisions');
  const title = root.querySelector('#leagueTitle');
  const eyebrow = root.querySelector('#eyebrow');
  const updated = root.querySelector('#updated');
  const tabs = [...root.querySelectorAll('.switch [data-league]')];

  let current = null;
  let data = null;
  let loading = null;

  function load() {
    grid.innerHTML = '<p class="state">Loading standings…</p>';
    loading = loadStandings()
      .then((d) => {
        data = d;
        eyebrow.textContent = `${d.season} · Regular season${d.final ? ' · Final' : ''}`;
        updated.textContent = d.updated ? `Updated ${fmtUpdated(d.updated)}` : '';
        build();
      })
      .catch((err) => {
        console.error(err);
        grid.innerHTML =
          '<div class="state"><p>Couldn’t reach the MLB standings service.</p><button type="button" class="btn" data-retry>Try again</button></div>';
        grid.querySelector('[data-retry]').addEventListener('click', load);
      })
      .finally(() => { loading = null; });
  }

  function build() {
    if (!data) return;
    const league = data[current];
    // six teams per league make the playoffs: three division winners + three wild cards
    const wcSpots = 3;
    grid.innerHTML =
      league.divisions
        .map((d, i) => section(d.name, table({ label: `${LEAGUES[current].name} ${d.name}`, cols: DIVISION_COLS, rows: d.teams, kind: 'division' }), i))
        .join('') +
      section(
        'Wild Card',
        table({ label: `${LEAGUES[current].name} Wild Card`, cols: WILDCARD_COLS, rows: league.wildCard, cutAfter: wcSpots, kind: 'wildcard' }),
        3,
        'card-wide'
      ) +
      legend();
    grid.classList.remove('is-swapping');
  }

  function render(league, { animate = true } = {}) {
    if (!LEAGUES[league]) league = 'AL';
    const changed = league !== current;
    current = league;

    tabs.forEach((t) => {
      const on = t.dataset.league === league;
      t.classList.toggle('is-on', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
    });

    const swap = () => {
      title.textContent = `${LEAGUES[league].name}.`;
      build();
    };

    if (animate && changed && data) {
      grid.classList.add('is-swapping');
      title.classList.add('is-swapping');
      setTimeout(() => { swap(); title.classList.remove('is-swapping'); }, 180);
    } else {
      swap();
    }
    if (!data && !loading) load();
    if (changed && onLeagueChange) onLeagueChange(league);
  }

  tabs.forEach((t) => t.addEventListener('click', () => render(t.dataset.league)));
  root.querySelector('.switch').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const next = current === 'AL' ? 'NL' : 'AL';
      render(next);
      tabs.find((t) => t.dataset.league === next).focus();
    }
  });

  return { show: render, reload: load, get league() { return current; } };
}
