import { LEAGUES, STATUS, ROUNDS, loadStandings, loadPostseason, logoUrl } from './data.js';

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

/* ---------- postseason ---------- */

const logo = (id, size = 22) =>
  `<img class="logo" src="${logoUrl(id)}" alt="" width="${size}" height="${size}" loading="lazy" onerror="this.style.visibility='hidden'">`;

const fmtDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

const score = (s) => `${Math.max(...s.teams.map((t) => t.wins))}–${Math.min(...s.teams.map((t) => t.wins))}`;

// Bracket position of each series. Grid rows 2–5 hold AL (2–3) and NL (4–5); row 1 is the round headings.
// Wild card 4v5 feeds the 1 seed and 3v6 feeds the 2 seed, so they line up with those division series.
function slotOf(s) {
  const base = s.league === 'NL' ? 4 : 2;
  const has = (...seeds) => s.teams.some((t) => seeds.includes(t.seed));
  switch (s.round) {
    case 'F': return { col: 1, row: base + (has(4, 5) ? 0 : 1), span: 1 };
    case 'D': return { col: 2, row: base + (has(1) ? 0 : 1), span: 1 };
    case 'L': return { col: 3, row: base, span: 2 };
    default:  return { col: 4, row: 2, span: 4 };
  }
}

function seriesBox(s, slot) {
  const pos = `grid-column:${slot.col};grid-row:${slot.row} / span ${slot.span}`;
  if (!s) return `<div class="series is-tbd" style="${pos}"><p class="series-meta">TBD</p></div>`;
  const ws = s.round === 'W';
  const meta = `${ws ? 'World Series' : s.league} · Best of ${s.bestOf}`;
  const rows = s.teams
    .map((t) => {
      const cls = s.winner ? (s.winner.id === t.id ? 'is-win' : 'is-out') : '';
      return (
        // seeds are per league, so in the World Series show the league instead
        `<div class="st ${cls}">${logo(t.id)}<span class="seed">${ws ? t.league || '' : t.seed ?? ''}</span>` +
        `<span class="nick">${esc(t.nick)}</span><span class="w">${t.wins}</span></div>`
      );
    })
    .join('');
  const foot = ws && s.winner
    ? `<p class="champ">${logo(s.winner.id, 44)}<span><small>World Series champions</small>${esc(s.winner.nick)}</span></p>`
    : '';
  return `<div class="series${ws ? ' is-ws' : ''}" style="${pos}"><p class="series-meta">${meta}</p>${rows}${foot}</div>`;
}

function bracket(ps) {
  const out = [];
  const cols = { F: 1, D: 2, L: 3, W: 4 };
  for (const [round, label] of Object.entries(ROUNDS)) {
    out.push(`<h3 class="round-head" style="grid-column:${cols[round]};grid-row:1">${label}</h3>`);
    const inRound = ps.series.filter((s) => s.round === round);
    // every slot gets a box, so later rounds show as TBD while the postseason is under way
    const slots = round === 'W' ? [slotOf({ round })]
      : round === 'L' ? ['AL', 'NL'].map((league) => slotOf({ round, league }))
      : ['AL', 'NL'].flatMap((league) => [0, 1].map((k) => ({ col: cols[round], row: (league === 'NL' ? 4 : 2) + k, span: 1 })));
    const placed = inRound.map((s) => [slotOf(s), s]);
    for (const slot of slots) {
      const hit = placed.find(([p]) => p.row === slot.row && p.col === slot.col);
      out.push(seriesBox(hit ? hit[1] : null, slot));
    }
  }
  return `<div class="bracket">${out.join('')}</div>`;
}

