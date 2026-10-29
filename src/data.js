// Live standings from the public MLB Stats API (CORS-enabled, no key needed).
// Docs-by-example: https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=2026

const API = 'https://statsapi.mlb.com/api/v1/standings';

export const LEAGUES = {
  AL: { id: 103, name: 'American League' },
  NL: { id: 104, name: 'National League' },
};

// division id -> [league, short name]; listed East, Central, West for display order
const DIVISIONS = {
  201: ['AL', 'East'], 202: ['AL', 'Central'], 200: ['AL', 'West'],
  204: ['NL', 'East'], 205: ['NL', 'Central'], 203: ['NL', 'West'],
};
const DIVISION_ORDER = [201, 202, 200, 204, 205, 203];

// Clinch indicators, as used on MLB.com
export const STATUS = {
  z: 'Best record in league',
  y: 'Clinched division',
  w: 'Clinched wild card',
  x: 'Clinched playoff berth',
  e: 'Eliminated',
};

export const logoUrl = (teamId) => `https://www.mlbstatic.com/team-logos/${teamId}.svg`;

function statusOf(t) {
  if (t.clinchIndicator) return t.clinchIndicator;
  // no indicator yet, but mathematically out of both the division and wild-card races
  if (t.eliminationNumber === 'E' && t.wildCardEliminationNumber === 'E') return 'e';
  return null;
}

function toTeam(t) {
  const split = (type) => t.records?.splitRecords?.find((r) => r.type === type);
  const l10 = split('lastTen');
  return {
    id: t.team.id,
    name: t.team.name,
    nick: t.team.clubName || t.team.teamName || t.team.name,
    abbr: t.team.abbreviation,
    w: t.wins,
    l: t.losses,
    pct: t.winningPercentage || t.leagueRecord?.pct,
    gb: t.gamesBack,
    wcgb: t.wildCardGamesBack,
    wcRank: t.wildCardRank ? Number(t.wildCardRank) : null,
    divRank: Number(t.divisionRank),
    leagueRank: Number(t.leagueRank),
    l10: l10 ? `${l10.wins}-${l10.losses}` : '–',
    streak: t.streak?.streakCode || '–',
    status: statusOf(t),
    updated: t.lastUpdated,
  };
}

async function fetchSeason(season) {
  const url = `${API}?leagueId=103,104&season=${season}&standingsTypes=regularSeason&hydrate=team`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MLB API responded ${res.status}`);
  const json = await res.json();
  return json.records || [];
}

// Returns { season, updated, final, AL: { divisions: [{ name, teams }], wildCard: [...] }, NL: {...} }
export async function loadStandings(season = new Date().getFullYear()) {
  let records = await fetchSeason(season);
  // before opening day the new season has no records yet: show last year's
  if (!records.some((r) => r.teamRecords?.length)) {
    season -= 1;
    records = await fetchSeason(season);
  }

  const byDivision = new Map(records.map((r) => [r.division.id, r.teamRecords.map(toTeam)]));
  const out = { season, AL: { divisions: [], wildCard: [] }, NL: { divisions: [], wildCard: [] } };
  let updated = 0;
  let final = true;

  for (const id of DIVISION_ORDER) {
    const [league, name] = DIVISIONS[id];
    const teams = (byDivision.get(id) || []).sort((a, b) => a.divRank - b.divRank);
    out[league].divisions.push({ name, teams });
    for (const t of teams) {
      updated = Math.max(updated, Date.parse(t.updated) || 0);
      // some teams finish at 161 games (unplayed rainouts), so call it final once every race is decided
      if (!t.status) final = false;
      if (t.divRank !== 1 && t.wcRank) out[league].wildCard.push(t);
    }
  }
  for (const league of Object.keys(LEAGUES)) out[league].wildCard.sort((a, b) => a.wcRank - b.wcRank);

  out.updated = updated ? new Date(updated) : null;
  out.final = final;
  return out;
}

/* ------------------------------------------------------------------ *
 *  Postseason
 * ------------------------------------------------------------------ */

// Six teams per league: division winners are seeds 1–3 (by record), wild cards 4–6.
// Returns Map(teamId -> { seed, league, team })
function seedsFrom(standings) {
  const seeds = new Map();
  for (const league of Object.keys(LEAGUES)) {
    const { divisions, wildCard } = standings[league];
    divisions
      .map((d) => d.teams[0])
      .filter(Boolean)
      .sort((a, b) => a.leagueRank - b.leagueRank)
      .forEach((team, i) => seeds.set(team.id, { seed: i + 1, league, team }));
    wildCard.slice(0, 3).forEach((team, i) => seeds.set(team.id, { seed: i + 4, league, team }));
  }
  return seeds;
}

export const ROUNDS = {
  F: 'Wild Card',
  D: 'Division Series',
  L: 'Championship Series',
  W: 'World Series',
};

function toSeries(entry, seeds) {
  const games = entry.games || [];
  const first = games[0];
  if (!first) return null;
  const bestOf = first.gamesInSeries;
  const round = first.gameType;

  const side = (g, which) => {
    const t = g.teams[which];
    return { id: t.team.id, abbr: t.team.abbreviation, nick: t.team.clubName || t.team.teamName || t.team.name, score: t.score, win: !!t.isWinner };
  };
  // team order: higher seed first
  const ids = [first.teams.home.team.id, first.teams.away.team.id];
  const played = games
    .filter((g) => g.status.abstractGameState === 'Final' && !/cancel|postpon/i.test(g.status.detailedState))
    .map((g) => ({
      n: g.seriesGameNumber,
      date: g.officialDate,
      away: side(g, 'away'),
      home: side(g, 'home'),
    }));
  const teams = ids
    .map((id) => {
      const g = first.teams.home.team.id === id ? first.teams.home : first.teams.away;
      const info = seeds.get(id);
      return {
        id,
        nick: g.team.clubName || g.team.teamName || g.team.name,
        abbr: g.team.abbreviation,
        seed: info?.seed ?? null,
        league: info?.league ?? null,
        wins: played.filter((p) => (p.home.id === id && p.home.win) || (p.away.id === id && p.away.win)).length,
      };
    })
    .sort((a, b) => (a.seed ?? 9) - (b.seed ?? 9));

  const need = Math.ceil(bestOf / 2);
  const winner = teams.find((t) => t.wins >= need) || null;
  const league = round === 'W' ? null : teams[0].league || (first.seriesDescription || '').slice(0, 2);
  return { round, league, bestOf, name: first.seriesDescription, teams, games: played, winner, done: !!winner };
}

// Returns null when the postseason hasn't started (no series scheduled yet).
// Otherwise { season, series: [...], champion, done }
export async function loadPostseason(standings) {
  const url = `https://statsapi.mlb.com/api/v1/schedule/postseason/series?season=${standings.season}&sportId=1&hydrate=team`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MLB API responded ${res.status}`);
  const json = await res.json();
  const seeds = seedsFrom(standings);
  const series = (json.series || []).map((s) => toSeries(s, seeds)).filter(Boolean);
  if (!series.length) return null;
  const ws = series.find((s) => s.round === 'W');
  return { season: standings.season, series, champion: ws?.winner || null, done: !!ws?.done };
}
