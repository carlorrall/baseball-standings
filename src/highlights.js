// Game recaps and video highlights from the MLB Stats API.
// Headlines, summaries and thumbnails are shown here; the videos and full stories open on MLB.com.

import { logoUrl } from './data.js';

const API = 'https://statsapi.mlb.com/api/v1/schedule';
const GAME_TYPES = 'R,F,D,L,W'; // regular season + every postseason round
const CLIPS_PER_GAME = 4;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const iso = (d) => d.toISOString().slice(0, 10);

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MLB API responded ${res.status}`);
  return res.json();
}

// Every date this season with at least one finished game (a tiny request, used for prev/next).
async function loadGameDays(season) {
  const end = new Date(Math.min(Date.now(), Date.UTC(season, 11, 31)));
  const url =
    `${API}?sportId=1&gameType=${GAME_TYPES}&startDate=${season}-02-01&endDate=${iso(end)}` +
    '&fields=dates,date,games,status,abstractGameState';
  const json = await getJSON(url);
  return (json.dates || [])
    .filter((d) => d.games.some((g) => g.status.abstractGameState === 'Final'))
    .map((d) => d.date);
}

const thumb = (item, width = 640) => {
  const cuts = item?.image?.cuts || [];
  const cut = cuts.find((c) => c.aspectRatio === '16:9' && c.width === width) || cuts.find((c) => c.aspectRatio === '16:9') || cuts[0];
  return cut?.src || null;
};

// "00:02:54" -> "2:54"
const duration = (d) => (d ? d.replace(/^00:/, '').replace(/^0(\d:)/, '$1') : '');

function toGame(g) {
  const side = (t) => ({ id: t.team.id, abbr: t.team.abbreviation, nick: t.team.clubName, score: t.score, win: !!t.isWinner });
  const items = (g.content?.highlights?.highlights?.items || []).filter((i) => i.type === 'video' && i.slug);
  const recap = g.content?.editorial?.recap?.mlb;
  return {
    pk: g.gamePk,
    label: g.seriesDescription && g.seriesDescription !== 'Regular Season' ? g.description || g.seriesDescription : '',
    status: g.status.detailedState,
    final: g.status.abstractGameState === 'Final',
    away: side(g.teams.away),
    home: side(g.teams.home),
    recap: recap?.headline ? { headline: recap.headline.trim(), blurb: recap.blurb || '', slug: recap.slug } : null,
    feature: items[0] ? { headline: items[0].headline, slug: items[0].slug, time: duration(items[0].duration), img: thumb(items[0]) } : null,
    clips: items.slice(1, 1 + CLIPS_PER_GAME).map((i) => ({ headline: i.headline.trim(), slug: i.slug, time: duration(i.duration) })),
  };
}

async function loadDay(date) {
  const url = `${API}?sportId=1&gameType=${GAME_TYPES}&date=${date}&hydrate=team,game(content(highlights(highlights),editorial(recap)))`;
  const json = await getJSON(url);
  const games = (json.dates?.[0]?.games || []).map(toGame).filter((g) => g.final);
  // games with video first, so the page doesn't open on empty cards
  return games.sort((a, b) => !!b.feature - !!a.feature);
}

/* ---------- rendering ---------- */

const video = (slug) => `https://www.mlb.com/video/${encodeURIComponent(slug)}`;
const story = (slug) => `https://www.mlb.com/news/${encodeURIComponent(slug)}`;
const ext = 'target="_blank" rel="noopener noreferrer"';

const fmtLong = (date) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const fmtShort = (date) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function scoreLine(g) {
  const side = (t) =>
    `<span class="hl-team ${t.win ? 'is-win' : ''}"><img class="logo" src="${logoUrl(t.id)}" alt="" width="22" height="22" loading="lazy">` +
    `<span>${esc(t.abbr)}</span><b>${esc(t.score)}</b></span>`;
  return `<div class="hl-score">${side(g.away)}<span class="at">@</span>${side(g.home)}</div>`;
}

