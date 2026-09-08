/* Game Review page.
 *
 * Quarto has no native component for a stateful chess board, a Web Worker
 * engine, file drops, or graded play, which is the capability gap that
 * justifies this custom page (see .kiro/steering/quarto-native.md).
 *
 * This file draws the page and drives the engine. Every decision about a
 * move, a weakness, or a drill is made by chess-review-core.js, which has no
 * DOM and is tested on its own. The board is chess-review-board.js and the
 * engine wrapper chess-review-engine.js. All three are loaded by their own
 * versioned script tags and read from window here, so a fix to one of them
 * is never served stale by the asset cache.
 *
 * The games, the engine records, the report, and the practice record live
 * in this browser (localStorage), each under a byte cap. Every string that
 * came from a file, a paste, or another site is written with textContent
 * or into an input's value.
 */
import { loadOpenings, openingOfLine } from './chess-assets/openings.js';
import { fetchJson } from './chess-assets/json-fetch.js';

const Core = window.GameReviewCore;
const EngineMod = window.GameReviewEngine;
const BoardMod = window.GameReviewBoard;
const root = document.getElementById('game-review');
if (root && Core && EngineMod && BoardMod) main();

function main() {
  'use strict';
  const { Chess, MATE, LIMITS, QUALITY, FLAG_LOSS } = Core;
  const { Engine } = EngineMod;

  const KEYS = {
    games: 'chess-review:games', identity: 'chess-review:identity', records: 'chess-review:records',
    snapshots: 'chess-review:snapshots', drills: 'chess-review:drills', options: 'chess-review:options',
  };
  const CAPS = { games: 1500 * 1024, records: 1500 * 1024, drills: 2000 };
  /* a stored value larger than this is dropped unread; localStorage counts
     UTF-16 code units, which is what String.length measures */
  const STORAGE_PARSE_CAP = 3 * 1024 * 1024;
  const ENGINE_URL = 'chess-assets/stockfish-18-lite-single.js';
  const POOL_URL = 'chess-assets/drill-pool/';
  const POOL_MAX_BYTES = 2 * 1024 * 1024;
  const DOWNLOAD_URL_LIFETIME_MS = 30000;   // project default before a download URL is revoked
  const FETCH_TIMEOUT_MS = 30000;
  const IMPORT_MAX_BYTES = 6 * 1024 * 1024;
  const IMPORT_ORIGINS = { 'chess.com': 'https://api.chess.com', lichess: 'https://lichess.org' };
  const USERNAME = /^[A-Za-z0-9_-]{2,30}$/;
  const DRILL_MOVES = 5;
  const DRILL_MS = 400;
  /* Replay opponents, strongest first, with the Chess Coach page's own
     settings. Maia 1900 reproduces human play at that rating from a 2.4 MB
     network; 2000 and up are the Lc0 T70 network with policy sharpening and,
     from 2300, a one-ply value-head lookahead. The user asked for a strong
     sparring partner (2026-09-08), so the default is the top of the range. */
  const OPPONENTS = [
    { elo: 2500, net: 't70-703810', temp: 0.05, topP: 0.5, value: { topK: 8, lambda: 0.35, tau: 0.025 }, note: 'grandmaster' },
    { elo: 2400, net: 't70-703810', temp: 0.12, topP: 0.6, value: { topK: 8, lambda: 0.45, tau: 0.04 }, note: 'international master' },
    { elo: 2300, net: 't70-703810', temp: 0.25, topP: 0.7, value: { topK: 5, lambda: 0.6, tau: 0.06 }, note: 'FIDE master' },
    { elo: 2200, net: 't70-703810', temp: 0.35, topP: 0.75, note: 'candidate master' },
    { elo: 2100, net: 't70-703810', temp: 0.55, topP: 0.8, note: 'strong club player' },
    { elo: 2000, net: 't70-703810', temp: 0.8, topP: 0.85, note: 'club expert' },
    { elo: 1900, net: 'maia-1900', temp: 1, topP: 0.95, note: 'human-like' },
  ];
  const DEFAULT_OPPONENT = 2500;
  const NET_SIZE = { 't70-703810': '13 MB', 'maia-1900': '2.4 MB' };
  /* Sharing. A pack is written once under a random 22-character id, read by
     any signed-in reader until it expires, and listed in ten slots of the
     coach's own account, which is what caps how many can be live. */
  const SHARE = { slots: 10, idLength: 22, lifetimeMs: 90 * 24 * 60 * 60 * 1000, timeoutMs: 15000, slotGapMs: 30000, syncDelayMs: 4000 };
  const MAIA_LOAD_MS = 180000;
  const MAIA_THINK_MS = 30000;
  const withDeadline = (promise, ms) => Promise.race([promise, new Promise((resolve, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

  const $ = id => document.getElementById(id);
  const ui = {
    message: $('gr-message'), drop: $('gr-drop'), files: $('gr-files'), paste: $('gr-paste'), pasteAdd: $('gr-paste-add'),
    importSite: $('gr-import-site'), importUser: $('gr-import-user'), importCount: $('gr-import-count'), importBtn: $('gr-import'), importStatus: $('gr-import-status'),
    gamesPanel: $('gr-games-panel'), gamesStatus: $('gr-games-status'), gamesList: $('gr-games-list'), clear: $('gr-clear'), forget: $('gr-forget'),
    playerPanel: $('gr-player-panel'), names: $('gr-names'), display: $('gr-display'), rating: $('gr-rating'),
    incLoss: $('gr-inc-loss'), incDraw: $('gr-inc-draw'), incWin: $('gr-inc-win'), playerStatus: $('gr-player-status'),
    reviewPanel: $('gr-review-panel'), quality: $('gr-quality'), estimate: $('gr-estimate'), run: $('gr-run'), stop: $('gr-stop'),
    progress: $('gr-progress'), progressBar: $('gr-progress-bar'), progressText: $('gr-progress-text'),
    profilePanel: $('gr-profile-panel'), saveFile: $('gr-save-file'), headline: $('gr-headline'), phases: $('gr-phases'),
    weaknesses: $('gr-weaknesses'), habits: $('gr-habits'), strengths: $('gr-strengths'), openings: $('gr-openings'),
    gamesTable: $('gr-games-table'), trend: $('gr-trend'), trendNote: $('gr-trend-note'),
    boardPanel: $('gr-board-panel'), board: $('gr-board'), flip: $('gr-flip'), prev: $('gr-prev'), next: $('gr-next'),
    boardEval: $('gr-board-eval'), boardTitle: $('gr-board-title'), boardNote: $('gr-board-note'), boardLines: $('gr-board-lines'),
    boardMoves: $('gr-board-moves'), boardActions: $('gr-board-actions'),
    objective: $('gr-board-objective'), drillStatus: $('gr-drill-status'), recap: $('gr-recap'),
    opponent: $('gr-opponent'), opponentNote: $('gr-opponent-note'),
    share: $('gr-share'), sharePanel: $('gr-share-panel'), shareStatus: $('gr-share-status'),
    shareLink: $('gr-share-link'), shareLinkRow: $('gr-share-link-row'), shareCopy: $('gr-share-copy'), shareList: $('gr-share-list'),
    sharedBanner: $('gr-shared-banner'), sharedBannerText: $('gr-shared-banner-text'),
    gamesDetail: $('gr-games-detail'), trendSection: $('gr-trend-section'),
    drillsPanel: $('gr-drills-panel'), drillsRefresh: $('gr-drills-refresh'), drillsStatus: $('gr-drills-status'),
    drillList: $('gr-drill-list'), drillSummary: $('gr-drill-summary'),
  };

  const state = {
    games: [], identity: null, names: [], records: {}, reviews: [], profile: null,
    drills: [], drillProgress: {}, snapshots: [], run: null, engine: null, engineReady: false, engineFailed: false,
    board: null, view: null, pools: {}, openingPools: {}, poolIndex: null, downloadUrl: null, downloadTimer: null, importSeq: 0,
    maia: { net: null, rating: null, mod: null }, maiaLoads: {},
    /* bumped whenever the loaded games change, so work started on an older
       set of games never lands on a newer one */
    gen: 0,
    /* set only when this page is showing someone else's shared review */
    shared: null,
    shareBusy: false, shareTimer: null,
  };

  /* ------------------------------ helpers ------------------------------ */

  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') el.textContent = v;
      else if (k === 'className') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'hidden') el.hidden = !!v;
      else if (k === 'disabled') el.disabled = !!v;
      else if (k === 'type' || k === 'title' || k === 'for' || k === 'id' || k === 'role' || k === 'colspan' || k === 'href' || k === 'rel' || k === 'target') el.setAttribute(k, v);
    }
    if (children) for (const c of [].concat(children)) if (c !== null && c !== undefined) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return el;
  }
  function message(text, kind) {
    ui.message.textContent = text || '';
    ui.message.dataset.kind = kind || '';
  }
  function setStatus(el, text) { if (el) el.textContent = text || ''; }
  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function lsSet(key, value) {
    try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); return true; }
    catch (e) { return false; }
  }
  const PARSE_CAPS = { [KEYS.games]: CAPS.games + 64 * 1024, [KEYS.records]: CAPS.records + 64 * 1024 };
  function jsonGet(key) {
    const t = lsGet(key);
    if (!t) return null;
    if (t.length > (PARSE_CAPS[key] || STORAGE_PARSE_CAP)) { lsSet(key, null); return null; }
    try { return JSON.parse(t); } catch (e) { lsSet(key, null); return null; }
  }
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
  const colorWord = c => (c === 'w' ? 'White' : 'Black');
  const evalFromWhite = (score, turn) => (turn === 'w' ? score : -score);

  /* ------------------------------ storage ------------------------------ */

  function persistGames() {
    const texts = [];
    let bytes = 0;
    for (const g of state.games) {
      const raw = g.raw || '';
      if (bytes + raw.length > CAPS.games) break;
      texts.push(raw); bytes += raw.length;
    }
    if (!texts.length) return lsSet(KEYS.games, null);
    /* the cap applies to what is written, escaping and wrapper included */
    let json = JSON.stringify({ v: 1, texts });
    while (json.length > CAPS.games && texts.length) { texts.pop(); json = JSON.stringify({ v: 1, texts }); }
    state.gamesNotKept = state.games.length - texts.length;
    return lsSet(KEYS.games, json);
  }
  function restoreGames() {
    const stored = jsonGet(KEYS.games);
    if (!stored || stored.v !== 1 || !Array.isArray(stored.texts)) { lsSet(KEYS.games, null); return; }
    const texts = [];
    let bytes = 0;
    for (const t of stored.texts) {
      if (typeof t !== 'string' || t.length > LIMITS.maxGameChars || texts.length >= LIMITS.maxGames) continue;
      if (bytes + t.length > CAPS.games) break;
      texts.push(t); bytes += t.length;
    }
    state.games = Core.parseGames(texts).games;
    if (texts.length !== stored.texts.length || state.games.length !== texts.length) persistGames();
  }
  function compactRecord(rec) {
    const evals = rec.evals.map(e => e ? [e.score, e.best || '', (e.pv || []).slice(0, LIMITS.pvPlies).join(' '), e.depth || 0] : null);
    const threats = {};
    for (const [i, t] of Object.entries(rec.threats || {})) if (t) threats[i] = [t.score, t.best || ''];
    return { q: rec.quality, at: rec.at, c: rec.color, e: evals, t: threats };
  }
  function expandRecord(c) {
    if (!c || !Array.isArray(c.e) || c.e.length < LIMITS.minPlies + 1 || c.e.length > LIMITS.maxPlies + 1) return null;
    if (c.c !== 'w' && c.c !== 'b') return null;
    if (!QUALITY[c.q] || !Number.isFinite(c.at) || c.at < 0) return null;
    const score = x => (Number.isFinite(x) && Math.abs(x) <= MATE ? Math.round(x) : null);
    const evals = c.e.map(row => {
      if (!Array.isArray(row) || score(row[0]) === null) return null;
      const best = /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(row[1] || '') ? row[1] : null;
      if (typeof row[2] !== 'string' || row[2].length > 200) return null;
      const pv = row[2].split(' ').filter(u => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(u)).slice(0, LIMITS.pvPlies);
      const depth = Number.isFinite(row[3]) && row[3] >= 0 && row[3] <= 99 ? Math.floor(row[3]) : 0;
      return { score: score(row[0]), best, pv: pv.length ? pv : (best ? [best] : []), depth };
    });
    if (evals.some(e => e === null)) return null;
    const threats = {};
    const rawThreats = c.t && typeof c.t === 'object' && !Array.isArray(c.t) ? c.t : {};
    if (Object.keys(rawThreats).length > LIMITS.maxPlies) return null;
    for (const [i, t] of Object.entries(rawThreats)) {
      if (!/^\d{1,3}$/.test(i) || +i > LIMITS.maxPlies || !Array.isArray(t) || score(t[0]) === null) continue;
      const best = /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(t[1] || '') ? t[1] : null;
      threats[i] = { score: score(t[0]), best, pv: best ? [best] : [] };
    }
    return { quality: c.q, at: Math.floor(c.at), color: c.c, evals, threats };
  }
  function persistRecords() {
    const ids = Object.keys(state.records).sort((a, b) => (state.records[b].at || 0) - (state.records[a].at || 0));
    const out = {};
    let bytes = 0;
    for (const id of ids) {
      const c = compactRecord(state.records[id]);
      const size = JSON.stringify(c).length + id.length + 4;
      if (bytes + size > CAPS.records) break;
      out[id] = c; bytes += size;
    }
    let json = JSON.stringify(out);
    while (json.length > CAPS.records && Object.keys(out).length) { delete out[Object.keys(out).pop()]; json = JSON.stringify(out); }
    lsSet(KEYS.records, json);
  }
  function restoreRecords() {
    const stored = jsonGet(KEYS.records);
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) { lsSet(KEYS.records, null); return; }
    let dropped = false;
    for (const [id, c] of Object.entries(stored)) {
      const rec = Core.ID_RE.test(id) ? expandRecord(c) : null;
      if (rec) state.records[id] = rec; else dropped = true;
    }
    if (dropped) persistRecords();     // rewrite without the values that failed validation
  }
  /* A stored record is reused only for the same game, the same color (the
     slow pass and the threat searches are color-specific), and a setting no
     stronger than the one it was made with. */
  function usableRecord(game, color, quality) {
    const rec = state.records[game.id];
    return !!rec && rec.color === color && qualityRank(rec.quality) >= qualityRank(quality) && rec.evals.length === game.plies.length + 1;
  }
  function restoreIdentity() {
    const s = jsonGet(KEYS.identity);
    if (!s || typeof s !== 'object' || !Array.isArray(s.aliases)) { if (s !== null) lsSet(KEYS.identity, null); return null; }
    const identity = Core.makeIdentity(String(s.display || ''), s.aliases.filter(a => typeof a === 'string'));
    const canonical = JSON.stringify(identity);
    if (canonical !== lsGet(KEYS.identity)) lsSet(KEYS.identity, canonical);
    return identity;
  }
  function restoreSnapshots() {
    const s = jsonGet(KEYS.snapshots);
    const list = Array.isArray(s) ? s.slice(-LIMITS.maxSnapshots) : [];
    const seen = new Set();
    state.snapshots = list.map(Core.validSnapshot).filter(Boolean).filter(snap => {
      const key = snap.player + '|' + snap.batch;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!Array.isArray(s) || state.snapshots.length !== s.length) lsSet(KEYS.snapshots, state.snapshots.length ? JSON.stringify(state.snapshots) : null);
  }
  function restoreDrillProgress() {
    const s = jsonGet(KEYS.drills);
    const out = {};
    let total = 0;
    if (s && typeof s === 'object' && !Array.isArray(s)) {
      total = Object.keys(s).length;
      const entries = Object.entries(s).filter(([id, r]) => /^(own:[0-9a-f]{16}:\d{1,3}|puzzle:[A-Za-z0-9]{5})$/.test(id) && r && typeof r === 'object')
        .sort((a, b) => (Number(b[1].at) || 0) - (Number(a[1].at) || 0)).slice(0, CAPS.drills);
      const num = x => (Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);
      for (const [id, r] of entries) {
        out[id] = { attempts: num(r.attempts), best: Math.min(100, num(r.best)), last: Math.min(100, num(r.last)), step: Math.min(Core.REVIEW_DAYS.length - 1, num(r.step)), due: num(r.due), at: num(r.at) };
      }
    }
    state.drillProgress = out;
    if (s !== null && Object.keys(out).length !== total) persistDrillProgress();   // rewrite without what failed validation
  }
  function persistDrillProgress() {
    const entries = Object.entries(state.drillProgress).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, CAPS.drills);
    return lsSet(KEYS.drills, JSON.stringify(Object.fromEntries(entries)));
  }
  function restoreOptions() {
    const o = jsonGet(KEYS.options);
    if (!o || typeof o !== 'object') return;
    if (QUALITY[o.quality]) ui.quality.value = o.quality;
    if (Core.validRating(o.rating) !== null) ui.rating.value = String(o.rating);
    if (o.include && typeof o.include === 'object') {
      if (typeof o.include.loss === 'boolean') ui.incLoss.checked = o.include.loss;
      if (typeof o.include.draw === 'boolean') ui.incDraw.checked = o.include.draw;
      if (typeof o.include.win === 'boolean') ui.incWin.checked = o.include.win;
    }
  }
  /* Remove every Game Review value from this browser. */
  function forgetAll() {
    for (const key of Object.values(KEYS)) lsSet(key, null);
    if (state.run) stopReview();
    state.gen++;
    releaseDownload();
    state.games = []; state.identity = null; state.records = {}; state.reviews = []; state.profile = null;
    state.drills = []; state.drillProgress = {}; state.snapshots = []; state.view = null;
    ui.display.value = ''; ui.rating.value = ''; ui.quality.value = 'standard'; ui.paste.value = ''; ui.importUser.value = '';
    ui.incLoss.checked = true; ui.incDraw.checked = true; ui.incWin.checked = true;
    refreshNames();
    renderGames();
    ui.profilePanel.hidden = true; ui.boardPanel.hidden = true; ui.drillsPanel.hidden = true;
    const left = Object.values(KEYS).filter(k => lsGet(k) !== null);
    message(left.length ? 'Some values could not be removed; this browser refused the change.' : 'Everything this page kept in this browser has been removed.', left.length ? 'error' : 'ok');
  }
  function persistOptions() {
    lsSet(KEYS.options, JSON.stringify({ quality: ui.quality.value, rating: Core.validRating(ui.rating.value), include: includeFlags(), opponent: parseInt(ui.opponent.value, 10) || DEFAULT_OPPONENT }));
  }
  /* Blank is fine; anything else has to be an integer from 100 to 3500. */
  function ratingInputOk() {
    return ui.rating.value.trim() === '' || Core.validRating(ui.rating.value) !== null;
  }
  const includeFlags = () => ({ loss: ui.incLoss.checked, draw: ui.incDraw.checked, win: ui.incWin.checked });

  /* ------------------------------ games ------------------------------ */

  function addGames(texts, sourceNote) {
    const { games, skipped } = Core.parseGames(texts);
    const seen = new Set(state.games.map(g => g.id));
    let added = 0;
    for (const g of games) {
      if (seen.has(g.id) || state.games.length >= LIMITS.maxGames) continue;
      seen.add(g.id); state.games.push(g); added++;
    }
    const kept = persistGames();
    refreshNames();
    renderGames();
    const parts = [`${plural(added, 'game')} added${sourceNote ? ' from ' + sourceNote : ''}`];
    if (games.length - added > 0) parts.push(`${games.length - added} already loaded`);
    if (skipped) parts.push(`${skipped} skipped as incomplete, shorter than 5 moves, or larger than 256 KB`);
    if (state.games.length >= LIMITS.maxGames) parts.push(`the limit of ${LIMITS.maxGames} games is reached`);
    const notKept = kept && state.gamesNotKept ? ` ${plural(state.gamesNotKept, 'game')} past the storage cap will not be there next time.` : '';
    message(parts.join(', ') + '.' + (kept ? notKept : ' This browser refused to keep the games for next time; the review still runs.'), !added ? 'warn' : (kept && !notKept) ? 'ok' : 'warn');
    return added;
  }

  async function readFiles(files) {
    const list = [...files].filter(f => f && f.size >= 0);
    if (!list.length) return;
    if (list.length > LIMITS.maxFiles) { message(`Choose at most ${LIMITS.maxFiles} files at a time.`, 'error'); return; }
    const total = list.reduce((s, f) => s + f.size, 0);
    if (total > LIMITS.maxTotalBytes) { message('Those files add up to more than 7 MB. Drop fewer at a time.', 'error'); return; }
    const gen = state.gen;
    const texts = [];
    for (const f of list) {
      try {
        const buf = await f.arrayBuffer();
        texts.push(new TextDecoder('utf-8').decode(new Uint8Array(buf)));
      } catch (e) { /* an unreadable file is skipped, the rest are kept */ }
    }
    if (gen !== state.gen) return;       // the games were removed while the files were being read
    addGames(texts, plural(list.length, 'file'));
  }

  function renderGames() {
    const n = state.games.length;
    ui.clear.hidden = n === 0;
    ui.playerPanel.hidden = n === 0;
    ui.reviewPanel.hidden = n === 0;
    if (!n) {
      setStatus(ui.gamesStatus, 'No games loaded yet.');
      ui.gamesList.hidden = true; ui.gamesList.replaceChildren();
      return;
    }
    const sites = {};
    for (const g of state.games) sites[g.site] = (sites[g.site] || 0) + 1;
    const withClocks = state.games.filter(g => g.clocks).length;
    setStatus(ui.gamesStatus, `${plural(n, 'game')} loaded (${Object.entries(sites).map(([s, c]) => `${c} from ${s === 'file' ? 'files without a site tag' : s}`).join(', ')}). ${withClocks} carry clock times.`);
    const rows = state.games.map((g, i) => h('li', null, [
      h('span', { className: 'gr-muted', text: String(i + 1) + '.' }),
      h('span', { text: `${g.white}${g.welo ? ' (' + g.welo + ')' : ''} vs ${g.black}${g.belo ? ' (' + g.belo + ')' : ''}` }),
      h('span', { className: 'gr-muted', text: `${g.result} · ${g.date || 'no date'} · ${Math.ceil(g.plies.length / 2)} moves` }),
    ]));
    ui.gamesList.replaceChildren(...rows);
    ui.gamesList.hidden = false;
  }

  function clearGames() {
    if (state.run) stopReview();
    state.gen++;
    releaseDownload();
    state.games = []; state.reviews = []; state.profile = null; state.drills = []; state.view = null;
    const ok = persistGames();
    refreshNames();
    renderGames();
    ui.profilePanel.hidden = true; ui.boardPanel.hidden = true; ui.drillsPanel.hidden = true;
    message(ok ? 'All games removed. The engine records stay in this browser and are reused when the same games are loaded again; Forget everything removes those too.' : 'The games are gone from the page, but this browser refused to update its storage.', ok ? 'ok' : 'error');
  }

  /* ------------------------------ the player ------------------------------ */

  function refreshNames() {
    state.names = Core.namesIn(state.games);
    const known = state.identity && state.identity.aliases.length ? state.identity : null;
    let aliases = [];
    if (known) aliases = state.names.filter(n => Core.isAlias(known, n.name)).map(n => n.name);
    /* preselect the most frequent name only when it is clearly the most
       frequent; on a tie the reader picks */
    if (!aliases.length && state.names.length && state.names[0].count > (state.names[1] ? state.names[1].count : 0)) aliases = [state.names[0].name];
    const display = known ? known.display : (aliases[0] || '');
    state.identity = Core.makeIdentity(display, known ? known.aliases.concat(aliases) : aliases);
    if (!ui.display.value && state.identity.aliases.length) ui.display.value = state.identity.display;
    renderNames();
    updatePlayer();
  }
  function renderNames() {
    ui.names.replaceChildren(...state.names.slice(0, 40).map(n => {
      const box = h('input', { type: 'checkbox' });
      box.checked = Core.isAlias(state.identity, n.name);
      box.setAttribute('value', n.name);
      box.disabled = !!state.run;
      box.addEventListener('change', updatePlayerFromForm);
      return h('label', null, [box, h('span', { text: `${n.name} (${n.count})` })]);
    }));
  }
  function updatePlayerFromForm() {
    const ticked = [...ui.names.querySelectorAll('input:checked')].map(b => b.value);
    const extra = state.identity ? state.identity.aliases.filter(a => !state.names.some(n => Core.isAlias({ aliases: [a] }, n.name))) : [];
    /* a typed name wins; otherwise the first ticked name is the display name */
    const typed = ui.display.value.trim();
    state.identity = Core.makeIdentity(typed && typed !== 'Player' ? typed : (ticked[0] || ''), ticked.concat(extra));
    if (!typed && state.identity.aliases.length) ui.display.value = state.identity.display;
    lsSet(KEYS.identity, JSON.stringify(state.identity));
    persistOptions();
    updatePlayer();
  }
  function includedGames() {
    const inc = includeFlags();
    return state.games.filter(g => {
      const c = Core.playerColor(g, state.identity);
      if (!c) return false;
      const r = Core.resultFor(g, c);
      if (r === 'win' && !inc.win) return false;
      if (r === 'draw' && !inc.draw) return false;
      if (r === 'loss' && !inc.loss) return false;
      return true;
    });
  }
  function updatePlayer() {
    if (!state.identity || !state.games.length) return;
    let w = 0, b = 0, none = 0;
    for (const g of state.games) { const c = Core.playerColor(g, state.identity); if (c === 'w') w++; else if (c === 'b') b++; else none++; }
    const included = includedGames();
    setStatus(ui.playerStatus, `${state.identity.display}: ${plural(w, 'game')} as White, ${b} as Black${none ? `, ${none} without this player on exactly one side (skipped)` : ''}. ${included.length} in the review.`);
    updateEstimate(included);
  }
  function updateEstimate(included) {
    const games = included || includedGames();
    const fresh = games.filter(g => !usableRecord(g, Core.playerColor(g, state.identity), ui.quality.value));
    const cached = games.length - fresh.length;
    const secs = Core.estimateSeconds(fresh, state.identity, ui.quality.value);
    ui.estimate.textContent = games.length
      ? `${plural(games.length, 'game')}, about ${Core.formatDuration(secs)}${cached ? ` (${cached} already reviewed in this browser)` : ''}.`
      : 'No games to review with the current choices.';
    ui.run.disabled = !state.engineReady || !games.length || !!state.run;
    if (state.engineReady && !state.run) ui.run.textContent = 'Review the games';
  }
  const qualityRank = q => ({ quick: 1, standard: 2, deep: 3 }[q] || 0);

  /* ------------------------------ import by username ------------------------------ */

  async function boundedFetch(url, { accept, expectType, maxBytes, timeoutMs = FETCH_TIMEOUT_MS, expectOrigin }) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.origin !== expectOrigin || parsed.username || parsed.password) throw new Error('unexpected destination');
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const res = await fetch(parsed.href, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', mode: 'cors', redirect: 'error', headers: { Accept: accept }, signal: abort.signal });
      if (res.status === 404) throw new Error('That username was not found.');
      if (res.status === 429) throw new Error('The site asked us to slow down. Wait a minute and try again.');
      if (!res.ok) throw new Error('The site answered with an error (' + res.status + ').');
      /* redirects are refused above, so the final URL is the requested one;
         the check stays as the guarantee the rules ask for */
      const final = new URL(res.url || parsed.href);
      if (final.protocol !== 'https:' || final.origin !== expectOrigin) throw new Error('unexpected destination');
      const mime = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!expectType.test(mime)) throw new Error('The site answered in an unexpected format.');
      const announced = Number(res.headers.get('content-length'));
      if (Number.isFinite(announced) && announced > maxBytes) throw new Error('The answer is larger than this page accepts.');
      const reader = res.body.getReader();
      const chunks = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.length;
        if (got > maxBytes) { abort.abort(); throw new Error('The answer is larger than this page accepts.'); }
        chunks.push(value);
      }
      const buf = new Uint8Array(got);
      let at = 0;
      for (const c of chunks) { buf.set(c, at); at += c.length; }
      return { text: new TextDecoder('utf-8').decode(buf) };
    } finally { clearTimeout(timer); }
  }

  async function importGames() {
    const site = ui.importSite.value === 'lichess' ? 'lichess' : 'chess.com';
    const user = ui.importUser.value.trim();
    const count = Math.min(200, Math.max(1, parseInt(ui.importCount.value, 10) || 50));
    const seq = ++state.importSeq;          // retires any request still in flight
    if (!USERNAME.test(user)) { setStatus(ui.importStatus, 'A username is 2 to 30 letters, digits, underscores, or hyphens.'); ui.importBtn.disabled = false; return; }
    const gen = state.gen;
    ui.importBtn.disabled = true;
    setStatus(ui.importStatus, `Asking ${site} for the last ${count} games of ${user}. The username and that number are all that is sent.`);
    try {
      const texts = [];
      const origin = IMPORT_ORIGINS[site];
      let shortfall = '';
      if (site === 'lichess') {
        const url = `${origin}/api/games/user/${encodeURIComponent(user)}?max=${count}&perfType=bullet,blitz,rapid,classical,correspondence&clocks=true&opening=true`;
        const { text } = await boundedFetch(url, { accept: 'application/x-chess-pgn', expectType: /^application\/x-chess-pgn$/, maxBytes: IMPORT_MAX_BYTES, expectOrigin: origin });
        if (seq !== state.importSeq || gen !== state.gen) return;
        texts.push(text);
      } else {
        const lower = user.toLowerCase();
        const { text } = await boundedFetch(`${origin}/pub/player/${encodeURIComponent(lower)}/games/archives`, { accept: 'application/json', expectType: /^application\/json$/, maxBytes: 256 * 1024, expectOrigin: origin });
        if (seq !== state.importSeq || gen !== state.gen) return;
        const archives = JSON.parse(text);
        const months = Array.isArray(archives.archives) ? archives.archives.filter(u => typeof u === 'string' && /^https:\/\/api\.chess\.com\/pub\/player\/[A-Za-z0-9_-]{2,30}\/games\/\d{4}\/\d{2}$/.test(u)).reverse() : [];
        if (!months.length) throw new Error('No games are listed for that username.');
        let have = 0;
        const MONTHS = 24;
        for (const m of months.slice(0, MONTHS)) {
          const monthUrl = `${origin}/pub/player/${encodeURIComponent(lower)}/games/${m.slice(-7)}`;   // rebuilt from the pattern, never used as given
          setStatus(ui.importStatus, `Fetching ${m.slice(-7).replace('/', '-')} from chess.com (${have} of ${count} games so far).`);
          const month = await boundedFetch(monthUrl, { accept: 'application/json', expectType: /^application\/json$/, maxBytes: IMPORT_MAX_BYTES, expectOrigin: origin });
          if (seq !== state.importSeq || gen !== state.gen) return;
          const data = JSON.parse(month.text);
          const games = Array.isArray(data.games) ? data.games : [];
          const pgns = games.filter(g => g && typeof g.pgn === 'string' && (!g.rules || g.rules === 'chess')).map(g => g.pgn).reverse();
          const take = pgns.slice(0, count - have);
          texts.push(take.join('\n\n'));
          have += take.length;
          if (have >= count) break;
        }
        if (have < count) shortfall = ` Only ${have} found in the last ${Math.min(MONTHS, months.length)} months.`;
      }
      const added = addGames(texts, `${site} (${user})`);
      if (state.identity && !Core.isAlias(state.identity, user)) {
        state.identity = Core.makeIdentity(state.identity.display, state.identity.aliases.concat([user]));
        lsSet(KEYS.identity, JSON.stringify(state.identity));
        renderNames(); updatePlayer();
      }
      setStatus(ui.importStatus, (added ? `Done. ${user} is ticked as one of your names.` : 'Nothing new came back.') + shortfall);
    } catch (e) {
      if (seq !== state.importSeq || gen !== state.gen) return;
      setStatus(ui.importStatus, e && e.name === 'AbortError' ? 'The site did not answer in time.' : (e && e.message) || 'The fetch failed.');
    } finally {
      if (seq === state.importSeq && gen === state.gen) ui.importBtn.disabled = false;
    }
  }

  /* ------------------------------ engine ------------------------------ */

  function startEngine() {
    if (state.engine || state.engineFailed) return;
    if (typeof Worker !== 'function') { engineUnavailable('This browser cannot run the engine (no Web Workers).'); return; }
    ui.run.textContent = 'Loading the engine';
    try { state.engine = new Engine(ENGINE_URL); } catch (e) { engineUnavailable('The engine could not start.'); return; }
    state.engine.ready.then(() => {
      state.engineReady = true;
      updateEstimate();
    }).catch(() => engineUnavailable('The engine did not load. Check the connection and reload the page.'));
  }
  function engineUnavailable(text) {
    state.engineFailed = true;
    state.engineReady = false;
    ui.run.disabled = true;
    ui.run.textContent = 'Engine unavailable';
    message(text, 'error');
  }

  async function evaluateAt(fen, ms, kind) {
    const c = new Chess(fen);
    if (c.isCheckmate()) return { score: -MATE, best: null, pv: [], depth: 0 };
    if (c.isGameOver()) return { score: 0, best: null, pv: [], depth: 0 };
    return state.engine.evaluate(fen, { movetime: ms, kind });
  }

  /* ------------------------------ the review run ------------------------------ */

  async function runReview() {
    if (!state.engineReady || state.run) return;
    const games = includedGames();
    if (!games.length) return;
    if (!ratingInputOk()) { message('The rating has to be a whole number from 100 to 3500, or left empty.', 'error'); return; }
    persistOptions();
    const quality = ui.quality.value;
    const q = QUALITY[quality] || QUALITY.standard;
    const run = { seq: Date.now(), stopped: false, done: 0, total: games.length, positions: 0, positionsTotal: 0, t0: Date.now() };
    state.run = run;
    ui.run.disabled = true; ui.run.textContent = 'Reviewing';
    ui.stop.hidden = false;
    ui.progress.hidden = false;
    ui.progressBar.value = 0;
    const gen = state.gen;
    /* one immutable configuration for the whole run */
    const identity = Core.makeIdentity(state.identity.display, state.identity.aliases);
    const ratingGiven = Core.validRating(ui.rating.value);
    /* a drill or replay in progress belongs to the old report */
    if (state.view) { state.view.done = true; state.view = null; }
    state.engine.stop('drill');
    const colorOf = new Map(games.map(g => [g.id, Core.playerColor(g, identity)]));
    lockControls(true);
    const fresh = games.filter(g => !usableRecord(g, colorOf.get(g.id), quality));
    run.positionsTotal = fresh.reduce((s, g) => s + g.plies.length + 1 + Math.round(0.22 * g.plies.length / 2) * 3, 0);
    const openings = await loadOpenings().catch(() => null);
    if (state.run !== run || gen !== state.gen) { state.run = null; ui.stop.hidden = true; ui.progress.hidden = true; lockControls(false); updateEstimate(); return; }
    let reviewedNow = 0, failure = null;
    try {
      for (const game of games) {
        if (run.stopped || gen !== state.gen) break;
        const color = colorOf.get(game.id);
        if (!usableRecord(game, color, quality)) {
          const rec = await reviewGame(game, color, q, run);
          if (!rec || gen !== state.gen) break;              // stopped mid-game, or the games changed
          rec.quality = quality; rec.at = Date.now(); rec.color = color;
          state.records[game.id] = rec;
          persistRecords();
        }
        run.done++;
        reviewedNow++;
        progress(run, game);
      }
    } catch (e) {
      failure = e;
    }
    const stopped = run.stopped;
    state.run = null;
    ui.stop.hidden = true;
    ui.progress.hidden = true;
    lockControls(false);
    if (gen !== state.gen) { updateEstimate(); return; }   // the games were removed during the run
    if (failure || (state.engine && state.engine.failed)) engineUnavailable('The engine stopped answering. Reload the page to start it again.');
    updateEstimate();
    const reviewed = games.filter(g => usableRecord(g, colorOf.get(g.id), 'quick'));
    if (!reviewed.length) { if (!failure) message(stopped ? 'Stopped before the first game was finished.' : 'Nothing was reviewed.', 'warn'); return; }
    buildReport(reviewed, openings, identity, ratingGiven);
    if (failure) message(`The engine stopped answering after ${plural(reviewedNow, 'game')}. The profile below covers the ${reviewed.length} games reviewed; reload the page to start the engine again.`, 'error');
    else message(stopped ? `Stopped after ${plural(reviewedNow, 'game')}. The profile covers the ${reviewed.length} games reviewed so far.` : `Review done: ${plural(reviewed.length, 'game')}.`, 'ok');
  }

  async function reviewGame(game, color, q, run) {
    const fens = [game.plies[0].before, ...game.plies.map(p => p.after)];
    const evals = [];
    for (let i = 0; i < fens.length; i++) {
      if (run.stopped) return null;
      evals[i] = await evaluateAt(fens[i], q.fast, 'review');
      if (evals[i].stopped) return null;
      run.positions++;
      if (i % 8 === 0) progress(run, game);
    }
    const threats = {};
    for (const p of game.plies) {
      if (run.stopped) return null;
      if (p.color !== color) continue;
      const before = evals[p.i].score, after = -evals[p.i + 1].score;
      if (before - after < FLAG_LOSS) continue;
      const e0 = await evaluateAt(p.before, q.slow, 'review');
      const e1 = await evaluateAt(p.after, q.slow, 'review');
      if (e0.stopped || e1.stopped) return null;
      evals[p.i] = e0; evals[p.i + 1] = e1;
      const nf = Core.nullMoveFen(p.before);
      if (nf) {
        const t = await evaluateAt(nf, q.threat, 'review');
        if (t.stopped) return null;
        threats[p.i] = t;
      }
      run.positions += 3;
      progress(run, game);
    }
    return { evals, threats };
  }

  function progress(run, game) {
    const frac = run.positionsTotal ? Math.min(1, run.positions / run.positionsTotal) : run.done / run.total;
    ui.progressBar.value = Math.round(frac * 100);
    const elapsed = (Date.now() - run.t0) / 1000;
    const eta = frac > 0.02 ? Core.formatDuration(Math.max(0, elapsed / frac - elapsed)) : 'a moment';
    ui.progressText.textContent = `Game ${Math.min(run.done + 1, run.total)} of ${run.total} (${game.white} vs ${game.black}). About ${eta} left.`;
  }

  function stopReview() {
    if (!state.run) return;
    state.run.stopped = true;
    state.engine.stop('review');
    ui.stop.disabled = true;
    setTimeout(() => { ui.stop.disabled = false; }, 500);
  }

  /* ------------------------------ the report ------------------------------ */

  /* The player and quality controls are frozen while a run reads them. */
  function lockControls(flag) {
    for (const el of [ui.display, ui.rating, ui.quality, ui.incLoss, ui.incDraw, ui.incWin, ...ui.names.querySelectorAll('input')]) el.disabled = !!flag;
  }
  function buildReport(games, openingsTable, identity, ratingGiven) {
    const rating = Number.isFinite(ratingGiven) ? ratingGiven : Core.validRating(ui.rating.value);
    state.reviews = [];
    for (const game of games) {
      const rec = state.records[game.id];
      const color = Core.playerColor(game, identity);
      if (!color || !usableRecord(game, color, 'quick')) continue;
      const opening = openingsTable ? openingOfLine([game.plies[0].before, ...game.plies.map(p => p.after)]) : null;
      const moves = Core.gradeGame(game, rec.evals, { color, threats: rec.threats, openingEnd: Math.max(16, (opening ? opening.ply : 12) + 4) });
      state.reviews.push({ game, color, moves, opening });
    }
    state.profile = Core.buildProfile(state.reviews, identity, { rating: Number.isFinite(rating) ? rating : null });
    addSnapshot(Core.snapshotOf(state.profile));
    renderProfile();
    ui.profilePanel.hidden = false;
    ui.boardPanel.hidden = false;
    ui.drillsPanel.hidden = false;
    state.view = null;
    showGameMoment(state.profile.perGame[0] ? state.profile.perGame[0].index : 0, 0);
    buildDrills();
    if (ui.share) ui.share.hidden = false;
    loadMyShares();
  }

  function addSnapshot(snap) {
    /* the same set of games reviewed again replaces its point; a different
       set is a new point, whatever the day and the size */
    const list = state.snapshots.filter(s => !(s.player === snap.player && s.batch === snap.batch));
    list.push(snap);
    state.snapshots = list.slice(-LIMITS.maxSnapshots);
    lsSet(KEYS.snapshots, JSON.stringify(state.snapshots));
  }

  function renderProfile() {
    const P = state.profile;
    const r = P.results;
    const tiles = [
      tile(String(P.games), 'games', `${r.win}W ${r.draw}D ${r.loss}L`),
      tile(P.acpl === null ? '–' : String(P.acpl), 'centipawns lost per move', `${P.expected} is usual at ${P.rating.used}`),
      P.rating.given || P.rating.fromTags
        ? tile(String(P.rating.used), 'rating', P.rating.given ? 'as you gave it' : 'from the game files')
        : tile(P.rating.estimated ? String(P.rating.estimated) : '–', 'rough rating from the moves', 'no rating in the games; type yours above for a better fit'),
      tile(String(P.weaknesses.length), 'weaknesses found', P.weaknesses[0] ? `first: ${P.weaknesses[0].label.toLowerCase()}` : 'nothing repeats yet'),
      tile(String(P.strengths.length), 'strengths', P.strengths[0] ? P.strengths[0].label : ''),
    ];
    ui.headline.replaceChildren(...tiles);

    ui.phases.replaceChildren(
      h('thead', null, h('tr', null, [th('Phase'), th('Moves', 'num'), th('Lost per move', 'num'), th('Usual at this rating', 'num'), th('Mistakes and blunders per game', 'num')])),
      h('tbody', null, P.phases.map(p => h('tr', null, [
        td(p.id[0].toUpperCase() + p.id.slice(1)), td(String(p.n), 'num'), td(p.acpl === null ? '–' : String(p.acpl), 'num' + (p.acpl !== null && p.acpl > p.expected * 1.25 ? ' gr-bad' : p.acpl !== null && p.acpl < p.expected * 0.8 ? ' gr-good' : '')),
        td(String(p.expected), 'num'), td(p.errorsPerGame.toFixed(1), 'num'),
      ]))),
    );

    ui.weaknesses.replaceChildren(...(P.weaknesses.length ? P.weaknesses.map(weaknessCard) : [h('p', { className: 'tool-note', text: 'No error type repeats often enough to call it a weakness yet. More games make the picture sharper.' })]));
    ui.habits.replaceChildren(...P.habits.map(habitCard));
    ui.strengths.replaceChildren(...(P.strengths.length ? P.strengths.map(s => h('li', null, [h('b', { text: s.label + '. ' }), s.detail])) : [h('li', { className: 'gr-muted', text: 'Nothing stands out yet. Strengths need a few games of evidence too.' })]));

    ui.openings.replaceChildren(
      h('thead', null, h('tr', null, [th('Opening'), th('As'), th('Games', 'num'), th('Score', 'num'), th('Lost per opening move', 'num'), th('First mistakes')])),
      h('tbody', null, P.openings.slice(0, 20).map(o => h('tr', null, [
        td(o.family), td(colorWord(o.color)), td(String(o.games), 'num'), td(o.scorePct + '%', 'num' + (o.scorePct < 40 ? ' gr-bad' : o.scorePct >= 65 ? ' gr-good' : '')),
        td(o.acpl === null ? '–' : String(o.acpl), 'num'),
        td(o.firstErrors.map(f => `${f.num}. ${f.san} (${f.best} was better)`).join('; ') || '–', 'wrap'),
      ]))),
    );

    ui.gamesTable.replaceChildren(
      h('thead', null, h('tr', null, [th('#', 'num'), th('Game'), th('As'), th('Result'), th('Lost per move', 'num'), th('Errors', 'num'), th('Worst moment'), th('Opening')])),
      h('tbody', null, P.perGame.map(g => {
        const worstBtn = g.worst ? h('button', { type: 'button', className: 'tool-button', text: `${g.worst.num}${g.worst.color === 'w' ? '.' : '…'} ${g.worst.san} (${(g.worst.loss / 100).toFixed(1)})` }) : null;
        if (worstBtn) worstBtn.addEventListener('click', () => showWorst(g.index));
        const link = g.link ? h('a', { href: g.link, target: '_blank', rel: 'noopener noreferrer', text: 'open' }) : null;
        return h('tr', null, [
          td(String(g.index + 1), 'num'), td('', null, [`${g.white} vs ${g.black}`, link ? ' ' : null, link]), td(colorWord(g.color)),
          td(g.result + (g.res ? ` (${g.res})` : '')), td(g.acpl === null ? '–' : String(g.acpl), 'num'), td(String(g.errors), 'num'),
          td('', null, [worstBtn]), td(g.opening || '–', 'wrap'),
        ]);
      })),
    );
    renderTrend();
  }
  function tile(value, label, sub) {
    return h('div', { className: 'gr-tile' }, [h('div', { className: 'gr-tile-value', text: value }), h('div', { className: 'gr-tile-label', text: label }), sub ? h('div', { className: 'gr-tile-sub', text: sub }) : null]);
  }
  const th = (text, cls) => h('th', { className: cls || '', text });
  const td = (text, cls, children) => { const el = h('td', { className: cls || '' }, children || null); if (text) el.textContent = text; return el; };

  function weaknessCard(w) {
    const card = h('div', { className: 'gr-card' }, [
      h('h4', { text: w.label }),
      h('p', { className: 'gr-card-sum', text: Core.weaknessSentence(w, state.profile.games) }),
      h('p', { className: 'gr-advice' }, [h('b', { text: 'Work on: ' }), w.work]),
      h('p', { className: 'gr-advice' }, [h('b', { text: 'Avoid: ' }), w.avoid]),
    ]);
    const list = h('ul', { className: 'gr-evidence' });
    for (const e of w.evidence) {
      const b = h('button', { type: 'button', text: `Game ${e.game + 1}, ${e.num}${e.color === 'w' ? '.' : '…'} ${e.san} (${e.loss >= MATE / 2 ? 'mate' : (Math.min(e.loss, 1000) / 100).toFixed(1)})` });
      b.title = e.note;
      b.addEventListener('click', () => { showEvidence(e); markEvidence(b); });
      list.appendChild(h('li', null, b));
    }
    card.appendChild(list);
    return card;
  }
  function habitCard(hb) {
    return h('div', { className: 'gr-card habit' }, [
      h('h4', { text: hb.label }),
      h('p', { className: 'gr-card-sum', text: hb.detail }),
      h('p', { className: 'gr-advice' }, [h('b', { text: 'Work on: ' }), hb.work]),
      h('p', { className: 'gr-advice' }, [h('b', { text: 'Avoid: ' }), hb.avoid]),
    ]);
  }
  function markEvidence(btn) {
    for (const b of ui.weaknesses.querySelectorAll('.gr-evidence button.on')) b.classList.remove('on');
    btn.classList.add('on');
  }

  function renderTrend() {
    const snaps = state.snapshots.filter(s => s.player === state.profile.player.name);
    ui.trend.replaceChildren();
    if (snaps.length < 2) { ui.trendNote.textContent = 'The trend appears after a second batch of games is reviewed under the same name.'; return; }
    ui.trendNote.textContent = `${snaps.length} reviews. The line is centipawns lost per move (lower is better); the dashed line is what is usual at the rating.`;
    const NS = 'http://www.w3.org/2000/svg';
    const W = 640, H = 200, L = 40, R = 12, T = 14, B = 34;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Centipawns lost per move over the reviews');
    const vals = snaps.map(s => s.acpl === null ? 0 : s.acpl);
    const maxV = Math.max(20, ...vals, ...snaps.map(s => s.expected || 0)) * 1.15;
    const x = i => L + (snaps.length > 1 ? i / (snaps.length - 1) : 0) * (W - L - R);
    const y = v => T + (1 - v / maxV) * (H - T - B);
    const el = (name, attrs) => { const n = document.createElementNS(NS, name); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); return n; };
    const axis = el('line', { x1: L, y1: H - B, x2: W - R, y2: H - B, class: 'axis' });
    svg.appendChild(axis);
    for (const f of [0, 0.5, 1]) {
      const v = Math.round(maxV * f);
      const t = el('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end' }); t.textContent = String(v); svg.appendChild(t);
    }
    const path = el('path', { class: 'line', d: snaps.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(vals[i]).toFixed(1)}`).join(' ') });
    const exp = el('path', { class: 'line alt', d: snaps.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s.expected || 0).toFixed(1)}`).join(' ') });
    svg.append(exp, path);
    snaps.forEach((s, i) => {
      svg.appendChild(el('circle', { class: 'dot', cx: x(i).toFixed(1), cy: y(vals[i]).toFixed(1), r: 3.5 }));
      const t = el('text', { x: x(i).toFixed(1), y: H - B + 14, 'text-anchor': i === 0 ? 'start' : i === snaps.length - 1 ? 'end' : 'middle' });
      t.textContent = s.date.slice(5); svg.appendChild(t);
    });
    const table = h('table', { className: 'gr-table' }, [
      h('thead', null, h('tr', null, [th('Date'), th('Games', 'num'), th('Lost per move', 'num'), th('Rating', 'num'), th('Most frequent error')])),
      h('tbody', null, snaps.map(s => {
        const top = Object.entries(s.categories).sort((a, b) => b[1].count - a[1].count)[0];
        return h('tr', null, [td(s.date), td(String(s.games), 'num'), td(s.acpl === null ? '–' : String(s.acpl), 'num'), td(String(s.rating), 'num'), td(top ? `${Core.CATEGORIES[top[0]].label} (${top[1].count})` : '–')]);
      })),
    ]);
    ui.trend.append(svg, h('div', { className: 'gr-table-wrap' }, table));
  }

  function saveReport() {
    if (!state.profile) return;
    const name = state.profile.player.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'player';
    const text = JSON.stringify({ v: 1, kind: 'game-review', profile: state.profile, snapshots: state.snapshots }, null, 1);
    const blob = new Blob([text], { type: 'application/json' });
    releaseDownload();                   // one owned URL at a time
    let url;
    try { url = URL.createObjectURL(blob); } catch (e) { message('This browser could not prepare the download.', 'error'); return; }
    state.downloadUrl = url;
    const a = h('a', { href: url });
    a.download = `game-review-${name}-${state.profile.generated}.json`;
    a.style.display = 'none';
    try {
      document.body.appendChild(a);
      a.click();
    } catch (e) {
      releaseDownload();
      message('This browser could not start the download.', 'error');
      return;
    } finally { a.remove(); }
    state.downloadTimer = setTimeout(releaseDownload, DOWNLOAD_URL_LIFETIME_MS);
    message('The report file is downloading.', 'ok');
  }
  function releaseDownload() {
    if (state.downloadTimer) { clearTimeout(state.downloadTimer); state.downloadTimer = null; }
    if (state.downloadUrl) { try { URL.revokeObjectURL(state.downloadUrl); } catch (e) {} state.downloadUrl = null; }
  }

  /* ------------------------------ the board ------------------------------ */

  function ensureBoard() {
    if (state.board) return state.board;
    state.board = BoardMod.createBoard(ui.board, { onMove: onBoardMove });
    return state.board;
  }

  /* Show ply `ply` of a reviewed game, with the move's grade and lines. */
  function showGameMoment(gameIndex, ply, opts = {}) {
    const review = state.reviews[gameIndex];
    if (!review) return;
    const board = ensureBoard();
    const moves = review.moves;
    const i = Math.max(0, Math.min(moves.length - 1, ply));
    const m = moves[i];
    state.view = { kind: 'game', gameIndex, ply: i, after: !!opts.after };
    board.movable(null); board.lock(true);
    board.orientation(review.color);
    const fen = opts.after ? m.fenAfter : m.fenBefore;
    const arrows = [];
    if (!opts.after) {
      arrows.push({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), kind: 'played' });
      if (m.best && m.best !== m.uci && m.mine && m.cls !== 'best') arrows.push({ from: m.best.slice(0, 2), to: m.best.slice(2, 4), kind: 'best' });
    } else if (m.punish && m.error) {
      arrows.push({ from: m.punish.slice(0, 2), to: m.punish.slice(2, 4), kind: 'threat' });
    }
    board.set(fen, { lastMove: opts.after ? { from: m.uci.slice(0, 2), to: m.uci.slice(2, 4) } : (i > 0 ? { from: moves[i - 1].uci.slice(0, 2), to: moves[i - 1].uci.slice(2, 4) } : null), arrows });
    const g = review.game;
    ui.boardTitle.textContent = `Game ${gameIndex + 1}: ${g.white} vs ${g.black}, ${g.result}. Move ${m.num}${m.color === 'w' ? '.' : '…'} ${m.san}${Core.CLS_MARK[m.cls] || ''}${opts.after ? ' (after the move)' : ''}`;
    const grade = m.cls === 'forced' ? 'The only legal move.' : `${Core.CLS_LABEL[m.cls] || ''}${m.loss >= 45 ? `, ${m.loss >= MATE / 2 ? 'a mate slipped away' : (Math.min(m.loss, 1000) / 100).toFixed(1) + ' pawns lost'}` : ''}.`;
    ui.boardNote.textContent = m.error ? m.error.category && m.mine ? `${grade} ${Core.errorNote(m)}` : `${grade} ${Core.errorNote(m)}` : grade;
    const lines = [];
    const bestSan = Core.lineSan(m.fenBefore, m.pvBest).slice(0, 6).join(' ');
    if (bestSan) lines.push(line('Best line', bestSan));
    if (m.error) {
      const punishSan = Core.lineSan(m.fenAfter, m.pvPunish).slice(0, 5).join(' ');
      if (punishSan) lines.push(line('After the move', punishSan));
      if (m.error.threat && m.error.threat.best) lines.push(line('The threat before the move', Core.sanOf(Core.nullMoveFen(m.fenBefore) || m.fenBefore, m.error.threat.best)));
    }
    ui.boardLines.replaceChildren(...lines);
    hideObjective();
    ui.drillStatus.hidden = true;
    hideRecap();
    ui.boardEval.textContent = 'Eval ' + Core.formatEval(evalFromWhite(opts.after ? -m.after : m.before, opts.after ? Core.other(m.color) : m.color));
    renderMoveList(review, i);
    const actions = [];
    if (m.mine && m.before > -300 && !review.game.custom) {
      const b = h('button', { type: 'button', className: 'tool-button', text: 'Practice from here' });
      b.addEventListener('click', () => startOwnDrill({ id: 'own:' + g.id + ':' + m.i, kind: 'own', category: m.error ? m.error.category : 'positional', label: m.error ? Core.CATEGORIES[m.error.category].label : 'Your move', fen: m.fenBefore, color: m.color, line: m.pvBest.slice(0, 8), note: m.error ? Core.errorNote(m) : '', played: m.san, num: m.num, game: gameIndex }));
      actions.push(b);
      const r = h('button', { type: 'button', className: 'tool-button', text: `Play it out (${currentOpponent().elo})` });
      r.addEventListener('click', () => startReplay(m.fenBefore, m.color, `Game ${gameIndex + 1} from move ${m.num}`));
      actions.push(r);
    }
    ui.boardActions.replaceChildren(...actions);
    ui.boardPanel.hidden = false;
  }
  const line = (label, moves) => h('div', null, [h('span', { className: 'gr-line-label', text: label + ':' }), h('span', { className: 'gr-line-moves', text: moves })]);

  function renderMoveList(review, current) {
    const frag = document.createDocumentFragment();
    review.moves.forEach((m, i) => {
      if (m.color === 'w') frag.appendChild(h('span', { className: 'gr-num', text: m.num + '.' }));
      const s = h('span', { className: 'gr-mv' + (i === current ? ' cur' : '') + (m.mine && m.cls && ['inaccuracy', 'mistake', 'blunder'].includes(m.cls) ? ' ' + m.cls : ''), text: m.san + (m.mine ? (Core.CLS_MARK[m.cls] || '') : '') });
      s.addEventListener('click', () => showGameMoment(review === state.reviews[state.view && state.view.gameIndex] ? state.view.gameIndex : state.reviews.indexOf(review), i));
      frag.appendChild(s);
      frag.appendChild(document.createTextNode(' '));
    });
    ui.boardMoves.replaceChildren(frag);
    const cur = ui.boardMoves.querySelector('.cur');
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
  }
  function showEvidence(e) {
    if (state.shared) showSharedEvidence(e);
    else showGameMoment(e.game, e.ply);
    ui.boardPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function showWorst(gameIndex) {
    const review = state.reviews[gameIndex];
    if (!review) return;
    let worst = null;
    review.moves.forEach((m, i) => { if (m && m.mine && (!worst || m.loss > review.moves[worst].loss)) worst = i; });
    showGameMoment(gameIndex, worst || 0);
    ui.boardPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function stepMove(delta) {
    const v = state.view;
    if (!v || v.kind !== 'game') return;
    if (delta > 0 && !v.after) { showGameMoment(v.gameIndex, v.ply, { after: true }); return; }
    if (delta < 0 && v.after) { showGameMoment(v.gameIndex, v.ply); return; }
    const next = v.ply + delta;
    const review = state.reviews[v.gameIndex];
    if (next < 0 || next >= review.moves.length) return;
    showGameMoment(v.gameIndex, next);
  }
  function currentOpponent() {
    const elo = parseInt(ui.opponent.value, 10);
    return OPPONENTS.find(o => o.elo === elo) || OPPONENTS[0];
  }
  function renderOpponents() {
    ui.opponent.replaceChildren(...OPPONENTS.map(o => {
      const opt = h('option', { text: `${o.elo}${o.elo === DEFAULT_OPPONENT ? ' (strongest)' : ''} · ${o.note}` });
      opt.value = String(o.elo);
      return opt;
    }));
    const stored = jsonGet(KEYS.options);
    const want = stored && OPPONENTS.some(o => o.elo === stored.opponent) ? stored.opponent : DEFAULT_OPPONENT;
    ui.opponent.value = String(want);
    opponentNote();
  }
  function opponentNote() {
    const o = currentOpponent();
    ui.opponentNote.textContent = `Every opponent from 2000 up shares one ${NET_SIZE['t70-703810']} network and 1900 is a ${NET_SIZE['maia-1900']} one, downloaded once from this site when you first play it. This one plays like a ${o.note}.`;
  }

  /* ------------------------------ drills ------------------------------ */

  async function loadPools(profile) {
    if (!state.poolIndex) state.poolIndex = await fetchJson(POOL_URL + 'index.json', { maxBytes: 256 * 1024 }) || { themes: {}, openings: {} };
    const themes = new Set();
    for (const w of profile.weaknesses.slice(0, 5)) for (const t of w.themes) if (/^[A-Za-z0-9]{1,40}$/.test(t) && state.poolIndex.themes && state.poolIndex.themes[t]) themes.add(t);
    await Promise.all([...themes].filter(t => !state.pools[t]).map(async t => {
      const data = await fetchJson(POOL_URL + t + '.json', { maxBytes: POOL_MAX_BYTES });
      state.pools[t] = data && Array.isArray(data.puzzles) ? data.puzzles : [];
    }));
    const families = new Set();
    for (const o of profile.openings) if (o.games >= 2 && /^[A-Za-z0-9_\-]{1,60}$/.test(o.slug) && state.poolIndex.openings && state.poolIndex.openings[o.slug]) families.add(o.slug);
    await Promise.all([...families].filter(f => !state.openingPools[f]).map(async f => {
      const data = await fetchJson(POOL_URL + 'openings/' + f + '.json', { maxBytes: POOL_MAX_BYTES });
      state.openingPools[f] = data && Array.isArray(data.puzzles) ? data.puzzles : [];
    }));
  }

  async function buildDrills() {
    const profile = state.profile;
    if (!profile) return;
    setStatus(ui.drillsStatus, 'Choosing positions.');
    try { await loadPools(profile); } catch (e) { /* the pool is optional; own moments still work */ }
    if (state.profile !== profile) return;   // a newer report, or none, replaced this one meanwhile
    state.drills = Core.selectDrills(profile, state.pools, state.openingPools, state.drillProgress);
    renderDrills();
  }
  function renderDrills() {
    const items = state.drills.map((d, i) => {
      const prog = state.drillProgress[d.id];
      const li = h('li', { className: state.view && state.view.kind === 'drill' && state.view.drill.id === d.id ? 'cur' : '' });
      const label = h('span', { className: 'gr-drill-label', text: d.kind === 'own' ? `Your ${d.played} moment · ${d.label}` : `${d.label} · ${d.theme === 'opening' ? 'an opening position' : 'a position like yours'}` });
      const meta = h('span', { className: 'gr-drill-meta', text: `${colorWord(d.color)} to move${d.rating ? ` · puzzle rating ${d.rating}` : ''}` });
      const score = h('span', { className: 'gr-score' + (prog ? (prog.last >= 70 ? ' pass' : ' fail') : ''), text: prog ? `${prog.last}/100` : '' });
      const btn = h('button', { type: 'button', className: 'tool-button', text: prog ? 'Again' : 'Start' });
      btn.addEventListener('click', () => startDrill(d));
      li.append(label, meta, score, btn);
      return li;
    });
    ui.drillList.replaceChildren(...items);
    const done = state.drills.filter(d => state.drillProgress[d.id] && state.drillProgress[d.id].at > Date.now() - 86400000).length;
    setStatus(ui.drillsStatus, state.drills.length ? `${plural(state.drills.length, 'position')} to practice${done ? `, ${done} done today` : ''}.` : 'No positions yet. A review with at least one repeated weakness produces them.');
  }

  function startDrill(d) {
    if (state.run) { message('Wait for the review to finish before practicing.', 'warn'); return; }
    if (d.kind === 'own') { startOwnDrill(d); return; }
    const board = ensureBoard();
    const chess = new Chess(d.fen);
    const solutionMoves = Math.ceil(d.line.length / 2);
    /* the solution, then at least one move of live play against the engine */
    const free = Math.max(1, DRILL_MOVES - solutionMoves);
    state.view = { kind: 'drill', drill: d, chess, step: 0, tries: 0, solution: [], cont: [], playerMoves: 0, target: solutionMoves + free, busy: false, beforeScore: null, done: false };
    board.orientation(d.color);
    board.movable(d.color);
    board.lock(false);
    board.set(chess, { lastMove: d.setup ? { from: d.setup.slice(0, 2), to: d.setup.slice(2, 4) } : null });
    ui.boardTitle.textContent = `${d.label}: ${colorWord(d.color)} to move${d.setupSan ? `, after ${d.setupSan}` : ''}.`;
    setObjective(`${plural(solutionMoves, 'move')} with one right answer each, then ${plural(free, 'move')} of your own against the engine. The solution is worth 60 points and the free play 40, and 70 passes.`);
    ui.boardNote.textContent = '';
    ui.boardLines.replaceChildren();
    ui.boardEval.textContent = '';
    ui.boardMoves.replaceChildren();
    hideRecap();
    drillStatus(state.view);
    drillActions();
    renderDrills();
    ui.boardPanel.hidden = false;
    ui.boardPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* The goal, stated without naming the move. */
  function setObjective(text) {
    ui.objective.textContent = 'Objective. ' + text;
    ui.objective.hidden = false;
  }
  function hideObjective() { ui.objective.hidden = true; ui.objective.textContent = ''; }
  function hideRecap() { ui.recap.hidden = true; ui.recap.replaceChildren(); }

  /* Where the player is in the drill, and how it is going so far. Never says
     anything about the move that is still to be found. */
  function drillStatus(v) {
    if (!v || v.kind !== 'drill') { ui.drillStatus.hidden = true; return; }
    const d = v.drill;
    const n = Math.min(v.playerMoves + (v.done ? 0 : 1), v.target);
    const inSolution = d.kind === 'puzzle' && v.step < d.line.length;
    const bits = [`Move ${n} of ${v.target}`, inSolution ? 'one right answer' : 'your choice'];
    if (v.solution.length) bits.push(`${v.solution.filter(Boolean).length} of ${v.solution.length} right so far`);
    if (v.cont.length) {
      const avg = v.cont.reduce((a, b) => a + b, 0) / v.cont.length;
      bits.push(`${(Math.min(avg, 1000) / 100).toFixed(1)} pawns lost per move so far`);
    }
    ui.drillStatus.textContent = bits.join(' \u00b7 ');
    ui.drillStatus.hidden = false;
  }

  async function startOwnDrill(d) {
    if (state.run) { message('Wait for the review to finish before practicing.', 'warn'); return; }
    const board = ensureBoard();
    const chess = new Chess(d.fen);
    state.view = { kind: 'drill', drill: d, chess, step: 0, tries: 0, solution: [], cont: [], playerMoves: 0, target: DRILL_MOVES, busy: true, beforeScore: null, done: false };
    board.orientation(d.color);
    board.movable(d.color);
    board.lock(true);
    board.set(chess);
    ui.boardTitle.textContent = `Your ${d.played} moment: game ${d.game + 1}, move ${d.num}. ${colorWord(d.color)} to move.`;
    setObjective(`You played ${d.played} here. Find something better and hold the position for ${DRILL_MOVES} moves against the engine. Every move is graded against the engine, and 70 of 100 passes, which is an average loss under 0.6 pawns.`);
    ui.boardNote.textContent = '';
    ui.boardLines.replaceChildren();
    ui.boardMoves.replaceChildren();
    hideRecap();
    drillStatus(state.view);
    drillActions();
    renderDrills();
    ui.boardPanel.hidden = false;
    ui.boardPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const v = state.view;
    const e = await evaluateAt(d.fen, DRILL_MS, 'drill').catch(() => null);
    if (state.view !== v || v.done) return;
    if (!e) { playTrouble(v); return; }
    v.beforeScore = e.score;
    v.busy = false;
    board.lock(false);
    ui.boardEval.textContent = 'Eval ' + Core.formatEval(evalFromWhite(v.beforeScore, d.color));
  }
  /* The engine failed under a drill or a replay; nothing is scored. */
  function playTrouble(v) {
    v.done = true; v.busy = false;
    state.board.lock(true);
    ui.boardNote.textContent = 'The engine stopped answering, so this position is not scored. Reload the page to start the engine again.';
    ui.boardActions.replaceChildren();
    if (state.engine && state.engine.failed) engineUnavailable('The engine stopped answering. Reload the page to start it again.');
  }

  function drillActions() {
    const v = state.view;
    const hint = h('button', { type: 'button', className: 'tool-button', text: 'Show the move' });
    hint.addEventListener('click', drillReveal);
    const restart = h('button', { type: 'button', className: 'tool-button', text: 'Restart' });
    restart.addEventListener('click', () => startDrill(v.drill));
    const skip = h('button', { type: 'button', className: 'tool-button', text: 'Skip' });
    skip.addEventListener('click', () => finishDrill(true));
    const actions = [hint, restart, skip];
    if (v.drill.kind === 'own') {
      const r = h('button', { type: 'button', className: 'tool-button', text: `Play it out (${currentOpponent().elo})` });
      r.addEventListener('click', () => startReplay(v.drill.fen, v.drill.color, `Your game ${v.drill.game + 1} from move ${v.drill.num}`));
      actions.push(r);
    }
    ui.boardActions.replaceChildren(...actions);
  }

  function onBoardMove(from, to, promotion) {
    const v = state.view;
    if (!v || v.busy || v.done) return;
    if (v.kind === 'drill') drillMove(v, from, to, promotion);
    else if (v.kind === 'replay') replayMove(v, from, to, promotion);
  }

  async function drillMove(v, from, to, promotion) {
    const d = v.drill;
    const uci = from + to + (promotion || '');
    const inSolution = d.kind === 'puzzle' && v.step < d.line.length;
    const board = state.board;
    if (inSolution) {
      const expected = d.line[v.step];
      if (uci !== expected && !(uci + 'q' === expected)) {
        v.tries++;
        board.set(v.chess, { marks: [{ sq: to, cls: 'bad' }] });
        if (v.tries >= 2) {
          v.solution.push(false);
          v.tries = 0; v.revealed = false;
          ui.boardNote.textContent = `Not ${Core.sanOf(v.chess.fen(), uci)}. The move was ${Core.sanOf(v.chess.fen(), expected)}.`;
          await applyAndReply(v, expected, true);
        } else {
          ui.boardNote.textContent = 'Not that one. Try once more.';
        }
        return;
      }
      v.solution.push(v.tries === 0 && !v.revealed);
      v.tries = 0; v.revealed = false;
      ui.boardNote.textContent = v.step + 2 < d.line.length ? 'Right. Keep going.' : 'Right. Now keep playing against the engine.';
      await applyAndReply(v, expected, true);
      return;
    }
    await continuationMove(v, uci);
  }

  /* Play the player's solution move, then the scripted reply. */
  async function applyAndReply(v, uci, scripted) {
    const d = v.drill;
    const mv = safeMove(v.chess, uci);
    if (!mv) return;
    v.playerMoves++;
    v.step++;
    state.board.set(v.chess, { lastMove: { from: mv.from, to: mv.to }, marks: [{ sq: mv.to, cls: 'good' }] });
    addMoveText(mv);
    drillStatus(v);
    if (scripted && v.step < d.line.length) {
      const reply = d.line[v.step];
      v.busy = true;
      await pause(350);
      if (state.view !== v || v.done) return;
      const r = safeMove(v.chess, reply);
      v.step++;
      v.busy = false;
      if (r) { state.board.set(v.chess, { lastMove: { from: r.from, to: r.to } }); addMoveText(r); }
    }
    if (v.chess.isGameOver() || v.playerMoves >= v.target) { finishDrill(false); return; }
    if (v.step >= d.line.length && v.beforeScore === null) {
      /* the solution is over and the opponent is to move; the engine
         answers, and the position after its reply is the baseline for the
         learner's continuation */
      v.busy = true; state.board.lock(true);
      if (v.chess.turn() !== d.color) {
        const reply = await evaluateAt(v.chess.fen(), DRILL_MS, 'drill').catch(() => null);
        if (state.view !== v || v.done) return;
        const r = reply && reply.best ? safeMove(v.chess, reply.best) : null;
        if (!r) { playTrouble(v); return; }
        state.board.set(v.chess, { lastMove: { from: r.from, to: r.to } });
        addMoveText(r);
        if (v.chess.isGameOver()) { finishDrill(false); return; }
      }
      const e = await evaluateAt(v.chess.fen(), DRILL_MS, 'drill').catch(() => null);
      if (state.view !== v || v.done) return;
      if (!e) { playTrouble(v); return; }
      v.beforeScore = e.score;
      v.busy = false; state.board.lock(false);
      ui.boardEval.textContent = 'Eval ' + Core.formatEval(evalFromWhite(v.beforeScore, v.chess.turn()));
      ui.boardNote.textContent = 'The solution is done. Keep the position from here.';
      drillStatus(v);
    }
  }

  async function continuationMove(v, uci) {
    const mv = safeMove(v.chess, uci);
    if (!mv) return;
    v.busy = true; state.board.lock(true);
    v.playerMoves++;
    const revealed = v.revealed;
    v.revealed = false;
    state.board.set(v.chess, { lastMove: { from: mv.from, to: mv.to } });
    addMoveText(mv);
    if (v.chess.isGameOver()) {
      /* checkmate delivered is the best possible outcome; a draw from a
         winning position is graded as the loss it is */
      const after = v.chess.isCheckmate() ? MATE : 0;
      v.cont.push(Math.max(0, (v.beforeScore === null ? after : v.beforeScore) - after));
      finishDrill(false);
      return;
    }
    const reply = await evaluateAt(v.chess.fen(), DRILL_MS, 'drill').catch(() => null);
    if (state.view !== v || v.done) return;
    if (!reply) { playTrouble(v); return; }
    const after = -reply.score;
    /* a move that was shown first is scored as missed, whatever it cost */
    const loss = revealed ? 200 : Math.max(0, (v.beforeScore === null ? after : v.beforeScore) - after);
    v.cont.push(loss);
    const cls = loss < 50 ? 'good' : 'bad';
    state.board.set(v.chess, { lastMove: { from: mv.from, to: mv.to }, marks: [{ sq: mv.to, cls }] });
    ui.boardNote.textContent = loss < 50 ? `${mv.san} holds.` : `${mv.san} cost ${(Math.min(loss, 1000) / 100).toFixed(1)} pawns.`;
    drillStatus(v);
    if (reply.best) {
      await pause(300);
      if (state.view !== v || v.done) return;
      const r = safeMove(v.chess, reply.best);
      if (!r) { playTrouble(v); return; }
      state.board.set(v.chess, { lastMove: { from: r.from, to: r.to } });
      addMoveText(r);
      if (v.chess.isGameOver()) { finishDrill(false); return; }
      const next = await evaluateAt(v.chess.fen(), DRILL_MS, 'drill').catch(() => null);
      if (state.view !== v || v.done) return;
      if (!next) { playTrouble(v); return; }
      v.beforeScore = next.score;
      ui.boardEval.textContent = 'Eval ' + Core.formatEval(evalFromWhite(v.beforeScore, v.chess.turn()));
    }
    v.busy = false; state.board.lock(false);
    if (v.chess.isGameOver() || v.playerMoves >= v.target) finishDrill(false);
  }

  async function drillReveal() {
    const v = state.view;
    if (!v || v.kind !== 'drill' || v.busy || v.done) return;
    const d = v.drill;
    let uci = null;
    if (d.kind === 'puzzle' && v.step < d.line.length) uci = d.line[v.step];
    else {
      v.busy = true; state.board.lock(true);
      const e = await evaluateAt(v.chess.fen(), DRILL_MS * 2, 'drill').catch(() => null);
      if (state.view !== v || v.done) return;
      if (!e) { playTrouble(v); return; }
      v.busy = false; state.board.lock(false);
      uci = e.best;
    }
    if (!uci) return;
    state.board.arrows([{ from: uci.slice(0, 2), to: uci.slice(2, 4), kind: 'best' }]);
    ui.boardNote.textContent = `The move is ${Core.sanOf(v.chess.fen(), uci)}. Play it to continue; this move counts as missed.`;
    v.revealed = true;                 // scored once, when the move is played
  }

  function finishDrill(skipped) {
    const v = state.view;
    if (!v || v.kind !== 'drill' || v.done) return;
    v.done = true;
    state.board.lock(true);
    const d = v.drill;
    if (skipped) { ui.boardNote.textContent = 'Skipped.'; hideObjective(); ui.drillStatus.hidden = true; drillActions(); renderDrills(); return; }
    const terminal = d.kind === 'puzzle' && v.step >= d.line.length && v.chess.isGameOver() && !v.cont.length;
    const score = Core.scoreDrill(d.kind === 'puzzle' ? v.solution : [], v.cont, { terminal });
    state.drillProgress[d.id] = Core.scheduleDrill(state.drillProgress[d.id], score);
    const kept = persistDrillProgress();
    queueSharedProgress();
    const sol = d.kind === 'puzzle' ? `${v.solution.filter(Boolean).length} of ${v.solution.length} solution moves. ` : '';
    const avg = v.cont.length ? Math.round(v.cont.reduce((a, b) => a + b, 0) / v.cont.length) : null;
    const later = !kept ? 'This browser refused to keep the result, so it will not be scheduled.' : score >= 70 ? `This one comes back in ${Core.REVIEW_DAYS[state.drillProgress[d.id].step]} days.` : 'It comes back tomorrow.';
    ui.boardNote.textContent = `${score >= 70 ? 'Passed' : 'Not yet'}, ${score} of 100. ${sol}${avg !== null ? `Against the engine you lost ${avg} centipawns per move over ${plural(v.cont.length, 'move')}.` : ''} ${later}`;
    hideObjective();
    drillStatus(v);
    drillRecap(v);
    const next = state.drills[(state.drills.findIndex(x => x.id === d.id) + 1) % Math.max(1, state.drills.length)];
    const actions = [];
    if (next && next.id !== d.id) { const b = h('button', { type: 'button', className: 'tool-button tool-button-primary', text: 'Next position' }); b.addEventListener('click', () => startDrill(next)); actions.push(b); }
    const again = h('button', { type: 'button', className: 'tool-button', text: 'Same position again' });
    again.addEventListener('click', () => startDrill(d));
    actions.push(again);
    ui.boardActions.replaceChildren(...actions);
    renderDrills();
    renderDrillSummary();
  }
  /* The point of the drill, written so it can be recognized over the board:
     the pattern, the thing to notice, the habit that answers it, and where
     this particular position came from. Shown only once the drill is over. */
  function drillRecap(v) {
    const d = v.drill;
    const cat = Core.CATEGORIES[d.category];
    ui.recap.replaceChildren();
    if (!cat) { ui.recap.hidden = true; return; }
    /* Ask before telling. Choosing the signal from three is retrieval, which
       is what makes the pattern come back over the board; reading it is not. */
    const question = Core.cueQuestion(d.category, d.id);
    if (!question.length) { revealRecap(v, null); return; }
    ui.recap.append(h('h4', { text: 'Before the answer: what was the signal in this position?' }));
    const list = h('div', { className: 'gr-quiz' });
    const buttons = question.map(opt => {
      const b = h('button', { type: 'button', className: 'tool-button', text: opt.text });
      b.addEventListener('click', () => {
        buttons.forEach((other, i) => {
          other.disabled = true;
          if (question[i].correct) other.classList.add('right');
        });
        if (!opt.correct) b.classList.add('wrong');
        revealRecap(v, opt.correct);
      });
      list.appendChild(b);
      return b;
    });
    ui.recap.appendChild(list);
    ui.recap.hidden = false;
  }

  /* The card itself, once the question has been answered. */
  async function revealRecap(v, gotIt) {
    const d = v.drill;
    const cat = Core.CATEGORIES[d.category];
    if (!cat) return;
    const motif = d.motif && Core.MOTIFS[d.motif] ? Core.MOTIFS[d.motif].label : '';
    const line = (head, body) => h('p', null, [h('b', { text: head + ' ' }), body]);
    if (gotIt !== null) ui.recap.appendChild(h('p', { className: gotIt ? 'gr-quiz-verdict right' : 'gr-quiz-verdict wrong', text: gotIt ? 'That is the one.' : 'Not that one. The signal is marked above.' }));
    const head = h('h4', { text: `Remember this one${motif ? ': ' + motif : ''}` });
    ui.recap.append(head, line('What to notice.', cat.cue), line('The habit.', firstSentence(cat.work)));
    if (d.kind === 'own') ui.recap.appendChild(line(`Your game ${d.game + 1}, move ${d.num}.`, d.note || ''));
    else ui.recap.appendChild(line('Where this came from.', `A Lichess puzzle rated ${d.rating} on the same theme as your own mistakes.`));
    const rec = state.drillProgress[d.id];
    if (rec && rec.due) {
      let when = '';
      try { when = new Date(rec.due).toLocaleDateString(undefined, { day: 'numeric', month: 'long' }); } catch (e) {}
      if (when) ui.recap.appendChild(h('p', { className: 'gr-recap-next', text: `You will see this position again on ${when}.` }));
    }
    ui.recap.hidden = false;
    /* A named pattern is worth more than a category, so the heading takes the
       real name when the coach page's catalog recognizes one. */
    const named = await patternName(d);
    if (named && state.view === v) head.textContent = `Remember this one: ${named}`;
  }

  /* The name the chess world uses for what happens in this line, from the
     Chess Coach page's catalog of 88 patterns. Loaded on demand. */
  async function patternName(d) {
    if (!d.line || !d.line.length) return '';
    try {
      const mod = await import('./chess-assets/patterns.js');
      const board = new Chess(d.fen);
      for (const uci of d.line) {
        const mv = safeMove(board, uci);
        if (!mv) break;
        if (board.isCheckmate()) {
          const id = mod.classifyMate(board, d.color);
          return id ? (mod.mateName(id) || '') : '';
        }
      }
      const found = mod.patternsAlongLine(d.fen, d.line, d.color);
      return found.length && found[0].achieved ? found[0].name : '';
    } catch (e) { return ''; }
  }
  const firstSentence = t => { const i = String(t).indexOf('. '); return i > 0 ? String(t).slice(0, i + 1) : String(t); };

  function renderDrillSummary() {
    const byCat = {};
    for (const d of state.drills) {
      const p = state.drillProgress[d.id];
      if (!p) continue;
      const c = byCat[d.label] || (byCat[d.label] = { n: 0, sum: 0 });
      c.n++; c.sum += p.last;
    }
    const rows = Object.entries(byCat).map(([label, c]) => `${label}: ${Math.round(c.sum / c.n)} average over ${plural(c.n, 'position')}`);
    ui.drillSummary.textContent = rows.length ? 'So far. ' + rows.join('; ') + '.' : '';
  }

  function addMoveText(mv) {
    /* the move number comes from the position, since a drill starts mid-game */
    const moveNo = +(String(mv.before || '').split(' ')[5] || 1);
    const num = mv.color === 'w' ? `${moveNo}. ` : (ui.boardMoves.childNodes.length ? '' : `${moveNo}… `);
    ui.boardMoves.appendChild(h('span', { className: 'gr-mv', text: num + mv.san + ' ' }));
  }
  function safeMove(chess, uci) {
    try { return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined }); } catch (e) { return null; }
  }
  const pause = ms => new Promise(r => setTimeout(r, ms));

  /* ------------------------------ replay against Maia ------------------------------ */

  /* One network per file, loaded once; the replay keeps the one it asked for. */
  async function loadNet(stem) {
    if (!state.maiaLoads[stem]) {
      state.maiaLoads[stem] = import('./chess-assets/leela/leela.js').then(mod => new mod.LeelaNet().load(`${stem}.onnx.gz`).then(net => {
        state.maia.mod = mod;
        return net;
      })).catch(e => { delete state.maiaLoads[stem]; throw e; });
    }
    return state.maiaLoads[stem];
  }

  /* The opponent's move: the network's policy, sharpened to the strength, with
     a value-head look at the top candidates for the strongest settings. Same
     machinery as the Chess Coach page's characters. */
  async function opponentMove(v) {
    const cfg = v.opponent, mod = state.maia.mod;
    const legal = v.chess.moves({ verbose: true });
    if (!legal.length || !mod) return null;
    /* nobody at this strength misses mate in one */
    for (const m of legal) {
      v.chess.move(m);
      const mate = v.chess.isCheckmate();
      v.chess.undo();
      if (mate) return m.from + m.to + (m.promotion || '');
    }
    const fens = v.fens.slice(-8);
    const { policy } = await withDeadline(v.net.evaluate(fens), MAIA_THINK_MS);
    const ucis = legal.map(m => m.from + m.to + (m.promotion || ''));
    const res = mod.chooseMove(policy, ucis, v.chess.turn() === 'b', { temperature: cfg.temp, topP: cfg.topP });
    if (!res) return null;
    if (!cfg.value || !res.candidates) return res.uci;
    const byUci = new Map(legal.map(m => [m.from + m.to + (m.promotion || ''), m]));
    const top = res.candidates.slice(0, cfg.value.topK).map(c => {
      v.chess.move(byUci.get(c.uci));
      const afterFen = v.chess.fen();
      v.chess.undo();
      return { uci: c.uci, prob: c.p, afterFen };
    });
    const ranked = await withDeadline(mod.valueRerank(v.net, fens, top, cfg.value.lambda), MAIA_THINK_MS);
    if (!ranked || !ranked.length) return res.uci;
    const tau = cfg.value.tau || 0.03;
    let sum = 0;
    for (const c of ranked) { c.w = Math.exp((c.score - ranked[0].score) / tau); sum += c.w; }
    let roll = Math.random() * sum;
    for (const c of ranked) { roll -= c.w; if (roll <= 0) return c.uci; }
    return ranked[0].uci;
  }

  async function startReplay(fen, color, title) {
    if (state.run) { message('Wait for the review to finish before a replay.', 'warn'); return; }
    const opponent = currentOpponent();
    const board = ensureBoard();
    const chess = new Chess(fen);
    const v = { kind: 'replay', chess, color, opponent, busy: true, done: false, losses: [], fens: [fen], beforeScore: null, title };
    state.view = v;
    board.orientation(color); board.movable(color); board.lock(true);
    board.set(chess);
    ui.boardTitle.textContent = `${title}, against ${opponent.elo}.`;
    setObjective(`Play the position out against a ${opponent.note} and see whether you can hold it. Every move of yours is graded as you go; nothing here is scored or scheduled.`);
    ui.drillStatus.hidden = true;
    hideRecap();
    ui.boardNote.textContent = `Loading the ${opponent.elo} network (${NET_SIZE[opponent.net]}, once).`;
    ui.boardLines.replaceChildren(); ui.boardMoves.replaceChildren(); ui.boardEval.textContent = '';
    const stop = h('button', { type: 'button', className: 'tool-button', text: 'Stop the replay' });
    stop.addEventListener('click', () => endReplay(v, 'stopped'));
    const again = h('button', { type: 'button', className: 'tool-button', text: 'Restart' });
    again.addEventListener('click', () => startReplay(fen, color, title));
    ui.boardActions.replaceChildren(stop, again);
    try { v.net = await withDeadline(loadNet(opponent.net), MAIA_LOAD_MS); }
    catch (e) { if (state.view === v && !v.done) { ui.boardNote.textContent = 'That network did not load. Check the connection and try again.'; v.done = true; } return; }
    if (state.view !== v || v.done) return;
    const e = await evaluateAt(fen, DRILL_MS, 'drill').catch(() => null);
    if (state.view !== v || v.done) return;
    if (!e) { playTrouble(v); return; }
    v.beforeScore = e.score;
    ui.boardNote.textContent = 'Your move.';
    v.busy = false; board.lock(false);
    if (chess.turn() !== color) await maiaReply(v);
  }
  async function replayMove(v, from, to, promotion) {
    const mv = safeMove(v.chess, from + to + (promotion || ''));
    if (!mv) return;
    v.busy = true; state.board.lock(true);
    v.fens.push(v.chess.fen());
    state.board.set(v.chess, { lastMove: { from: mv.from, to: mv.to } });
    addMoveText(mv);
    if (v.chess.isGameOver()) {
      const terminal = v.chess.isCheckmate() ? MATE : 0;
      v.losses.push(Math.max(0, (v.beforeScore === null ? terminal : v.beforeScore) - terminal));
      endReplay(v, 'over');
      return;
    }
    const after = await evaluateAt(v.chess.fen(), 250, 'drill').catch(() => null);
    if (state.view !== v || v.done) return;
    if (!after) { playTrouble(v); return; }
    const loss = Math.max(0, (v.beforeScore === null ? 0 : v.beforeScore) + after.score);
    v.losses.push(loss);
    ui.boardEval.textContent = 'Eval ' + Core.formatEval(evalFromWhite(after.score, v.chess.turn())) + (loss >= 100 ? ` (that cost ${(Math.min(loss, 1000) / 100).toFixed(1)})` : '');
    await maiaReply(v);
  }
  async function maiaReply(v) {
    if (state.view !== v || v.done) return;
    v.busy = true; state.board.lock(true);
    let uci = null;
    try { uci = await opponentMove(v); } catch (e) { uci = null; }
    if (state.view !== v || v.done) return;
    if (!uci) { endReplay(v, 'error'); return; }
    const mv = safeMove(v.chess, uci);
    if (!mv) { endReplay(v, 'error'); return; }
    v.fens.push(v.chess.fen());
    state.board.set(v.chess, { lastMove: { from: mv.from, to: mv.to } });
    addMoveText(mv);
    if (v.chess.isGameOver()) { endReplay(v, 'over'); return; }
    const e = await evaluateAt(v.chess.fen(), 250, 'drill').catch(() => null);
    if (state.view !== v || v.done) return;
    if (!e) { playTrouble(v); return; }
    v.beforeScore = e.score;
    ui.boardEval.textContent = 'Eval ' + Core.formatEval(evalFromWhite(v.beforeScore, v.chess.turn()));
    v.busy = false; state.board.lock(false);
  }
  function endReplay(v, why) {
    if (v.done) return;
    v.done = true; v.busy = false;
    state.board.lock(true);
    const c = v.chess;
    let result = 'The replay was stopped.';
    if (why === 'over') {
      if (c.isCheckmate()) result = c.turn() === v.color ? `${v.opponent.elo} wins by checkmate.` : 'You win by checkmate.';
      else result = 'Drawn.';
    } else if (why === 'error') result = 'The opponent could not choose a move.';
    const avg = v.losses.length ? Math.round(v.losses.reduce((a, b) => a + b, 0) / v.losses.length) : null;
    ui.boardNote.textContent = `${result}${avg !== null ? ` You lost ${avg} centipawns per move over ${plural(v.losses.length, 'move')}.` : ''}`;
    ui.boardActions.replaceChildren();
  }

  /* ------------------------------ sharing ------------------------------ */

  function cloud() {
    const auth = window.siteAuth;
    const user = auth && typeof auth.user === 'function' ? auth.user() : null;
    const db = user && typeof auth.db === 'function' ? auth.db() : null;
    return db && user ? { db, uid: user.uid, auth } : null;
  }
  function withTimeout(promise) {
    return Promise.race([
      promise,
      new Promise((resolve, reject) => setTimeout(() => reject(new Error('The database did not answer in time.')), SHARE.timeoutMs)),
    ]);
  }
  /* 22 characters of base64url, which is 132 bits of randomness. */
  function randomId() {
    const bytes = new Uint8Array(17);
    crypto.getRandomValues(bytes);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, SHARE.idLength);
  }
  const shareUrl = id => new URL('?p=' + encodeURIComponent(id), location.href.split('?')[0].split('#')[0]).href;

  function setShareStatus(text) { if (ui.shareStatus) setStatus(ui.shareStatus, text); }

  async function shareCurrent() {
    if (!state.profile || state.shared || state.shareBusy) return;
    const c = cloud();
    if (!c) {
      setShareStatus('Sign in with GitHub or Google first. The link only works for signed-in readers, and signing in is what lets you revoke it later.');
      if (ui.sharePanel) ui.sharePanel.hidden = false;
      return;
    }
    state.shareBusy = true;
    if (ui.share) ui.share.disabled = true;
    if (ui.sharePanel) ui.sharePanel.hidden = false;
    setShareStatus('Preparing the pack.');
    try {
      const pack = Core.buildPack(state.profile, state.drills);
      const json = JSON.stringify(pack);
      if (json.length > Core.PACK_LIMITS.maxChars) throw new Error('This review is too large to share. Review fewer games and try again.');
      const list = await withTimeout(c.db.ref('users/' + c.uid + '/review-shares').once('value'));
      const existing = list && typeof list.val === 'function' ? (list.val() || {}) : {};
      const now = Date.now();
      let slot = null;
      for (let i = 0; i < SHARE.slots; i++) if (!existing[String(i)]) { slot = String(i); break; }
      if (slot === null) {
        /* every slot is taken, so the oldest one is replaced */
        const oldest = Object.keys(existing).sort((a, b) => (Number(existing[a].at) || 0) - (Number(existing[b].at) || 0))[0];
        if (Number(existing[oldest].at) > now - SHARE.slotGapMs) throw new Error('All ten links are in use. Revoke one below, or wait half a minute and try again.');
        slot = oldest;
        const oldId = String(existing[oldest].id || '');
        if (Core.PACK_ID.test(oldId)) await withTimeout(c.db.ref('review-shares/' + oldId).remove()).catch(() => {});
      }
      const id = randomId();
      const title = `${state.profile.player.name}, ${plural(state.profile.games, 'game')}`.slice(0, Core.PACK_LIMITS.maxTitle);
      const expiresAt = now + SHARE.lifetimeMs;
      /* the list entry has to land first: the pack's rule checks that the
         slot already names this id */
      await withTimeout(c.db.ref('users/' + c.uid + '/review-shares/' + slot).set({ id, title, at: now, expiresAt, drills: state.drills.length }));
      await withTimeout(c.db.ref('review-shares/' + id).set({ v: 1, owner: c.uid, slot, at: now, expiresAt, title, pack: json }));
      const ready = showShareLink(id, expiresAt);
      setShareStatus(ready);
      setShareStatus(ready + (await copyShareLink(shareUrl(id))));
      await loadMyShares();
    } catch (e) {
      setShareStatus((e && e.message) || 'The link could not be created.');
    } finally {
      state.shareBusy = false;
      if (ui.share) ui.share.disabled = false;
    }
  }

  function showShareLink(id, expiresAt) {
    if (!ui.shareLink) return;
    const url = shareUrl(id);
    ui.shareLink.setAttribute('href', url);
    ui.shareLink.textContent = url;
    if (ui.shareLinkRow) ui.shareLinkRow.hidden = false;
    let when = '';
    try { when = new Date(expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) {}
    return `The link is ready. Anyone signed in can open it until ${when}, practice the positions, and keep their own progress. It cannot be edited, and you can revoke it below.`;
  }

  /* Select the link itself, for the case where the clipboard is unavailable
     or refused. There is no input to select, so this puts a range over the
     anchor's own text. */
  function selectShareLink() {
    if (!ui.shareLink || !window.getSelection) return false;
    try {
      const range = document.createRange();
      range.selectNodeContents(ui.shareLink);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    } catch (e) { return false; }
  }

  /* Returns the sentence to show, so the caller can put it in one status
     line rather than overwriting itself. */
  async function copyShareLink(url) {
    const value = url || (ui.shareLink ? ui.shareLink.getAttribute('href') || '' : '');
    if (!value) return '';
    if (!navigator.clipboard || !window.isSecureContext) {
      return selectShareLink() ? ' It is selected below; copy it with your keyboard.' : ' The link is below.';
    }
    try {
      await navigator.clipboard.writeText(value);
      return ' It is on your clipboard, ready to paste.';
    } catch (e) {
      return selectShareLink() ? ' Copying was blocked, so it is selected below; copy it with your keyboard.' : ' Copying was blocked. The link is below.';
    }
  }

  async function loadMyShares() {
    if (!ui.shareList) return;
    const c = cloud();
    if (!c) { ui.shareList.replaceChildren(); return; }
    let value = {};
    try {
      const snapshot = await withTimeout(c.db.ref('users/' + c.uid + '/review-shares').once('value'));
      value = (snapshot && typeof snapshot.val === 'function' ? snapshot.val() : null) || {};
    } catch (e) { return; }
    const rows = Object.keys(value).sort().map(slot => {
      const entry = value[slot] || {};
      const id = String(entry.id || '');
      if (!Core.PACK_ID.test(id)) return null;
      let when = '';
      try { when = new Date(Number(entry.expiresAt) || 0).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); } catch (e) {}
      const open = h('a', { className: 'gr-share-title', text: String(entry.title || 'A review'), target: '_blank', rel: 'noopener noreferrer' });
      open.setAttribute('href', shareUrl(id));
      const li = h('li', null, [
        open,
        h('span', { className: 'gr-muted', text: `${Number(entry.drills) || 0} positions · until ${when}` }),
      ]);
      const copy = h('button', { type: 'button', className: 'tool-button', text: 'Copy link' });
      copy.addEventListener('click', async () => {
        showShareLink(id, Number(entry.expiresAt) || 0);
        setShareStatus('That link' + (await copyShareLink(shareUrl(id))));
      });
      const revoke = h('button', { type: 'button', className: 'tool-button', text: 'Revoke' });
      revoke.addEventListener('click', () => revokeShare(slot, id, revoke));
      li.append(copy, revoke);
      return li;
    }).filter(Boolean);
    ui.shareList.replaceChildren(...rows);
    ui.shareList.hidden = rows.length === 0;
  }

  async function revokeShare(slot, id, button) {
    const c = cloud();
    if (!c) return;
    button.disabled = true;
    try {
      await withTimeout(c.db.ref('review-shares/' + id).remove());
      await withTimeout(c.db.ref('users/' + c.uid + '/review-shares/' + slot).remove());
      setShareStatus('That link no longer opens.');
      if (ui.shareLink && ui.shareLink.getAttribute('href') === shareUrl(id)) {
        ui.shareLink.removeAttribute('href');
        ui.shareLink.textContent = '';
        if (ui.shareLinkRow) ui.shareLinkRow.hidden = true;
      }
      await loadMyShares();
    } catch (e) {
      button.disabled = false;
      setShareStatus((e && e.message) || 'The link could not be revoked.');
    }
  }

  /* ---------- the learner's side ---------- */

  function sharedIdFromUrl() {
    let id = '';
    try { id = new URL(location.href).searchParams.get('p') || ''; } catch (e) { return ''; }
    return Core.PACK_ID.test(id) ? id : '';
  }

  async function openSharedPack(id) {
    hidePanel(ui.gamesPanel); hidePanel(ui.playerPanel); hidePanel(ui.reviewPanel);
    if (ui.sharedBanner) ui.sharedBanner.hidden = false;
    const say = text => { if (ui.sharedBannerText) ui.sharedBannerText.textContent = text; };
    say('Opening a shared review.');
    const auth = window.siteAuth;
    if (!auth) { say('This review needs the sign-in service, which did not load. Reload the page.'); return; }
    let user = null;
    try { user = await auth.ready(); } catch (e) { user = null; }
    if (!user) {
      say('This is a review someone shared with you. Sign in with GitHub or Google to open it; your practice is then kept in your account.');
      showSharedSignIn();
      return;
    }
    say('Loading the review.');
    let raw = null;
    try {
      const snapshot = await withTimeout(auth.db().ref('review-shares/' + id).once('value'));
      raw = snapshot && typeof snapshot.val === 'function' ? snapshot.val() : null;
    } catch (e) {
      say('That link could not be opened. It may have expired, been revoked, or never existed.');
      return;
    }
    if (!raw || typeof raw !== 'object' || typeof raw.pack !== 'string' || raw.pack.length > Core.PACK_LIMITS.maxChars) {
      say('That link could not be opened. It may have expired, been revoked, or never existed.');
      return;
    }
    let parsed = null;
    try { parsed = JSON.parse(raw.pack); } catch (e) { parsed = null; }
    const pack = Core.validPack(parsed);
    if (!pack) { say('That review could not be read. Ask for a fresh link.'); return; }
    state.shared = { id, pack, slot: null };
    await loadSharedProgress(id);
    state.profile = Core.profileFromPack(pack);
    state.reviews = [];
    state.drills = pack.drills.slice();
    renderProfile();
    if (ui.gamesDetail) ui.gamesDetail.hidden = true;
    if (ui.trendSection) ui.trendSection.hidden = true;
    if (ui.profilePanel) ui.profilePanel.hidden = false;
    if (ui.boardPanel) ui.boardPanel.hidden = false;
    if (ui.drillsPanel) ui.drillsPanel.hidden = false;
    renderDrills();
    let when = '';
    try { when = new Date(Number(raw.at) || 0).toLocaleDateString(undefined, { day: 'numeric', month: 'long' }); } catch (e) {}
    say(`You are practicing ${pack.player}'s review of ${plural(pack.games, 'game')}, shared on ${when}. The positions are ready; your progress is kept in your account. Nothing here changes the original.`);
  }

  function showSharedSignIn() {
    if (!ui.sharedBanner) return;
    const row = h('div', { className: 'tool-actions' });
    for (const [provider, label] of [['github', 'Sign in with GitHub'], ['google', 'Sign in with Google']]) {
      const b = h('button', { type: 'button', className: 'tool-button', text: label });
      b.addEventListener('click', () => { b.disabled = true; window.siteAuth.signIn(provider).catch(() => { b.disabled = false; }); });
      row.appendChild(b);
    }
    ui.sharedBanner.appendChild(row);
  }
  const hidePanel = el => { if (el) el.hidden = true; };

  /* The learner's practice record for one pack, in their own account, so it
     follows them to another device. Only this pack's drills are stored. */
  async function loadSharedProgress(id) {
    const c = cloud();
    if (!c) return;
    try {
      const snapshot = await withTimeout(c.db.ref('users/' + c.uid + '/review-progress').once('value'));
      const value = (snapshot && typeof snapshot.val === 'function' ? snapshot.val() : null) || {};
      let free = null, oldest = null;
      for (let i = 0; i < SHARE.slots; i++) {
        const slot = String(i), entry = value[slot];
        if (!entry) { if (free === null) free = slot; continue; }
        if (String(entry.id || '') === id) {
          state.shared.slot = slot;
          let stored = null;
          try { stored = JSON.parse(String(entry.data || '{}')); } catch (e) { stored = null; }
          if (stored && typeof stored === 'object') {
            for (const [key, rec] of Object.entries(stored)) {
              if (!/^(own:[0-9a-f]{16}:\d{1,3}|puzzle:[A-Za-z0-9]{5})$/.test(key) || !rec || typeof rec !== 'object') continue;
              const num = x => (Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);
              state.drillProgress[key] = { attempts: num(rec.attempts), best: Math.min(100, num(rec.best)), last: Math.min(100, num(rec.last)), step: Math.min(Core.REVIEW_DAYS.length - 1, num(rec.step)), due: num(rec.due), at: num(rec.at) };
            }
          }
          return;
        }
        if (oldest === null || (Number(entry.at) || 0) < (Number(value[oldest].at) || 0)) oldest = slot;
      }
      state.shared.slot = free !== null ? free : (oldest || '0');
    } catch (e) { /* the learner can still practice locally */ }
  }

  function queueSharedProgress() {
    if (!state.shared || !cloud()) return;
    if (state.shareTimer) clearTimeout(state.shareTimer);
    state.shareTimer = setTimeout(saveSharedProgress, SHARE.syncDelayMs);
  }
  async function saveSharedProgress() {
    state.shareTimer = null;
    const c = cloud();
    if (!state.shared || !c || !state.shared.slot) return;
    const mine = {};
    for (const d of state.drills) if (state.drillProgress[d.id]) mine[d.id] = state.drillProgress[d.id];
    const data = JSON.stringify(mine);
    if (data.length > 50000) return;
    try {
      await withTimeout(c.db.ref('users/' + c.uid + '/review-progress/' + state.shared.slot).set({
        id: state.shared.id, title: String(state.shared.pack.player).slice(0, 80), at: Date.now(), data,
      }));
    } catch (e) { /* the local record is still the source of truth */ }
  }

  /* A moment from a shared review, drawn from the pack rather than from a
     game this browser reviewed. */
  function showSharedEvidence(e) {
    const board = ensureBoard();
    state.view = { kind: 'evidence' };
    board.movable(null);
    board.lock(true);
    board.orientation(e.color);
    const arrows = [];
    try {
      const c = new Chess(e.fen);
      const mv = c.move(e.san);
      if (mv) arrows.push({ from: mv.from, to: mv.to, kind: 'played' });
    } catch (err) { /* the arrow is a nicety */ }
    if (e.best && (!arrows.length || e.best.slice(0, 4) !== arrows[0].from + arrows[0].to)) arrows.push({ from: e.best.slice(0, 2), to: e.best.slice(2, 4), kind: 'best' });
    board.set(e.fen, { arrows });
    ui.boardTitle.textContent = `Game ${e.game + 1}, move ${e.num}${e.color === 'w' ? '.' : '…'} ${e.san}`;
    ui.boardNote.textContent = e.note || '';
    hideObjective();
    ui.drillStatus.hidden = true;
    hideRecap();
    const lines = [];
    const bestSan = Core.lineSan(e.fen, e.pvBest).slice(0, 6).join(' ');
    if (bestSan) lines.push(line('Best line', bestSan));
    if (e.fenAfter && e.pvPunish && e.pvPunish.length) {
      const punishSan = Core.lineSan(e.fenAfter, e.pvPunish).slice(0, 5).join(' ');
      if (punishSan) lines.push(line('After the move', punishSan));
    }
    ui.boardLines.replaceChildren(...lines);
    ui.boardMoves.replaceChildren();
    ui.boardEval.textContent = '';
    ui.boardActions.replaceChildren();
    ui.boardPanel.hidden = false;
  }

  /* ------------------------------ wiring ------------------------------ */

  ui.drop.addEventListener('click', () => ui.files.click());
  ui.drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ui.files.click(); } });
  ['dragenter', 'dragover'].forEach(n => ui.drop.addEventListener(n, e => { e.preventDefault(); ui.drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(n => ui.drop.addEventListener(n, e => { e.preventDefault(); ui.drop.classList.remove('over'); }));
  ui.drop.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files) { readFiles(e.dataTransfer.files); startEngine(); } });
  ui.files.addEventListener('change', () => { readFiles(ui.files.files); ui.files.value = ''; startEngine(); });
  ui.pasteAdd.addEventListener('click', () => {
    const text = ui.paste.value;
    if (text.length > LIMITS.maxTotalBytes || Core.byteLength(text) > LIMITS.maxTotalBytes) { message('That paste is larger than 7 MB.', 'error'); return; }
    if (!text.trim()) { message('Paste at least one game first.', 'warn'); return; }
    addGames([text], 'the paste');
    ui.paste.value = '';
    startEngine();
  });
  ui.importBtn.addEventListener('click', () => { importGames(); startEngine(); });
  ui.importUser.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); importGames(); startEngine(); } });
  for (const el of [ui.importSite, ui.importUser, ui.importCount]) el.addEventListener('input', () => { state.importSeq++; ui.importBtn.disabled = false; });
  ui.clear.addEventListener('click', clearGames);
  ui.forget.addEventListener('click', forgetAll);
  ui.display.addEventListener('change', updatePlayerFromForm);
  ui.rating.addEventListener('change', () => { persistOptions(); updatePlayer(); });
  for (const el of [ui.incLoss, ui.incDraw, ui.incWin]) el.addEventListener('change', () => { persistOptions(); updatePlayer(); });
  ui.quality.addEventListener('change', () => { persistOptions(); updateEstimate(); });
  ui.opponent.addEventListener('change', () => { persistOptions(); opponentNote(); if (state.view && state.view.kind === 'drill' && !state.view.done) drillActions(); });
  ui.run.addEventListener('click', runReview);
  ui.stop.addEventListener('click', stopReview);
  ui.saveFile.addEventListener('click', saveReport);
  ui.flip.addEventListener('click', () => { const b = ensureBoard(); b.orientation(b.orientation() === 'w' ? 'b' : 'w'); });
  ui.prev.addEventListener('click', () => stepMove(-1));
  ui.next.addEventListener('click', () => stepMove(1));
  ui.drillsRefresh.addEventListener('click', buildDrills);
  if (ui.share) ui.share.addEventListener('click', shareCurrent);
  if (ui.shareCopy) ui.shareCopy.addEventListener('click', async () => { setShareStatus('That link' + (await copyShareLink())); });
  window.addEventListener('pagehide', releaseDownload);

  /* a stored value this page cannot read is removed, never allowed to
     stop the page */
  const guarded = (fn, key) => { try { return fn(); } catch (e) { lsSet(key, null); return null; } };
  guarded(restoreOptions, KEYS.options);
  state.identity = guarded(restoreIdentity, KEYS.identity);
  guarded(restoreRecords, KEYS.records);
  guarded(restoreSnapshots, KEYS.snapshots);
  guarded(restoreDrillProgress, KEYS.drills);
  guarded(restoreGames, KEYS.games);
  renderOpponents();
  persistOptions();                      // canonical form of whatever was accepted
  refreshNames();
  renderGames();
  const sharedId = sharedIdFromUrl();
  if (sharedId) {
    openSharedPack(sharedId);
    startEngine();
    if (window.siteAuth && typeof window.siteAuth.onChange === 'function') {
      let seen = !!cloud();
      window.siteAuth.onChange(user => {
        if (user && !seen) { seen = true; openSharedPack(sharedId); }
      });
    }
  } else if (state.games.length) {
    message(`${plural(state.games.length, 'game')} restored from your last visit.`, 'ok');
    startEngine();
  }
  if (window.siteAuth && typeof window.siteAuth.onChange === 'function' && !sharedId) {
    window.siteAuth.onChange(() => { if (state.profile) loadMyShares(); });
  }
}