function gamesCard(s, i) {
  const [a, b] = s.teams;
  const sub = s.winner
    ? `${esc(s.winner.nick)} win ${score(s)}`
    : s.games.length ? `Series ${a.wins}–${b.wins}` : 'Not started';
  const side = (t) =>
    `<span class="team ${t.win ? 'is-win' : ''}" role="cell">${logo(t.id)}<span class="nick">${esc(t.abbr)}</span></span>` +
    `<span class="num ${t.win ? 'is-win' : 'soft'}" role="cell">${t.score}</span>`;
  const rows = s.games
    .map((g) =>
      `<div class="row" role="row"><span class="rank" role="cell">G${g.n}</span><span class="soft date" role="cell">${fmtDay(g.date)}</span>` +
      `${side(g.away)}<span class="at" role="cell">@</span>${side(g.home)}</div>`)
    .join('');
  const head =
    '<div class="row row-head" role="row"><span role="columnheader" class="rank">G</span><span role="columnheader" class="date">Date</span>' +
    '<span role="columnheader" class="team-col">Away</span><span role="columnheader"></span><span role="columnheader"></span>' +
    '<span role="columnheader" class="team-col">Home</span><span role="columnheader"></span></div>';
  const title = { W: 'World Series', L: `${s.league}CS`, D: `${s.league}DS`, F: `${s.league} Wild Card` }[s.round];
  return (
    `<article class="card" style="--i:${i}"><header class="card-head"><h2>${title}</h2>` +
    `<p class="card-sub">${esc(a.nick)} vs ${esc(b.nick)} · ${sub}</p></header>` +
    `<div class="table table-games" role="table" aria-label="${title} games">${head}${rows}</div></article>`
  );
}

function postseasonView(ps) {
  // newest round first: World Series, then LCS, LDS, Wild Card (AL before NL)
  const order = { W: 0, L: 1, D: 2, F: 3 };
  const series = [...ps.series].sort(
    (x, y) => order[x.round] - order[y.round] || (x.league || '').localeCompare(y.league || '') || slotOf(x).row - slotOf(y).row
  );
  return (
    bracket(ps) +
    '<h2 class="section-head">Every game</h2>' +
    series.map(gamesCard).join('')
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

  const psTab = tabs.find((t) => t.dataset.league === 'PS');

  let current = null;
  let data = null;
  let post = null;
  let loading = null;

  const VIEWS = { AL: LEAGUES.AL.name, NL: LEAGUES.NL.name, PS: 'Postseason' };

  function load() {
    grid.innerHTML = '<p class="state">Loading standings…</p>';
    loading = loadStandings()
      .then(async (d) => {
        // the postseason is a bonus: if it fails to load, still show the standings
        post = await loadPostseason(d).catch((err) => { console.error(err); return null; });
        data = d;
        psTab.hidden = !post;
        updated.textContent = d.updated ? `Updated ${fmtUpdated(d.updated)}` : '';
        if (current === 'PS' && !post) render('AL', { animate: false });
        else { setEyebrow(); build(); }
      })
      .catch((err) => {
        console.error(err);
        grid.innerHTML =
          '<div class="state"><p>Couldn’t reach the MLB standings service.</p><button type="button" class="btn" data-retry>Try again</button></div>';
        grid.querySelector('[data-retry]').addEventListener('click', load);
      })
      .finally(() => { loading = null; });
  }

  function setEyebrow() {
    if (!data) return;
    eyebrow.textContent = current === 'PS'
      ? `${post.season} · Postseason${post.done ? ' · Final' : ''}`
      : `${data.season} · Regular season${data.final ? ' · Final' : ''}`;
  }

  function build() {
    if (!data) return;
    if (current === 'PS') {
      grid.innerHTML = postseasonView(post);
      grid.classList.remove('is-swapping');
      return;
    }
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
    // the postseason tab only exists once the postseason has started
    if (!VIEWS[league] || (league === 'PS' && data && !post)) league = 'AL';
    const changed = league !== current;
    current = league;

    tabs.forEach((t) => {
      const on = t.dataset.league === league;
      t.classList.toggle('is-on', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
    });

    const swap = () => {
      title.textContent = `${VIEWS[league]}.`;
      // "Postseason." is one long word that can't wrap, so it gets a slightly smaller size
      title.classList.toggle('is-long', league === 'PS');
      grid.dataset.view = league;
      setEyebrow();
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
      const shown = tabs.filter((t) => !t.hidden);
      const i = shown.findIndex((t) => t.dataset.league === current);
      const next = shown[(i + (e.key === 'ArrowRight' ? 1 : -1) + shown.length) % shown.length];
      render(next.dataset.league);
      next.focus();
    }
  });

  return { show: render, reload: load, get league() { return current; } };
}