function gameCard(g, i, all) {
  const f = g.feature;
  const media = f
    ? `<a class="hl-media" href="${video(f.slug)}" ${ext}>` +
      (f.img ? `<img src="${esc(f.img)}" alt="" loading="lazy">` : '') +
      `<span class="hl-play">▶ ${esc(f.time)}</span></a>`
    : '';
  const recap = g.recap
    ? `<h3 class="hl-head"><a href="${story(g.recap.slug)}" ${ext}>${esc(g.recap.headline)}</a></h3>` +
      `<p class="hl-blurb">${esc(g.recap.blurb)}</p>`
    : f ? `<h3 class="hl-head"><a href="${video(f.slug)}" ${ext}>${esc(f.headline)}</a></h3>` : '';
  const clips = g.clips.length
    ? '<ul class="hl-clips">' +
      g.clips.map((c) => `<li><a href="${video(c.slug)}" ${ext}><span>${esc(c.headline)}</span><time>${esc(c.time)}</time></a></li>`).join('') +
      '</ul>'
    : '';
  return (
    `<article class="hl-card${all.length === 1 ? ' is-feature' : ''}" style="--i:${Math.min(i, 8)}">${media}` +
    `<div class="hl-body">${g.label ? `<p class="hl-label">${esc(g.label)}</p>` : ''}${scoreLine(g)}${recap}${clips}</div></article>`
  );
}

export function createHighlights(grid) {
  let days = null;
  let index = -1;
  const cache = new Map();
  let token = 0;

  function nav() {
    const prev = days[index - 1];
    const next = days[index + 1];
    return (
      '<nav class="hl-nav" aria-label="Game day">' +
      `<button type="button" class="btn" data-day="-1" ${prev ? '' : 'disabled'}>← ${prev ? fmtShort(prev) : ''}</button>` +
      `<p class="hl-date">${fmtLong(days[index])}</p>` +
      `<button type="button" class="btn" data-day="1" ${next ? '' : 'disabled'}>${next ? fmtShort(next) : ''} →</button>` +
      '</nav>'
    );
  }

  async function showDay(i) {
    index = i;
    const date = days[index];
    const mine = ++token; // ignore slow responses after the user has moved on
    grid.innerHTML = nav() + '<p class="state">Loading highlights…</p>';
    try {
      if (!cache.has(date)) cache.set(date, await loadDay(date));
      if (mine !== token || grid.dataset.view !== 'HL') return;
      const games = cache.get(date);
      grid.innerHTML = nav() + (games.length ? games.map(gameCard).join('') : '<p class="state">No highlights for this day.</p>');
    } catch (err) {
      console.error(err);
      cache.delete(date);
      if (mine !== token || grid.dataset.view !== 'HL') return;
      grid.innerHTML = nav() + '<div class="state"><p>Couldn’t load highlights.</p><button type="button" class="btn" data-retry>Try again</button></div>';
    }
  }

  grid.addEventListener('click', (e) => {
    if (grid.dataset.view !== 'HL') return;
    const step = e.target.closest('[data-day]');
    if (step && !step.disabled) showDay(index + Number(step.dataset.day));
    if (e.target.closest('[data-retry]')) (days ? showDay(index) : show(lastSeason));
  });

  let lastSeason = null;
  async function show(season) {
    lastSeason = season;
    if (days) return showDay(index);
    grid.innerHTML = '<p class="state">Loading highlights…</p>';
    try {
      days = await loadGameDays(season);
      if (grid.dataset.view !== 'HL') return;
      if (!days.length) {
        days = null;
        grid.innerHTML = '<p class="state">No games played yet this season.</p>';
        return;
      }
      showDay(days.length - 1); // open on the most recent game day
    } catch (err) {
      console.error(err);
      days = null;
      grid.innerHTML = '<div class="state"><p>Couldn’t load highlights.</p><button type="button" class="btn" data-retry>Try again</button></div>';
    }
  }

  return { show };
}
