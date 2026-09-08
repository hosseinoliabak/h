/* Game Review core.
 *
 * Everything the Game Review page decides lives here. That covers how a PGN
 * file is split and parsed, which names belong to the player, how each move is
 * graded from the engine's numbers, what kind of error a bad move was, how
 * the errors add up to a profile of weaknesses and strengths, and which
 * positions to practice. There is no DOM and no network in this file. The
 * page drives the engine and hands the results in; node tests call the same
 * functions directly.
 *
 * Evaluations are centipawns from the point of view of the side to move, as
 * the engine reports them, with a mate in n mapped to MATE - n. Every
 * function that takes a game expects the object parseGame returns.
 */
import { Chess } from './chess-assets/chess.js';

export { Chess };
export const MATE = 100000;

export const LIMITS = {
  maxFiles: 60,
  maxTotalBytes: 7 * 1024 * 1024,     // site-wide upload ceiling
  maxGameChars: 256 * 1024,           // one annotated game; reported when it is the reason a game is skipped
  maxGames: 400,
  minPlies: 10,
  maxPlies: 600,
  maxNameChars: 60,
  maxAliases: 12,
  maxSnapshots: 30,
  maxEvidence: 12,
  pvPlies: 10,
};

/* Search time per position in milliseconds. The quick pass grades every
   position; the slow pass re-checks the player's flagged moves and asks one
   more question of each, what the opponent was threatening. */
export const QUALITY = {
  quick:    { fast: 120, slow: 500,  threat: 250, label: 'Quick' },
  standard: { fast: 220, slow: 900,  threat: 400, label: 'Standard' },
  deep:     { fast: 450, slow: 1800, threat: 800, label: 'Deep' },
};
export const FLAG_LOSS = 60;        // a quick-pass loss this large gets the slow pass

/* Rough average-centipawn-loss to rating table, the same one the coach page
   uses, read in both directions. */
export const ACPL_ELO = [[8, 2700], [15, 2500], [25, 2200], [35, 2000], [50, 1800], [70, 1550], [90, 1350], [120, 1100], [160, 850], [220, 600], [300, 350], [500, 150]];

/* A rating the page accepts, as an integer, or null. */
export function validRating(value) {
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  return Number.isInteger(n) && n >= 100 && n <= 3500 ? n : null;
}

export function eloFromAcpl(acpl) {
  const T = ACPL_ELO;
  if (acpl <= T[0][0]) return T[0][1];
  for (let i = 1; i < T.length; i++) {
    const [a1, e1] = T[i - 1], [a2, e2] = T[i];
    if (acpl <= a2) return Math.round(e1 + (e2 - e1) * (acpl - a1) / (a2 - a1));
  }
  return T[T.length - 1][1];
}
export function acplForElo(elo) {
  const T = ACPL_ELO;
  if (elo >= T[0][1]) return T[0][0];
  for (let i = 1; i < T.length; i++) {
    const [a1, e1] = T[i - 1], [a2, e2] = T[i];
    if (elo >= e2) return Math.round(a1 + (a2 - a1) * (e1 - elo) / (e1 - e2));
  }
  return T[T.length - 1][0];
}

const FILES = 'abcdefgh';
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const PIECE_WORD = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
export const other = c => (c === 'w' ? 'b' : 'w');
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/* ====================== PGN files ====================== */

export function splitPgn(text) {
  const t = String(text || '').replace(/\r\n?/g, '\n').replace(/^﻿/, '').trim();
  if (!t) return [];
  const parts = t.split(/\n\s*\n(?=\s*\[Event\b)/).map(s => s.trim()).filter(Boolean);
  return parts.slice(0, LIMITS.maxGames);
}

export function tagOf(raw, name) {
  const m = new RegExp('\\[\\s*' + name + '\\s+"([^"]*)"', 'i').exec(raw);
  return m ? m[1].trim() : '';
}

/* Think time per ply from [%clk] comments, the same reading the coach page
   uses. The clock after a move is what was left, so a think is the same
   side's previous reading minus this one plus the increment. */
export function clocksOf(raw, plies) {
  const cs = [...String(raw).matchAll(/\[%clk\s+(\d+):(\d+):([\d.]+)\]/g)]
    .map(m => +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]));
  if (cs.length !== plies || plies < 4) return null;
  const tc = /^(\d+)(?:\+(\d+))?$/.exec(tagOf(raw, 'TimeControl'));
  const base = tc ? +tc[1] : null, inc = tc && tc[2] ? +tc[2] : 0;
  return cs.map((c, i) => {
    const prev = i >= 2 ? cs[i - 2] : base;
    const think = prev === null ? null : prev - c + inc;
    return { left: c, think: think !== null && think >= 0 && think < 7200 ? think : null };
  });
}

/* Two FNV-1a passes over a string, forward and backward, as sixteen hex
   digits. Used for game ids and batch ids. */
export function hashOf(s) {
  let h = 0x811c9dc5, g = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  for (let i = s.length - 1; i >= 0; i--) { g ^= s.charCodeAt(i); g = Math.imul(g, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0') + g.toString(16).padStart(8, '0');
}
export const ID_RE = /^[0-9a-f]{16}$/;

export function normalizeName(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.maxNameChars);
}
const nameKey = s => normalizeName(s).toLowerCase().replace(/[_\-.]/g, ' ').replace(/\s+/g, ' ');

const RATING_OK = r => Number.isFinite(r) && r >= 100 && r <= 3500;

function gameLink(raw) {
  for (const t of ['Link', 'Site']) {
    const v = tagOf(raw, t);
    if (!/^https:\/\/(www\.chess\.com|lichess\.org)\/[A-Za-z0-9/_\-#?=.]{1,120}$/.test(v)) continue;
    return v;
  }
  return '';
}

const utf8Bytes = s => (typeof TextEncoder === 'function' ? new TextEncoder().encode(s).length : Buffer.byteLength(s, 'utf8'));
export function byteLength(s) { return utf8Bytes(String(s)); }

export function parseGame(raw) {
  if (typeof raw !== 'string' || raw.length > LIMITS.maxGameChars || utf8Bytes(raw) > LIMITS.maxGameChars) return null;
  const chess = new Chess();
  try { chess.loadPgn(raw); } catch (e) { return null; }
  let history;
  try { history = chess.history({ verbose: true }); } catch (e) { return null; }
  if (history.length < LIMITS.minPlies || history.length > LIMITS.maxPlies) return null;
  const white = normalizeName(tagOf(raw, 'White')) || 'White';
  const black = normalizeName(tagOf(raw, 'Black')) || 'Black';
  const welo = parseInt(tagOf(raw, 'WhiteElo'), 10), belo = parseInt(tagOf(raw, 'BlackElo'), 10);
  const result = tagOf(raw, 'Result');
  const plies = history.map((m, i) => ({
    i, san: m.san, uci: m.from + m.to + (m.promotion || ''), before: m.before, after: m.after,
    color: m.color, num: +(m.before.split(' ')[5] || 1),
  }));
  const site = tagOf(raw, 'Site');
  const source = /chess\.com/i.test(site) ? 'chess.com' : /lichess/i.test(site) ? 'lichess' : 'file';
  /* the same moves between the same players are one game unless the file
     says otherwise (another round, event, result, or link) */
  const id = hashOf([nameKey(white), nameKey(black), tagOf(raw, 'Date'), tagOf(raw, 'Round'), tagOf(raw, 'Event'), result, gameLink(raw), history[0].before, plies.map(p => p.uci).join('')].join('|'));
  return {
    id, white, black,
    welo: RATING_OK(welo) ? welo : null, belo: RATING_OK(belo) ? belo : null,
    date: tagOf(raw, 'Date'), result: ['1-0', '0-1', '1/2-1/2'].includes(result) ? result : '*',
    tc: tagOf(raw, 'TimeControl'), event: tagOf(raw, 'Event').slice(0, 80), round: tagOf(raw, 'Round').slice(0, 20),
    eco: /^[A-E]\d\d$/.test(tagOf(raw, 'ECO')) ? tagOf(raw, 'ECO') : '',
    site: source, link: gameLink(raw),
    startFen: history[0].before, custom: history[0].before !== START_FEN,
    plies, clocks: clocksOf(raw, plies.length), raw,
  };
}
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/* Parse many files' worth of text into unique games. */
export function parseGames(texts) {
  const out = [], seen = new Set();
  let skipped = 0;
  for (const text of texts) {
    for (const raw of splitPgn(text)) {
      if (out.length >= LIMITS.maxGames) return { games: out, skipped: skipped + 1 };
      const g = parseGame(raw);
      if (!g) { skipped++; continue; }
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      out.push(g);
    }
  }
  return { games: out, skipped };
}

/* ====================== the player ====================== */

export function namesIn(games) {
  const m = new Map();
  for (const g of games) {
    for (const [name, color, elo] of [[g.white, 'w', g.welo], [g.black, 'b', g.belo]]) {
      const k = nameKey(name);
      if (!m.has(k)) m.set(k, { name, key: k, count: 0, white: 0, black: 0, elo: null });
      const e = m.get(k);
      e.count++; e[color === 'w' ? 'white' : 'black']++;
      if (elo) e.elo = elo;
    }
  }
  return [...m.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function makeIdentity(display, aliases) {
  const seen = new Set(), list = [];
  for (const a of aliases || []) {
    const n = normalizeName(a);
    if (!n || seen.has(nameKey(n))) continue;
    seen.add(nameKey(n)); list.push(n);
    if (list.length >= LIMITS.maxAliases) break;
  }
  return { display: normalizeName(display) || list[0] || 'Player', aliases: list };
}

export function isAlias(identity, name) {
  const k = nameKey(name);
  return identity.aliases.some(a => nameKey(a) === k);
}

/* Which side the player had in a game, or null when neither or both names match. */
export function playerColor(game, identity) {
  const w = isAlias(identity, game.white), b = isAlias(identity, game.black);
  if (w && !b) return 'w';
  if (b && !w) return 'b';
  return null;
}

export function resultFor(game, color) {
  if (game.result === '1/2-1/2') return 'draw';
  if (game.result === '*') return null;
  const whiteWon = game.result === '1-0';
  return (whiteWon === (color === 'w')) ? 'win' : 'loss';
}

/* ====================== board helpers ====================== */

function safeMove(c, uci) {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci || '')) return null;
  try { return c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined }); }
  catch (e) { return null; }
}

function material(c, color) {
  let d = 0;
  for (const row of c.board()) for (const p of row) {
    if (!p) continue;
    d += (p.color === color ? 1 : -1) * VALUE[p.type];
  }
  return d;
}
/* Material balance in pawns from the side to move, or 0 for a bad FEN. */
export function materialOf(fen) {
  try { const c = new Chess(fen); return material(c, c.turn()); } catch (e) { return 0; }
}

function pieceCounts(c) {
  const out = { minors: 0, majors: 0, queens: 0, pawns: 0, total: 0 };
  for (const row of c.board()) for (const p of row) {
    if (!p) continue;
    out.total++;
    if (p.type === 'p') out.pawns++;
    else if (p.type === 'q') { out.queens++; out.majors++; }
    else if (p.type === 'r') out.majors++;
    else if (p.type === 'n' || p.type === 'b') out.minors++;
  }
  return out;
}

function kingSquare(c, color) {
  const found = c.findPiece({ type: 'k', color });
  return found && found.length ? found[0] : null;
}

/* Whether the piece of `color` on `sq` is pinned to its king along a line,
   which is read from the geometry so it works whoever is to move. */
function isPinned(c, sq, color) {
  const k = kingSquare(c, color);
  if (!k || k === sq) return false;
  const df = Math.sign(fileOf(sq) - fileOf(k)), dr = Math.sign(rankOf(sq) - rankOf(k));
  if (!df && !dr) return false;
  const diagonal = df !== 0 && dr !== 0;
  if (diagonal && Math.abs(fileOf(sq) - fileOf(k)) !== Math.abs(rankOf(sq) - rankOf(k))) return false;
  let f = fileOf(k) + df, r = rankOf(k) + dr, passed = false;
  while (true) {
    const s = sqAt(f, r);
    if (!s) return false;
    if (s === sq) passed = true;
    else {
      const q = c.get(s);
      if (q) {
        if (!passed) return false;                      // something between the king and the piece
        return q.color !== color && (q.type === 'q' || q.type === (diagonal ? 'b' : 'r'));
      }
    }
    f += df; r += dr;
  }
}

/* Whether the side to move has a legal capture on `sq`. */
function canCapture(c, sq) {
  try { return c.moves({ verbose: true }).some(m => m.to === sq && m.captured); } catch (e) { return false; }
}

/* The same board with the other side to move, so the engine can say what
   that side threatens. Null when the side to move is in check, because a
   null move there is illegal. */
export function nullMoveFen(fen) {
  let c;
  try { c = new Chess(fen); } catch (e) { return null; }
  if (c.inCheck()) return null;
  const parts = fen.split(' ');
  if (parts.length < 4) return null;
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  try { new Chess(parts.join(' ')); } catch (e) { return null; }
  return parts.join(' ');
}

const DIRS = { b: [[1, 1], [1, -1], [-1, 1], [-1, -1]], r: [[1, 0], [-1, 0], [0, 1], [0, -1]] };
DIRS.q = DIRS.b.concat(DIRS.r);
const KNIGHT = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
const sqAt = (f, r) => (f >= 0 && f < 8 && r >= 0 && r < 8 ? FILES[f] + (r + 1) : null);
const fileOf = sq => FILES.indexOf(sq[0]);
const rankOf = sq => +sq[1] - 1;

/* Squares the piece on `sq` attacks, read from the geometry rather than
   from the move list, so it works whoever is to move and whether or not
   the position is check. */
function attacksFrom(c, sq) {
  const p = c.get(sq);
  if (!p) return [];
  const f = fileOf(sq), r = rankOf(sq), out = [];
  const push = (ff, rr) => { const s = sqAt(ff, rr); if (s) out.push(s); };
  if (p.type === 'p') { const dr = p.color === 'w' ? 1 : -1; push(f - 1, r + dr); push(f + 1, r + dr); }
  else if (p.type === 'n') for (const [a, b] of KNIGHT) push(f + a, r + b);
  else if (p.type === 'k') { for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) if (a || b) push(f + a, r + b); }
  else for (const [df, dr] of DIRS[p.type]) {
    let ff = f + df, rr = r + dr;
    while (true) { const s = sqAt(ff, rr); if (!s) break; out.push(s); if (c.get(s)) break; ff += df; rr += dr; }
  }
  return out;
}

/* Enemy pieces, other than the king, that the piece on `sq` attacks. */
function attackedPieces(c, sq, me) {
  const out = [];
  for (const s of attacksFrom(c, sq)) {
    const q = c.get(s);
    if (q && q.color !== me && q.type !== 'k') out.push({ square: s, type: q.type, value: VALUE[q.type] });
  }
  return out;
}

/* Along each ray of the slider on `sq`, the first two enemy pieces with
   only empty squares between them. Returns the first such pair. */
function rayPair(c, sq, me) {
  const p = c.get(sq);
  if (!p || !DIRS[p.type]) return null;
  for (const [df, dr] of DIRS[p.type]) {
    let f = fileOf(sq) + df, r = rankOf(sq) + dr, front = null;
    while (true) {
      const s = sqAt(f, r);
      if (!s) break;
      const q = c.get(s);
      if (q) {
        if (q.color === me) break;
        if (!front) front = { square: s, type: q.type, value: VALUE[q.type] };
        else return { front, back: { square: s, type: q.type, value: VALUE[q.type] } };
      }
      f += df; r += dr;
    }
  }
  return null;
}

/* A slider of `me` attacking an enemy piece worth at least a rook, or the
   king, along a ray that passes through `through`. */
function discoveredThrough(c, through, me) {
  const tf = fileOf(through), tr = rankOf(through);
  for (const row of c.board()) for (const p of row) {
    if (!p || p.color !== me || !DIRS[p.type] || p.square === through) continue;
    const df = Math.sign(tf - fileOf(p.square)), dr = Math.sign(tr - rankOf(p.square));
    if (!DIRS[p.type].some(([a, b]) => a === df && b === dr)) continue;
    /* walk from the slider through `through` and on to the first piece */
    let f = fileOf(p.square) + df, r = rankOf(p.square) + dr, passed = false;
    while (true) {
      const s = sqAt(f, r);
      if (!s) break;
      if (s === through) passed = true;
      const q = c.get(s);
      if (q) {
        if (passed && q.color !== me && (q.type === 'k' || VALUE[q.type] >= 5)) return { square: s, type: q.type };
        break;
      }
      f += df; r += dr;
    }
  }
  return null;
}

function isBackRankMate(c, loser) {
  const k = kingSquare(c, loser);
  if (!k) return false;
  const home = loser === 'w' ? 0 : 7;
  if (rankOf(k) !== home) return false;
  const checkers = c.attackers(k, other(loser));
  if (!checkers.some(s => { const p = c.get(s); return p && (p.type === 'r' || p.type === 'q') && rankOf(s) === home; })) return false;
  const ahead = home === 0 ? 1 : -1;
  let blocked = 0, cells = 0;
  for (const df of [-1, 0, 1]) {
    const s = sqAt(fileOf(k) + df, home + ahead);
    if (!s) continue;
    cells++;
    const p = c.get(s);
    if (p && p.color === loser) blocked++;
  }
  return cells > 0 && blocked === cells;
}

function isSmotheredMate(c, loser) {
  const k = kingSquare(c, loser);
  if (!k) return false;
  const checkers = c.attackers(k, other(loser));
  if (checkers.length !== 1) return false;
  const p = c.get(checkers[0]);
  if (!p || p.type !== 'n') return false;
  for (const df of [-1, 0, 1]) for (const dr of [-1, 0, 1]) {
    if (!df && !dr) continue;
    const s = sqAt(fileOf(k) + df, rankOf(k) + dr);
    if (!s) continue;
    const q = c.get(s);
    if (!q || q.color !== loser) return false;
  }
  return true;
}

/* Every legal destination of the piece on `sq` is attacked by `me`, or it
   has none. `c` has the piece's owner to move. */
function pieceTrapped(c, sq, me) {
  let moves = [];
  try { moves = c.moves({ square: sq, verbose: true }); } catch (e) { return false; }
  if (!moves.length) return true;
  return moves.every(m => {
    if (m.captured && VALUE[m.captured] >= VALUE[m.piece]) return false;
    return c.attackers(m.to, me).length > 0;
  });
}

/* ====================== what a line does ====================== */

export const MOTIFS = {
  'mate':         { label: 'a forced mate',            themes: ['mateIn3', 'mateIn4'] },
  'back-rank':    { label: 'a back-rank mate',         themes: ['backRankMate'] },
  'smothered':    { label: 'a smothered mate',         themes: ['smotheredMate'] },
  'hanging':      { label: 'a hanging piece',          themes: ['hangingPiece'] },
  'fork':         { label: 'a fork',                   themes: ['fork'] },
  'pin':          { label: 'a pin',                    themes: ['pin'] },
  'skewer':       { label: 'a skewer',                 themes: ['skewer'] },
  'discovered':   { label: 'a discovered attack',      themes: ['discoveredAttack', 'discoveredCheck'] },
  'double-check': { label: 'a double check',           themes: ['doubleCheck'] },
  'trapped':      { label: 'a trapped piece',          themes: ['trappedPiece'] },
  'deflection':   { label: 'a sacrifice that removes a defender', themes: ['deflection', 'attraction', 'capturingDefender'] },
  'promotion':    { label: 'a passed pawn running home', themes: ['advancedPawn', 'promotion'] },
  'material':     { label: 'a material win',           themes: ['sacrifice', 'intermezzo'] },
  'quiet':        { label: 'a quiet move',             themes: ['quietMove'] },
  'tactic':       { label: 'a tactic',                 themes: ['sacrifice'] },
  'unknown':      { label: 'the right move',           themes: [] },
};
export const TACTICAL = new Set(['mate', 'back-rank', 'smothered', 'hanging', 'fork', 'pin', 'skewer', 'discovered', 'double-check', 'trapped', 'deflection', 'promotion', 'material']);

/* Replay a principal variation from `fen` and say what the side to move
   gets out of it. The result names the mechanism when one shows, and
   otherwise whether the line wins material or is a quiet improvement.
   `hint.gain` (pawns) and `hint.mate` (moves) come from the engine's
   score, and stand in when the line is too short to show the payoff. */
export function motifOf(fen, pv, hint = {}) {
  let c;
  try { c = new Chess(fen); } catch (e) { return { motif: 'unknown', gain: 0, mateIn: 0 }; }
  const me = c.turn(), opp = other(me);
  const before = new Chess(fen);
  const m0 = material(c, me);
  const line = [];
  for (const uci of (pv || []).slice(0, 8)) {
    const mv = safeMove(c, uci);
    if (!mv) break;
    line.push({ mv, check: c.inCheck(), mate: c.isCheckmate(), material: material(c, me) - m0, fen: c.fen() });
    if (c.isGameOver()) break;
  }
  const hintMate = Number.isFinite(hint.mate) && hint.mate > 0 ? hint.mate : 0;
  const hintGain = Number.isFinite(hint.gain) ? hint.gain : 0;
  if (!line.length) return { motif: hintMate ? 'mate' : 'unknown', gain: hintGain, mateIn: hintMate, firstUci: (pv || [])[0] || null };
  const first = line[0];
  const mateAt = line.findIndex((p, k) => p.mate && k % 2 === 0);
  /* material is read after an opponent reply, so a capture the opponent
     simply takes back does not count. When the line ends on the mover's
     own capture, a piece left standing on an attacked square is written off. */
  const settled = k => {
    const p = line[k];
    if (k % 2 === 1) return p.material;
    const pos = new Chess(p.fen);
    const onTo = pos.get(p.mv.to);
    return p.material - (onTo && canCapture(pos, p.mv.to) ? VALUE[onTo.type] : 0);
  };
  const lineGain = mateAt >= 0 ? line[mateAt].material : settled(line.length - 1);
  /* the line, or the engine, says it pays; the engine's word does not
     override a replayed line that plainly loses material */
  const strong = lineGain >= 2 || (hintGain >= 2 && lineGain > -1);
  const gain2 = line.length > 1 ? line[1].material : first.material;
  const out = { gain: lineGain, mateIn: mateAt >= 0 ? mateAt / 2 + 1 : hintMate, first: first.mv.san, firstUci: (pv || [])[0] };
  if (mateAt >= 0) {
    const end = new Chess(line[mateAt].fen);
    out.motif = isBackRankMate(end, opp) ? 'back-rank' : isSmotheredMate(end, opp) ? 'smothered' : 'mate';
    return out;
  }
  if (hintMate) return { ...out, motif: 'mate' };
  const after1 = new Chess(first.fen);
  void before;
  const oppKing = kingSquare(after1, opp);
  const checkers = first.check && oppKing ? after1.attackers(oppKing, me) : [];
  if (checkers.length >= 2 && strong) return { ...out, motif: 'double-check' };
  if (first.mv.captured) {
    /* a defender that is pinned cannot recapture, so recaptures are read
       from the legal moves after the capture, not from the geometry */
    const worth = VALUE[first.mv.captured];
    if (!canCapture(after1, first.mv.to) && worth >= 1 && gain2 >= worth - 0.5) return { ...out, motif: 'hanging', piece: PIECE_WORD[first.mv.captured] };
  }
  const pinned = isPinned(after1, first.mv.to, me);
  const targets = pinned ? [] : attackedPieces(after1, first.mv.to, me).filter(t => t.value >= 3 || (!after1.attackers(t.square, opp).length && t.value >= 1));
  const big = targets.filter(t => t.value >= 3).length + (first.check ? 1 : 0);
  if (big >= 2 && (strong || (first.check && lineGain >= 1))) return { ...out, motif: 'fork', piece: PIECE_WORD[first.mv.piece] };
  const pair = rayPair(after1, first.mv.to, me);
  if (pair && strong) {
    /* the king counts as the piece worth most on the line. Behind it is a
       pin, in front of it a skewer. */
    const worth = t => (t.type === 'k' ? 100 : t.value);
    if (worth(pair.back) > worth(pair.front)) return { ...out, motif: 'pin', piece: PIECE_WORD[pair.front.type] };
    if (worth(pair.front) > worth(pair.back)) return { ...out, motif: 'skewer', piece: PIECE_WORD[pair.back.type] };
  }
  if (first.check && checkers.length === 1 && checkers[0] !== first.mv.to && strong) return { ...out, motif: 'discovered' };
  if (strong && discoveredThrough(after1, first.mv.from, me)) return { ...out, motif: 'discovered' };
  if (gain2 <= -2 && strong) return { ...out, motif: 'deflection' };
  /* a capture later in the line of a piece that had nowhere safe to go */
  for (let k = 2; k < line.length; k += 2) {
    const cap = line[k].mv;
    if (!cap.captured || VALUE[cap.captured] < 3) continue;
    const poised = new Chess(line[k - 2].fen);        // opponent to move, piece still there
    if (poised.get(cap.to) && poised.get(cap.to).color === opp && pieceTrapped(poised, cap.to, me))
      return { ...out, motif: 'trapped', piece: PIECE_WORD[cap.captured] };
  }
  if (first.mv.captured && VALUE[first.mv.captured] >= 3 && strong) {
    const flipped = nullMoveFen(fen);
    if (flipped && pieceTrapped(new Chess(flipped), first.mv.to, me)) return { ...out, motif: 'trapped', piece: PIECE_WORD[first.mv.captured] };
  }
  const lastRank = me === 'w' ? 7 : 0, seventh = me === 'w' ? 6 : 1;
  for (let k = 0; k < line.length; k += 2) {
    const mv = line[k].mv;
    if (mv.piece !== 'p') continue;
    if (mv.promotion || (rankOf(mv.to) === seventh && strong) || rankOf(mv.to) === lastRank) return { ...out, motif: 'promotion' };
  }
  if (lineGain >= 2) return { ...out, motif: 'material' };
  const busy = line.some(p => p.mv.captured || p.check);
  return { ...out, motif: busy ? 'tactic' : 'quiet' };
}

/* ====================== grading ====================== */

export function classifyLoss(before, after, top1) {
  const loss = Math.max(0, before - after);
  let cls;
  if (loss < 45) cls = top1 ? 'best' : 'excellent';
  else if (loss < 100) cls = 'good';
  else if (loss < 200) cls = 'inaccuracy';
  else if (loss < 400) cls = 'mistake';
  else cls = 'blunder';
  if (after >= 600 && (cls === 'mistake' || cls === 'blunder')) cls = 'inaccuracy';
  else if (after >= 250 && cls === 'blunder') cls = 'mistake';
  if (before > MATE - 2000 && after < MATE - 2000 && cls === 'inaccuracy') cls = 'mistake';
  return { cls, loss };
}
export const CLS_LABEL = { best: 'Best', excellent: 'Excellent', good: 'Good', inaccuracy: 'Inaccuracy', mistake: 'Mistake', blunder: 'Blunder', forced: 'Forced' };
export const CLS_MARK = { inaccuracy: '?!', mistake: '?', blunder: '??' };

/* Opening while the book still applies and the pieces are all out, endgame
   once few pieces are left, middlegame between. */
export function phaseOf(fen, ply, openingEnd) {
  let c;
  try { c = new Chess(fen); } catch (e) { return 'middlegame'; }
  const n = pieceCounts(c);
  const heavy = n.minors + n.majors;
  if (heavy <= 6 || (n.queens === 0 && heavy <= 8)) return 'endgame';
  if (ply < (openingEnd || 20) && heavy >= 11) return 'opening';
  return 'middlegame';
}

function endgameKind(fen) {
  let c;
  try { c = new Chess(fen); } catch (e) { return null; }
  const n = pieceCounts(c);
  const types = new Set();
  for (const row of c.board()) for (const p of row) if (p && p.type !== 'k' && p.type !== 'p') types.add(p.type);
  if (!types.size) return 'pawnEndgame';
  if (types.has('q') && types.has('r')) return 'queenRookEndgame';
  if (types.has('q')) return 'queenEndgame';
  if (types.has('r')) return 'rookEndgame';
  if (types.has('b') && !types.has('n')) return 'bishopEndgame';
  if (types.has('n') && !types.has('b')) return 'knightEndgame';
  return n.minors <= 2 ? 'bishopEndgame' : 'rookEndgame';
}

const scoreOf = ev => (ev && Number.isFinite(ev.score) ? ev.score : 0);

/* Grade every ply of a game from the engine records. `evals[i]` describes
   the position before ply i, from the side to move; `evals[plies.length]`
   describes the final position. `threats[i]`, when present, is the engine
   run on the same position with the other side to move. */
export function gradeGame(game, evals, options = {}) {
  const color = options.color || null;
  const threats = options.threats || {};
  const openingEnd = options.openingEnd || 20;
  const moves = [];
  for (const p of game.plies) {
    const e0 = evals[p.i], e1 = evals[p.i + 1];
    if (!e0 || !e1) { moves.push(null); continue; }
    const before = scoreOf(e0);
    const after = -scoreOf(e1);
    let legal = 0;
    try { legal = new Chess(p.before).moves().length; } catch (er) {}
    const top1 = !!e0.best && e0.best === p.uci;
    const g = legal === 1 ? { cls: 'forced', loss: 0 } : classifyLoss(before, after, top1);
    const entry = {
      i: p.i, san: p.san, uci: p.uci, color: p.color, num: p.num,
      fenBefore: p.before, fenAfter: p.after,
      before, after, top1, loss: g.loss, cls: g.cls, legal,
      best: e0.best || null, pvBest: (e0.pv || []).slice(0, LIMITS.pvPlies),
      punish: e1.best || null, pvPunish: (e1.pv || []).slice(0, LIMITS.pvPlies),
      phase: phaseOf(p.before, p.i, openingEnd),
      think: game.clocks ? game.clocks[p.i].think : null,
      left: game.clocks ? game.clocks[p.i].left : null,
      mine: color ? p.color === color : false,
    };
    if (entry.cls === 'inaccuracy' || entry.cls === 'mistake' || entry.cls === 'blunder') {
      entry.error = describeError(entry, threats[p.i] || null);
    }
    moves.push(entry);
  }
  return moves;
}

/* One line on what went wrong. `missed` is what the best move achieved,
   `allowed` what the reply to the played move achieves. */
export function describeError(m, threat) {
  /* what each line is worth beyond the material already on the board, from
     the point of view of the side that plays it */
  const missedGain = Math.min(m.before, 1000) / 100 - materialOf(m.fenBefore);
  const allowedGain = Math.min(-m.after, 1000) / 100 - materialOf(m.fenAfter);
  const missedMate = m.before >= MATE - 1000 && m.after < MATE - 2000 ? MATE - m.before : 0;
  const allowedMate = -m.after >= MATE - 1000 ? MATE + m.after : 0;
  const missed = motifOf(m.fenBefore, m.pvBest, { gain: missedGain, mate: missedMate });
  const allowed = motifOf(m.fenAfter, m.pvPunish, { gain: allowedGain, mate: allowedMate });
  const out = { missed, allowed, threat: null, ignoredThreat: false };
  if (threat && threat.best && m.punish) {
    const same = threat.best === m.punish || (threat.best.slice(2, 4) === m.punish.slice(2, 4) && scoreOf(threat) >= 150);
    out.threat = { best: threat.best, score: scoreOf(threat) };
    out.ignoredThreat = same && scoreOf(threat) >= 100;
  }
  const chosen = categorize(m, out);
  out.category = chosen.category;
  out.direction = chosen.direction;      // 'allowed', 'missed', or 'other'
  return out;
}

/* ====================== the taxonomy ====================== */

export const CATEGORIES = {
  'hanging':      { label: 'Hanging pieces',    themes: ['hangingPiece'],
                    cue: 'A piece of yours attacked more often than it is defended, or one whose defender has just moved away.',
                    work: 'Before every move, list every piece of yours that is attacked and count its defenders. Then do the same for the square you are moving to.',
                    avoid: 'Leaving a piece on a square where it is attacked more times than it is defended, and moving a piece onto such a square.' },
  'fork':         { label: 'Forks',             themes: ['fork'],
                    cue: 'Two of your pieces a single knight hop apart, or two loose pieces on one line.',
                    work: 'Look at every square a knight could jump to next move and every pawn push that touches two pieces. Keep your king and queen off squares a knight’s move apart, and off the same diagonal or file as each other.',
                    avoid: 'Two undefended pieces standing where one enemy move attacks both.' },
  'pin':          { label: 'Pins',              themes: ['pin'],
                    cue: 'One of your pieces standing between an enemy bishop or rook and your king or queen.',
                    work: 'Note every piece standing on a line with your king or queen. A pinned piece does not defend anything, so count defenders again after the pin.',
                    avoid: 'Moving a piece between a bishop or rook and your king, and relying on a pinned piece as a defender.' },
  'skewer':       { label: 'Skewers',           themes: ['skewer'],
                    cue: 'Your king or queen on an open line with something valuable directly behind it.',
                    work: 'When the king or queen stands on an open line, check what is behind it on that line before you move something else.',
                    avoid: 'The king and a rook, or the queen and a rook, on the same open line.' },
  'discovered':   { label: 'Discovered attacks', themes: ['discoveredAttack', 'discoveredCheck'],
                    cue: 'An enemy bishop, rook, or queen aimed at your king or queen with exactly one piece in the way.',
                    work: 'Look for enemy pieces whose line to your king or queen is blocked by one enemy piece only; that piece can move with tempo.',
                    avoid: 'Placing your king or queen on a line masked by a single enemy piece.' },
  'double-check': { label: 'Double checks',     themes: ['doubleCheck'],
                    cue: 'Your king with no flight squares while an enemy piece can step aside with check.',
                    work: 'A double check can only be met by a king move. Count the king’s flight squares whenever a masked check is possible.',
                    avoid: 'A king with no flight squares on a line that an enemy piece can uncover.' },
  'trapped':      { label: 'Trapped pieces',    themes: ['trappedPiece'],
                    cue: 'One of your pieces deep in enemy ground with two retreat squares or fewer.',
                    work: 'Before a piece goes deep into the enemy camp, count how many squares it can come back to and whether one pawn move closes them.',
                    avoid: 'Grabbing a pawn on the rim, and a bishop or knight with only one retreat.' },
  'back-rank':    { label: 'Back-rank mates',   themes: ['backRankMate'],
                    cue: 'Your castled king behind three unmoved pawns with one rook or none left at home.',
                    work: 'Once the queens are on the board and the rooks are out, give the king a breathing square. Ask before every rook trade whether the back rank is still guarded.',
                    avoid: 'All three pawns still in front of a castled king with only one rook left at home.' },
  'mate-missed':  { label: 'Missed mates',      themes: ['mateIn3', 'mateIn4'],
                    cue: 'An enemy king down to two flight squares while you have a check available.',
                    work: 'When the enemy king has few flight squares, look at every check first, even the ones that give up material.',
                    avoid: 'Taking material or retreating when a checking sequence was there.' },
  'mate-allowed': { label: 'King safety',       themes: ['exposedKing', 'kingsideAttack', 'defensiveMove'],
                    cue: 'More enemy pieces aimed at your king than you have defenders near it.',
                    work: 'Count the attackers near your king against the defenders. When the count turns, spend a move on defense, trade a piece, or bring the queen back.',
                    avoid: 'Pushing the pawns in front of your own king, and sending the last defender away to win a pawn.' },
  'deflection':   { label: 'Sacrifices you did not see', themes: ['deflection', 'attraction', 'capturingDefender'],
                    cue: 'One of your pieces doing two jobs at once.',
                    work: 'For every piece that guards something, ask what happens if it is captured or forced away. The sacrifice is often the first move.',
                    avoid: 'One piece holding two duties, such as guarding the back rank and a knight at once.' },
  'promotion':    { label: 'Passed pawns',      themes: ['advancedPawn', 'promotion'],
                    cue: 'A passed pawn on the sixth or seventh rank, yours or theirs.',
                    work: 'Count the squares to promotion for every passed pawn, yours and theirs, and whether the king or a piece can reach the queening square in time.',
                    avoid: 'Ignoring a passed pawn on the sixth rank, and letting a pawn advance with the king far away.' },
  'threat-blind': { label: 'Ignored threats',   themes: ['defensiveMove', 'quietMove'],
                    cue: 'An enemy capture or check that is already available before you move.',
                    work: 'Before choosing your move, ask what the opponent would play if it were their turn now, and make sure your move answers it.',
                    avoid: 'Playing your own plan while an enemy capture or check is already on the board.' },
  'opening-play': { label: 'Opening play',      themes: [],
                    cue: 'A piece still on its starting square after move ten, or a king still in the center.',
                    work: 'Develop every piece before starting an attack, castle early, and learn the first ten moves of the openings you actually play.',
                    avoid: 'Moving the same piece twice in the opening, early queen sorties, and pawn grabs before development.' },
  'endgame-technique': { label: 'Endgame technique', themes: ['pawnEndgame', 'rookEndgame'],
                    cue: 'Queens off with your king still on the back rank, or a rook in front of its own passed pawn.',
                    work: 'Activate the king as soon as the queens are off, put rooks behind passed pawns, and practice the basic king and pawn endings until they are automatic.',
                    avoid: 'A passive king and a rook in front of its own passed pawn.' },
  'positional':   { label: 'Quiet positions',   themes: ['quietMove', 'zugzwang'],
                    cue: 'Nothing hanging and no checks available, which makes your worst placed piece the move.',
                    work: 'When nothing is hanging, improve your worst piece, and ask which pawn break opens the position for your pieces.',
                    avoid: 'Aimless pawn moves and shuffling pieces without a plan.' },
};
export const LOST_ALREADY = -600;   // below this a position is counted as lost
export const LOSS_CAP = 500;         // per-move loss cap for the averages, as on the coach page
export const HABITS = {
  'ignored-threat': { label: 'Ignored threats', work: 'Before choosing your move, ask what the opponent would play if it were their turn now, and make sure your move answers it.', avoid: 'Playing your own plan while an enemy capture or check is already on the board.' },
  'conversion':   { label: 'Converting advantages', work: 'When ahead, trade pieces rather than pawns, keep every piece defended, and give the king air. The plan is simplify and promote, not attack.', avoid: 'Starting a new attack while ahead, and pawn grabs that open lines toward your own king.' },
  'punishing':    { label: 'Punishing mistakes', work: 'After every opponent move, check what it left undefended or unblocked. A mistake is only a gift if you take it.', avoid: 'Playing the move you had planned without looking at what just changed.' },
  'when-winning': { label: 'Errors when winning', work: 'With a won position, trade pieces, keep everything defended, and look for the opponent’s last tricks. Simplify rather than attack.', avoid: 'Rushing to finish, and starting a new attack while ahead.' },
  'when-losing':  { label: 'Errors when losing',  work: 'When behind, look for the most stubborn defense and for counterplay that gives the opponent problems, rather than resigning yourself to more losses.', avoid: 'Desperate sacrifices and giving up more material after the first mistake.' },
  'time-pressure': { label: 'Errors in time trouble', work: 'Spend time on the critical moments early, and keep a simple rule for the last minutes, such as checks first and no new pawn moves.', avoid: 'Long thinks on quiet moves that leave nothing for the tactics later.' },
};

function categorize(m, d) {
  const a = d.allowed.motif, s = d.missed.motif;
  const lostAnyway = m.before <= LOST_ALREADY;
  /* a mate far over the horizon is not what a club player missed or walked
     into; those errors are judged by what else the lines show */
  const aMate = (a === 'mate' || a === 'back-rank' || a === 'smothered') && d.allowed.mateIn <= 10;
  const sMate = (s === 'mate' || s === 'back-rank' || s === 'smothered') && d.missed.mateIn <= 8;
  if (!lostAnyway && aMate) return { category: a === 'back-rank' ? 'back-rank' : 'mate-allowed', direction: 'allowed' };
  if (sMate) return { category: s === 'back-rank' ? 'back-rank' : 'mate-missed', direction: 'missed' };
  const map = { hanging: 'hanging', fork: 'fork', pin: 'pin', skewer: 'skewer', discovered: 'discovered', 'double-check': 'double-check', trapped: 'trapped', deflection: 'deflection', promotion: 'promotion' };
  if (map[a]) return { category: map[a], direction: 'allowed' };
  if (d.ignoredThreat) return { category: 'threat-blind', direction: 'other' };
  if (map[s]) return { category: map[s], direction: 'missed' };
  if (a === 'material') return { category: 'hanging', direction: 'allowed' };
  if (m.phase === 'opening') return { category: 'opening-play', direction: 'other' };
  if (m.phase === 'endgame') return { category: 'endgame-technique', direction: 'other' };
  return { category: 'positional', direction: 'other' };
}

/* ====================== the profile ====================== */

const OPENING_FAMILY = name => String(name || '').split(':')[0].trim();
export const familySlug = name => OPENING_FAMILY(name).replace(/['’]/g, '').replace(/\s+/g, '_');

/* `reviews` holds one entry per game, shaped { game, color, moves (from
   gradeGame), opening ({ eco, name, ply } or null) }. `rating` is the number
   the player gave, if any. */
export function buildProfile(reviews, identity, options = {}) {
  const rows = reviews.filter(r => r && r.color && Array.isArray(r.moves));
  const games = rows.length;
  const results = { win: 0, draw: 0, loss: 0, unknown: 0 };
  const phases = { opening: phaseAcc(), middlegame: phaseAcc(), endgame: phaseAcc() };
  const cats = {};
  const habits = { 'when-winning': habitAcc(), 'when-losing': habitAcc(), 'time-pressure': habitAcc(), 'ignored-threat': habitAcc() };
  const openings = new Map();
  const endings = {};
  let lossSum = 0, lossN = 0, ratingSum = 0, ratingN = 0;
  let punishable = 0, punished = 0, tacticsSeen = 0, tacticsFound = 0;
  let wonPositions = 0, converted = 0, lostPositions = 0, saved = 0;
  let clockGames = 0, clockErrors = 0, clockMoves = 0;
  const perGame = [];
  const oppMistakes = [];

  rows.forEach((r, gi) => {
    const { game, color, moves } = r;
    const res = resultFor(game, color);
    results[res || 'unknown']++;
    const myRating = color === 'w' ? game.welo : game.belo;
    if (myRating) { ratingSum += myRating; ratingN++; }
    const mine = moves.filter(m => m && m.mine && m.cls !== 'forced');
    let gLoss = 0, gN = 0, worst = null, maxEval = -Infinity, minEval = Infinity;
    const errors = [];
    if (game.clocks) clockGames++;
    for (const m of mine) {
      const l = Math.min(m.loss, LOSS_CAP);
      gLoss += l; gN++; lossSum += l; lossN++;
      const ph = phases[m.phase];
      ph.n++; ph.loss += l;
      if (m.cls === 'inaccuracy' || m.cls === 'mistake' || m.cls === 'blunder') {
        ph.errors++;
        if (m.phase === 'endgame') { const k = endgameKind(m.fenBefore); if (k) endings[k] = (endings[k] || 0) + 1; }
      }
      maxEval = Math.max(maxEval, m.before); minEval = Math.min(minEval, m.before);
      if (!worst || m.loss > worst.loss) worst = m;
      const ev = m.before;
      if (m.error && (m.cls === 'mistake' || m.cls === 'blunder')) {
        /* an error in a position that was already lost (down a rook or
           worse) goes to the "when losing" habit and not to a category,
           because it did not decide the game and would drown the ones that did */
        if (ev > LOST_ALREADY) {
          const id = m.error.category;
          const c = cats[id] || (cats[id] = { id, count: 0, missed: 0, allowed: 0, cost: 0, games: new Set(), evidence: [] });
          c.count++; c.cost += Math.min(m.loss, 600);
          c.games.add(gi);
          if (m.error.direction === 'allowed') c.allowed++; else if (m.error.direction === 'missed') c.missed++;
          c.evidence.push(evidenceOf(gi, game, color, m));
        }
        errors.push(m);
        if (m.error.ignoredThreat) { habits['ignored-threat'].count++; habits['ignored-threat'].cost += Math.min(m.loss, 600); }
        if (ev >= 200) { habits['when-winning'].count++; habits['when-winning'].cost += Math.min(m.loss, 600); }
        if (ev <= -200) { habits['when-losing'].count++; habits['when-losing'].cost += Math.min(m.loss, 600); }
        if (m.think !== null && m.phase !== 'opening' && (m.think < 8 || (m.left !== null && m.left < 60))) {
          habits['time-pressure'].count++; habits['time-pressure'].cost += Math.min(m.loss, 600); clockErrors++;
        }
      }
      if (m.think !== null && m.phase !== 'opening') clockMoves++;
      /* a tactic was on the board; did the player find it? */
      if (m.before > -800 && m.pvBest.length) {
        const best = motifOf(m.fenBefore, m.pvBest, { mate: m.before >= MATE - 1000 ? MATE - m.before : 0 });
        if (TACTICAL.has(best.motif) && (best.gain >= 2 || best.mateIn)) {
          tacticsSeen++;
          if (m.top1 || m.loss < 30) tacticsFound++;
        }
      }
    }
    /* the opponent's mistakes, and whether the reply cashed them in */
    for (let i = 0; i < moves.length - 1; i++) {
      const o = moves[i], reply = moves[i + 1];
      if (!o || o.mine || !reply || !reply.mine) continue;
      if (o.cls === 'mistake' || o.cls === 'blunder') {
        punishable++;
        if (reply.loss < 50) punished++;
        oppMistakes.push({ game: gi, ply: o.i });
      }
    }
    if (maxEval >= 200) { wonPositions++; if (res === 'win') converted++; }
    if (minEval <= -200) { lostPositions++; if (res && res !== 'loss') saved++; }
    const opening = r.opening || null;
    const fam = opening ? OPENING_FAMILY(opening.name) : (game.eco ? 'ECO ' + game.eco : 'Unknown opening');
    const key = fam + '|' + color;
    const o = openings.get(key) || { family: fam, slug: familySlug(fam), color, games: 0, score: 0, loss: 0, n: 0, errors: 0, firstErrors: [] };
    o.games++; o.score += res === 'win' ? 1 : res === 'draw' ? 0.5 : 0;
    for (const m of mine.filter(x => x.phase === 'opening')) { o.loss += Math.min(m.loss, LOSS_CAP); o.n++; }
    const firstErr = mine.find(x => x.phase === 'opening' && (x.cls === 'mistake' || x.cls === 'blunder'));
    if (firstErr) { o.errors++; o.firstErrors.push({ game: gi, num: firstErr.num, san: firstErr.san, best: sanOf(firstErr.fenBefore, firstErr.best), loss: firstErr.loss }); }
    openings.set(key, o);
    perGame.push({
      index: gi, id: game.id, white: game.white, black: game.black, result: game.result, color, res, date: game.date,
      acpl: gN ? Math.round(gLoss / gN) : null, errors: errors.length,
      blunders: errors.filter(m => m.cls === 'blunder').length,
      worst: worst ? { num: worst.num, san: worst.san, loss: worst.loss, color: worst.color } : null,
      opening: opening ? opening.name : fam, link: game.link, site: game.site, plies: game.plies.length,
    });
  });

  const acpl = lossN ? lossSum / lossN : null;
  const given = Number.isFinite(options.rating) ? options.rating : null;
  const fromTags = ratingN ? Math.round(ratingSum / ratingN) : null;
  const estimated = acpl !== null ? eloFromAcpl(acpl) : null;
  const rating = given || fromTags || estimated || 1500;
  const expected = acplForElo(rating);

  const categories = Object.values(cats).map(c => ({
    id: c.id, label: CATEGORIES[c.id].label, count: c.count, missed: c.missed, allowed: c.allowed,
    cost: c.cost, games: c.games.size, perGame: c.count / Math.max(1, games), avgCost: c.cost / c.count,
    evidence: c.evidence.sort((a, b) => b.loss - a.loss).slice(0, LIMITS.maxEvidence),
    themes: c.id === 'endgame-technique' ? endgameThemes(endings) : CATEGORIES[c.id].themes,
    work: CATEGORIES[c.id].work, avoid: CATEGORIES[c.id].avoid,
  }));
  const minCount = games >= 15 ? 3 : 2;
  const weaknesses = categories.filter(c => c.count >= minCount)
    .sort((a, b) => (b.cost / games) - (a.cost / games) || b.count - a.count);
  const totalErrors = rows.reduce((s, r) => s + r.moves.filter(m => m && m.mine && (m.cls === 'mistake' || m.cls === 'blunder')).length, 0);
  const habitList = Object.entries(habits).map(([id, h]) => ({
    id, label: HABITS[id].label, count: h.count, cost: h.cost, share: totalErrors ? h.count / totalErrors : 0,
    detail: `${h.count} of your ${totalErrors} mistakes and blunders (${Math.round(100 * h.count / Math.max(1, totalErrors))}%).`,
    work: HABITS[id].work, avoid: HABITS[id].avoid,
  })).filter(h => h.count >= minCount && h.share >= 0.3);
  if (wonPositions >= 4 && converted / wonPositions < 0.5)
    habitList.push({ id: 'conversion', label: HABITS.conversion.label, count: wonPositions - converted, cost: 0, share: 0,
      detail: `Only ${converted} of the ${wonPositions} games with a clear advantage (two pawns or more) were won.`, work: HABITS.conversion.work, avoid: HABITS.conversion.avoid });
  if (punishable >= 8 && punished / punishable < 0.4)
    habitList.push({ id: 'punishing', label: HABITS.punishing.label, count: punishable - punished, cost: 0, share: 0,
      detail: `The opponent made ${punishable} mistakes and blunders; the reply cashed in ${punished} of them (${Math.round(100 * punished / punishable)}%).`, work: HABITS.punishing.work, avoid: HABITS.punishing.avoid });

  const phaseRows = Object.entries(phases).map(([id, p]) => ({
    id, n: p.n, acpl: p.n ? Math.round(p.loss / p.n) : null, expected, errors: p.errors,
    errorsPerGame: games ? p.errors / games : 0,
  }));

  const openingRows = [...openings.values()].map(o => ({
    ...o, scorePct: Math.round(100 * o.score / o.games), acpl: o.n ? Math.round(o.loss / o.n) : null,
    firstErrors: o.firstErrors.slice(0, 6),
  })).sort((a, b) => b.games - a.games);

  const strengths = findStrengths({
    games, acpl, expected, phaseRows, punishable, punished, tacticsSeen, tacticsFound,
    wonPositions, converted, lostPositions, saved, openingRows, clockGames, clockErrors, clockMoves, categories, results,
  });

  return {
    v: 1, generated: new Date().toISOString().slice(0, 10),
    player: { name: identity.display, aliases: identity.aliases.slice() },
    games, results, rating: { given, fromTags, estimated, used: rating }, acpl: acpl === null ? null : Math.round(acpl), expected,
    phases: phaseRows, categories, weaknesses, habits: habitList, strengths, openings: openingRows,
    skills: {
      punish: { n: punishable, hit: punished }, tactics: { n: tacticsSeen, hit: tacticsFound },
      convert: { n: wonPositions, hit: converted }, resist: { n: lostPositions, hit: saved },
      clock: { games: clockGames, errors: clockErrors, moves: clockMoves },
    },
    endings, perGame,
  };
}
const phaseAcc = () => ({ n: 0, loss: 0, errors: 0 });
const habitAcc = () => ({ count: 0, cost: 0 });

function endgameThemes(endings) {
  const list = Object.entries(endings).sort((a, b) => b[1] - a[1]).map(e => e[0]);
  return list.length ? list.slice(0, 2) : ['pawnEndgame', 'rookEndgame'];
}

export function sanOf(fen, uci) {
  if (!uci) return '';
  try { const c = new Chess(fen); const mv = safeMove(c, uci); return mv ? mv.san : uci; } catch (e) { return uci; }
}
export function lineSan(fen, ucis) {
  const out = [];
  try {
    const c = new Chess(fen);
    for (const u of ucis || []) { const mv = safeMove(c, u); if (!mv) break; out.push(mv.san); }
  } catch (e) {}
  return out;
}

function evidenceOf(gi, game, color, m) {
  const punishSan = lineSan(m.fenAfter, m.pvPunish).slice(0, 4);
  const bestSan = lineSan(m.fenBefore, m.pvBest).slice(0, 5);
  return {
    game: gi, id: game.id, ply: m.i, num: m.num, color: m.color, san: m.san, loss: m.loss, cls: m.cls,
    before: m.before, after: m.after, fen: m.fenBefore, fenAfter: m.fenAfter,
    best: m.best, bestSan, punish: m.punish, punishSan, pvBest: m.pvBest, phase: m.phase,
    missed: m.error.missed.motif, allowed: m.error.allowed.motif, ignoredThreat: m.error.ignoredThreat,
    note: errorNote(m),
  };
}

/* One sentence on an error, in plain words. */
export function errorNote(m) {
  const d = m.error;
  const gotMated = m.after <= -(MATE - 1000), hadMate = m.before >= MATE - 1000;
  const cost = gotMated ? `and gets mated in ${MATE + m.after}` : hadMate ? 'and lets a forced mate go' : `costing ${(Math.min(m.loss, 1000) / 100).toFixed(1)} pawns`;
  const bestSan = sanOf(m.fenBefore, m.best);
  const allowed = d.allowed, missed = d.missed;
  if (allowed.motif === 'mate' || allowed.motif === 'back-rank' || allowed.motif === 'smothered')
    return `${m.san} walks into ${MOTIFS[allowed.motif].label} in ${allowed.mateIn}.${bestSan ? ` ${bestSan} holds.` : ''}`;
  if (missed.motif === 'mate' || missed.motif === 'back-rank' || missed.motif === 'smothered')
    return `${bestSan} was ${MOTIFS[missed.motif].label} in ${missed.mateIn}; ${m.san} lets it go.`;
  if (TACTICAL.has(allowed.motif)) {
    const what = allowed.piece && allowed.motif === 'hanging' ? `a hanging ${allowed.piece}` : MOTIFS[allowed.motif].label;
    return `${m.san} allows ${what} after ${sanOf(m.fenAfter, m.punish)}, ${cost}.${d.ignoredThreat ? ' The threat was already on the board.' : ''}${bestSan ? ` ${bestSan} was the move.` : ''}`;
  }
  if (TACTICAL.has(missed.motif)) {
    const what = missed.piece && missed.motif === 'hanging' ? `a hanging ${missed.piece}` : MOTIFS[missed.motif].label;
    return `${bestSan} wins ${what}; ${m.san} misses it, ${cost}.`;
  }
  if (d.ignoredThreat) return `${m.san} ignores the threat of ${sanOf(m.fenAfter, m.punish)}, ${cost}.${bestSan ? ` ${bestSan} answers it.` : ''}`;
  return `${m.san} ${cost}.${bestSan ? ` ${bestSan} was better.` : ''}`;
}

function findStrengths(s) {
  const out = [];
  const pct = (a, b) => Math.round(100 * a / b);
  /* a phase is a strength when it is clearly better than the player's own
     average, which needs no scale from outside */
  if (s.acpl !== null && s.games >= 5) {
    for (const p of s.phaseRows) {
      if (p.n >= 40 && p.acpl !== null && p.acpl <= s.acpl * 0.6 && p.errorsPerGame <= 0.6)
        out.push({ id: 'phase-' + p.id, label: `Solid ${p.id}`, detail: `${p.acpl} centipawns per move in the ${p.id} against ${Math.round(s.acpl)} over the whole game, with ${p.errorsPerGame.toFixed(1)} mistakes or blunders per game there.` });
    }
  }
  if (s.punishable >= 5 && s.punished / s.punishable >= 0.6)
    out.push({ id: 'punisher', label: 'Punishes mistakes', detail: `Cashed in ${s.punished} of ${s.punishable} opponent mistakes (${pct(s.punished, s.punishable)}%).` });
  if (s.tacticsSeen >= 5 && s.tacticsFound / s.tacticsSeen >= 0.6)
    out.push({ id: 'tactician', label: 'Finds tactics', detail: `Found ${s.tacticsFound} of ${s.tacticsSeen} tactical shots that were on the board (${pct(s.tacticsFound, s.tacticsSeen)}%).` });
  if (s.wonPositions >= 4 && s.converted / s.wonPositions >= 0.75)
    out.push({ id: 'converter', label: 'Converts advantages', detail: `Won ${s.converted} of the ${s.wonPositions} games where a clear advantage was reached.` });
  if (s.lostPositions >= 4 && s.saved / s.lostPositions >= 0.3)
    out.push({ id: 'fighter', label: 'Fights back', detail: `Saved ${s.saved} of the ${s.lostPositions} games where the position was clearly worse.` });
  for (const o of s.openingRows) {
    if (o.games >= 3 && o.scorePct >= 65)
      out.push({ id: 'opening-' + o.slug + '-' + o.color, label: `${o.family} as ${o.color === 'w' ? 'White' : 'Black'}`, detail: `${o.scorePct}% over ${o.games} games${o.acpl !== null ? `, ${o.acpl} centipawns per opening move` : ''}.` });
  }
  if (s.clockGames >= 5 && s.clockMoves >= 100 && s.clockErrors === 0)
    out.push({ id: 'clock', label: 'Clock handling', detail: `No mistakes made under time pressure in ${s.clockGames} timed games.` });
  const common = ['hanging', 'fork', 'back-rank', 'mate-allowed'];
  const clean = common.filter(id => !s.categories.some(c => c.id === id && c.count >= 2));
  if (s.games >= 8 && clean.length)
    out.push({ id: 'clean', label: 'Rarely caught by', detail: clean.map(id => CATEGORIES[id].label.toLowerCase()).join(', ') + '.' });
  return out;
}

/* ====================== drills ====================== */

/* Pawn structure and king placement, compared from the side to move, so a
   position with White to move and its mirror image with Black to move score
   the same. Returns 0 to 1. */
export function similarity(fenA, fenB) {
  const a = signature(fenA), b = signature(fenB);
  if (!a || !b) return 0;
  const j = (x, y) => { const u = new Set([...x, ...y]); if (!u.size) return 1; let i = 0; for (const s of x) if (y.has(s)) i++; return i / u.size; };
  const pawns = 0.5 * j(a.myPawns, b.myPawns) + 0.5 * j(a.theirPawns, b.theirPawns);
  const kings = (a.myKing === b.myKing ? 0.5 : 0) + (a.theirKing === b.theirKing ? 0.5 : 0);
  const mat = 1 - Math.min(1, Math.abs(a.heavy - b.heavy) / 8);
  return 0.55 * pawns + 0.2 * kings + 0.25 * mat;
}
function signature(fen) {
  let c;
  try { c = new Chess(fen); } catch (e) { return null; }
  const me = c.turn();
  const norm = (sq, color) => (me === 'w' ? sq : sq[0] + (9 - +sq[1]));
  const myPawns = new Set(), theirPawns = new Set();
  let myKing = '', theirKing = '', heavy = 0;
  for (const row of c.board()) for (const p of row) {
    if (!p) continue;
    if (p.type === 'p') (p.color === me ? myPawns : theirPawns).add(norm(p.square));
    else if (p.type === 'k') { const zone = fileOf(p.square) <= 2 ? 'q' : fileOf(p.square) >= 5 ? 'k' : 'c'; if (p.color === me) myKing = zone; else theirKing = zone; }
    else heavy++;
  }
  return { myPawns, theirPawns, myKing, theirKing, heavy };
}

/* Deterministic pseudo-random in [0, 1) from a string, for jitter that is
   the same for the same day. */
function jitter(s) { return (parseInt(hashOf(s), 16) % 10000) / 10000; }

export function puzzleRecord(row) {
  if (!Array.isArray(row) || row.length < 5) return null;
  const [id, fen, moves, rating, themes, family] = row;
  if (typeof id !== 'string' || !/^[A-Za-z0-9]{5}$/.test(id) || typeof fen !== 'string' || fen.length > 100 || typeof moves !== 'string') return null;
  if (!Number.isFinite(rating) || rating < 100 || rating > 3500) return null;
  if (typeof themes !== 'string' || themes.length > 300) return null;
  const ucis = moves.split(' ');
  if (ucis.length < 2 || ucis.length > 40 || ucis.some(u => !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(u))) return null;
  let c;
  try { c = new Chess(fen); } catch (e) { return null; }
  const setup = safeMove(c, ucis[0]);
  if (!setup) return null;
  const start = c.fen(), color = c.turn();
  /* every move of the solution has to be legal in turn, or the drill would
     stall on it */
  const scratch = new Chess(start);
  for (const u of ucis.slice(1)) if (!safeMove(scratch, u)) return null;
  return {
    id: String(id), fen, start, setup: ucis[0], setupSan: setup.san, solution: ucis.slice(1),
    rating, themes: themes.split(' ').filter(Boolean), family: typeof family === 'string' && /^[A-Za-z0-9_\-]{0,60}$/.test(family) ? family : '',
    color,
  };
}

/* Pick the positions to practice. `pools` maps a theme to its puzzle rows,
   `openingPools` a family slug to rows. `progress` maps a drill id to
   { due, best }. */
export function selectDrills(profile, pools, openingPools, progress = {}, options = {}) {
  const now = options.now || Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const rating = profile.rating.used;
  const perOwn = options.ownPerCategory || 2, perTheme = options.perTheme || 3, ownMax = options.ownMax || 8;
  const drills = [];
  const seen = new Set();
  const isDue = id => !progress[id] || !progress[id].due || progress[id].due <= now;
  const top = profile.weaknesses.slice(0, 5);
  /* the player's own critical moments first */
  let ownCount = 0;
  for (const w of top) {
    let n = 0;
    for (const e of w.evidence) {
      if (ownCount >= ownMax || n >= perOwn) break;
      if (e.loss < 150 || e.before < -300 || !e.pvBest || !e.pvBest.length) continue;
      const id = 'own:' + e.id + ':' + e.ply;
      if (seen.has(id) || !isDue(id)) continue;
      seen.add(id);
      drills.push({ id, kind: 'own', category: w.id, label: w.label, fen: e.fen, color: e.color, line: e.pvBest.slice(0, 8), rating: null, note: e.note, played: e.san, num: e.num, game: e.game,
        motif: TACTICAL.has(e.allowed) ? e.allowed : (TACTICAL.has(e.missed) ? e.missed : ''), cost: e.loss });
      n++; ownCount++;
    }
  }
  /* then puzzles that look like those moments */
  for (const w of top) {
    const cands = [];
    const offered = new Set();      // one puzzle can sit in two theme files
    for (const theme of w.themes) {
      for (const row of pools[theme] || []) {
        const p = puzzleRecord(row);
        if (!p) continue;
        const id = 'puzzle:' + p.id;
        if (seen.has(id) || offered.has(id) || !isDue(id)) continue;
        offered.add(id);
        const band = Math.abs(p.rating - rating);
        if (band > 350) continue;
        let sim = 0;
        for (const e of w.evidence.slice(0, 6)) sim = Math.max(sim, similarity(e.fen, p.start));
        const colorBonus = w.evidence.some(e => e.color === p.color) ? 0.1 : 0;
        const score = sim + colorBonus - band / 2000 + 0.15 * jitter(day + p.id);
        cands.push({ p, score, theme });
      }
    }
    cands.sort((a, b) => b.score - a.score);
    for (const c of cands.slice(0, perTheme)) {
      const id = 'puzzle:' + c.p.id;
      seen.add(id);
      drills.push({ id, kind: 'puzzle', category: w.id, label: w.label, theme: c.theme, fen: c.p.start, setup: c.p.setup, setupSan: c.p.setupSan, color: c.p.color, line: c.p.solution, rating: c.p.rating, lichess: c.p.id });
    }
  }
  /* and the opening the player scores worst in, when the pool knows it */
  const worst = profile.openings.filter(o => o.games >= 2 && openingPools[o.slug]).sort((a, b) => a.scorePct - b.scorePct || b.games - a.games)[0];
  if (worst) {
    const cands = [];
    for (const row of openingPools[worst.slug]) {
      const p = puzzleRecord(row);
      if (!p || p.color !== worst.color) continue;
      const id = 'puzzle:' + p.id;
      if (seen.has(id) || !isDue(id)) continue;
      cands.push({ p, score: -Math.abs(p.rating - rating) / 1000 + 0.2 * jitter(day + p.id) });
    }
    cands.sort((a, b) => b.score - a.score);
    for (const c of cands.slice(0, 3)) {
      seen.add('puzzle:' + c.p.id);
      drills.push({ id: 'puzzle:' + c.p.id, kind: 'puzzle', category: 'opening', label: worst.family + ' as ' + (worst.color === 'w' ? 'White' : 'Black'), theme: 'opening', fen: c.p.start, setup: c.p.setup, setupSan: c.p.setupSan, color: c.p.color, line: c.p.solution, rating: c.p.rating, lichess: c.p.id, family: worst.family });
    }
  }
  /* Block, then interleave. The first few positions all come from the worst
     weakness, which is how a pattern is learned, and the rest are mixed so
     recognizing it is the exercise rather than remembering the order. */
  const byCat = new Map();
  for (const d of drills) { if (!byCat.has(d.category)) byCat.set(d.category, []); byCat.get(d.category).push(d); }
  const out = [];
  const firstCat = profile.weaknesses.length ? profile.weaknesses[0].id : null;
  const block = byCat.get(firstCat);
  if (block) for (let i = 0; i < (options.blockSize || 3) && block.length; i++) out.push(block.shift());
  while (out.length < drills.length) for (const list of byCat.values()) if (list.length) out.push(list.shift());
  return out;
}

/* The next review date for a drill from its score, on the same ladder the
   coach page uses for its blunder deck. */
export const REVIEW_DAYS = [1, 3, 7, 16, 35, 70];
export function scheduleDrill(record, score, now = Date.now()) {
  const r = record || { attempts: 0, best: 0, step: 0 };
  const passed = score >= 70;
  const step = passed ? Math.min(REVIEW_DAYS.length - 1, (r.step || 0) + 1) : 0;
  return { attempts: (r.attempts || 0) + 1, best: Math.max(r.best || 0, score), last: score, step, due: now + REVIEW_DAYS[step] * 86400000, at: now };
}

/* Score one drill attempt from 0 to 100. Solution moves are worth 60 points,
   split evenly, and the continuation against the engine 40, from the
   average loss over its moves. A drill with no solution phase, which is
   what a moment from the player's own game is, scores on the continuation
   alone. */
export function scoreDrill(solution, continuation, { terminal = false } = {}) {
  const sol = solution || [];
  const cont = continuation || [];
  /* a solution that ends the game (checkmate) has no continuation to play,
     so the solution is the whole score; otherwise an unplayed continuation
     earns nothing */
  const solWeight = !sol.length ? 0 : terminal ? 100 : 60, contWeight = 100 - solWeight;
  const solScore = sol.length ? solWeight * sol.filter(Boolean).length / sol.length : 0;
  let contScore = cont.length ? contWeight : 0;
  if (cont.length) {
    /* losses under 25 centipawns are engine noise, not the player's */
    const avg = cont.reduce((s, l) => s + Math.min(500, Math.max(0, l - 25)), 0) / cont.length;
    contScore = contWeight * clamp(1 - avg / 200, 0, 1);
  }
  return Math.round(solScore + contScore);
}

/* ====================== sharing a review ====================== */

export const PACK_LIMITS = {
  maxChars: 200000,       // the database rule's ceiling for one pack
  maxWeaknesses: 8,
  maxEvidence: 6,
  maxDrills: 40,
  maxTitle: 80,
  idLength: 22,
};
export const PACK_ID = /^[A-Za-z0-9_-]{22}$/;

const cut = (value, n) => (typeof value === 'string' ? value.slice(0, n) : '');
const isFen = value => {
  if (typeof value !== 'string' || value.length > 100) return false;
  try { new Chess(value); return true; } catch (e) { return false; }
};
const uciList = (value, n) => (Array.isArray(value)
  ? value.filter(u => typeof u === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(u)).slice(0, n)
  : []);

/* Everything a learner needs to practice someone else's review, and nothing
   else. No PGN, no engine records, no opponent names, no account details. */
export function buildPack(profile, drills) {
  return {
    v: 1,
    player: cut(profile.player.name, LIMITS.maxNameChars),
    generated: profile.generated,
    games: profile.games,
    results: { win: profile.results.win, draw: profile.results.draw, loss: profile.results.loss },
    rating: profile.rating.used,
    acpl: profile.acpl,
    expected: profile.expected,
    phases: profile.phases.map(p => [p.id, p.n, p.acpl, Math.round(p.errorsPerGame * 100) / 100]),
    strengths: profile.strengths.map(x => [cut(x.label, 80), cut(x.detail, 240)]),
    habits: profile.habits.map(x => [x.id, cut(x.label, 80), cut(x.detail, 240)]),
    openings: profile.openings.slice(0, 12).map(o => [cut(o.family, 60), o.color, o.games, o.scorePct, o.acpl]),
    weaknesses: profile.weaknesses.slice(0, PACK_LIMITS.maxWeaknesses).map(w => ({
      id: w.id, count: w.count, games: w.games, cost: Math.round(w.cost), missed: w.missed, allowed: w.allowed,
      themes: w.themes.slice(0, 4),
      evidence: w.evidence.slice(0, PACK_LIMITS.maxEvidence).map(e => ({
        game: e.game, num: e.num, color: e.color, san: e.san, loss: e.loss, cls: e.cls,
        fen: e.fen, fenAfter: e.fenAfter, best: e.best || '', punish: e.punish || '',
        pvBest: (e.pvBest || []).slice(0, 8), pvPunish: (e.pvPunish || []).slice(0, 6),
        note: cut(e.note, 240), phase: e.phase, missed: e.missed, allowed: e.allowed,
      })),
    })),
    drills: (drills || []).slice(0, PACK_LIMITS.maxDrills).map(d => ({
      id: d.id, kind: d.kind, category: d.category, theme: d.theme || '', label: cut(d.label, 80),
      fen: d.fen, color: d.color, line: (d.line || []).slice(0, 10),
      setup: d.setup || '', setupSan: d.setupSan || '', rating: d.rating || null,
      note: cut(d.note || '', 240), played: d.played || '', num: d.num || 0, game: d.game || 0,
      motif: d.motif || '', family: cut(d.family || '', 60),
    })),
  };
}

/* The same pack coming back from the database, where every field is
   untrusted. Anything that fails its check is dropped rather than repaired,
   and a pack with no drills and no weaknesses is refused outright. */
export function validPack(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.v !== 1) return null;
  const num = (x, lo, hi) => (Number.isFinite(x) && x >= lo && x <= hi ? x : null);
  const int = (x, lo, hi) => { const n = num(x, lo, hi); return n === null ? null : Math.round(n); };
  const pair = (x, a, b) => (Array.isArray(x) && x.length >= 2 ? [cut(x[0], a), cut(x[1], b)] : null);
  if (typeof raw.generated !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.generated)) return null;
  const out = {
    v: 1,
    player: normalizeName(raw.player) || 'A player',
    generated: raw.generated,
    games: int(raw.games, 1, LIMITS.maxGames) || 1,
    results: { win: int(raw.results && raw.results.win, 0, LIMITS.maxGames) || 0,
               draw: int(raw.results && raw.results.draw, 0, LIMITS.maxGames) || 0,
               loss: int(raw.results && raw.results.loss, 0, LIMITS.maxGames) || 0 },
    rating: int(raw.rating, 100, 3500) || 1500,
    acpl: int(raw.acpl, 0, 2000),
    expected: int(raw.expected, 0, 2000) || 0,
    phases: [], strengths: [], habits: [], openings: [], weaknesses: [], drills: [],
  };
  if (Array.isArray(raw.phases)) for (const p of raw.phases.slice(0, 3)) {
    if (!Array.isArray(p) || !['opening', 'middlegame', 'endgame'].includes(p[0])) continue;
    out.phases.push([p[0], int(p[1], 0, 100000) || 0, int(p[2], 0, 2000), num(p[3], 0, 100) || 0]);
  }
  if (Array.isArray(raw.strengths)) for (const x of raw.strengths.slice(0, 12)) { const v = pair(x, 80, 240); if (v) out.strengths.push(v); }
  if (Array.isArray(raw.habits)) for (const x of raw.habits.slice(0, 8)) {
    if (!Array.isArray(x) || !Object.hasOwn(HABITS, x[0])) continue;
    out.habits.push([x[0], cut(x[1], 80), cut(x[2], 240)]);
  }
  if (Array.isArray(raw.openings)) for (const o of raw.openings.slice(0, 12)) {
    if (!Array.isArray(o) || (o[1] !== 'w' && o[1] !== 'b')) continue;
    out.openings.push([cut(o[0], 60), o[1], int(o[2], 0, LIMITS.maxGames) || 0, int(o[3], 0, 100) || 0, int(o[4], 0, 2000)]);
  }
  if (Array.isArray(raw.weaknesses)) for (const w of raw.weaknesses.slice(0, PACK_LIMITS.maxWeaknesses)) {
    if (!w || typeof w !== 'object' || !Object.hasOwn(CATEGORIES, w.id)) continue;
    const evidence = [];
    if (Array.isArray(w.evidence)) for (const e of w.evidence.slice(0, PACK_LIMITS.maxEvidence)) {
      if (!e || typeof e !== 'object' || !isFen(e.fen)) continue;
      evidence.push({
        game: int(e.game, 0, LIMITS.maxGames) || 0, num: int(e.num, 1, 500) || 1,
        color: e.color === 'b' ? 'b' : 'w', san: cut(e.san, 12), loss: int(e.loss, 0, MATE) || 0,
        cls: Object.hasOwn(CLS_LABEL, e.cls) ? e.cls : 'mistake',
        fen: e.fen, fenAfter: isFen(e.fenAfter) ? e.fenAfter : '',
        best: uciList([e.best], 1)[0] || '', punish: uciList([e.punish], 1)[0] || '',
        pvBest: uciList(e.pvBest, 8), pvPunish: uciList(e.pvPunish, 6),
        note: cut(e.note, 240), phase: ['opening', 'middlegame', 'endgame'].includes(e.phase) ? e.phase : 'middlegame',
        missed: cut(e.missed, 20), allowed: cut(e.allowed, 20),
      });
    }
    const cat = CATEGORIES[w.id];
    out.weaknesses.push({
      id: w.id, label: cat.label, work: cat.work, avoid: cat.avoid, cue: cat.cue,
      count: int(w.count, 0, 100000) || 0, games: int(w.games, 0, LIMITS.maxGames) || 0,
      cost: int(w.cost, 0, 1e9) || 0, missed: int(w.missed, 0, 100000) || 0, allowed: int(w.allowed, 0, 100000) || 0,
      themes: Array.isArray(w.themes) ? w.themes.filter(t => typeof t === 'string' && /^[A-Za-z0-9]{1,40}$/.test(t)).slice(0, 4) : cat.themes,
      avgCost: 0, evidence,
    });
  }
  for (const w of out.weaknesses) w.avgCost = w.count ? w.cost / w.count : 0;
  const seen = new Set();
  if (Array.isArray(raw.drills)) for (const d of raw.drills.slice(0, PACK_LIMITS.maxDrills)) {
    if (!d || typeof d !== 'object') continue;
    if (typeof d.id !== 'string' || !/^(own:[0-9a-f]{16}:\d{1,3}|puzzle:[A-Za-z0-9]{5})$/.test(d.id) || seen.has(d.id)) continue;
    if (!isFen(d.fen) || (d.color !== 'w' && d.color !== 'b')) continue;
    if (d.kind !== 'own' && d.kind !== 'puzzle') continue;
    const line = uciList(d.line, 10);
    if (!line.length) continue;
    seen.add(d.id);
    out.drills.push({
      id: d.id, kind: d.kind, category: Object.hasOwn(CATEGORIES, d.category) ? d.category : 'positional',
      theme: cut(d.theme, 40), label: cut(d.label, 80), fen: d.fen, color: d.color, line,
      setup: uciList([d.setup], 1)[0] || '', setupSan: cut(d.setupSan, 12),
      rating: int(d.rating, 100, 3500), note: cut(d.note, 240), played: cut(d.played, 12),
      num: int(d.num, 0, 500) || 0, game: int(d.game, 0, LIMITS.maxGames) || 0,
      motif: cut(d.motif, 20), family: cut(d.family, 60),
    });
  }
  if (!out.drills.length && !out.weaknesses.length) return null;
  return out;
}

/* A validated pack, shaped like the profile the page already draws, so the
   learner sees the same report without a second renderer. */
export function profileFromPack(pack) {
  return {
    v: 1, generated: pack.generated,
    player: { name: pack.player, aliases: [] },
    games: pack.games,
    results: { ...pack.results, unknown: 0 },
    rating: { given: null, fromTags: null, estimated: null, used: pack.rating },
    acpl: pack.acpl, expected: pack.expected,
    phases: pack.phases.map(p => ({ id: p[0], n: p[1], acpl: p[2], expected: pack.expected, errors: 0, errorsPerGame: p[3] })),
    categories: [],
    weaknesses: pack.weaknesses,
    habits: pack.habits.map(h => ({ id: h[0], label: h[1], detail: h[2], count: 0, cost: 0, share: 0, work: HABITS[h[0]].work, avoid: HABITS[h[0]].avoid })),
    strengths: pack.strengths.map(s => ({ id: 'shared', label: s[0], detail: s[1] })),
    openings: pack.openings.map(o => ({ family: o[0], slug: familySlug(o[0]), color: o[1], games: o[2], score: 0, scorePct: o[3], acpl: o[4], loss: 0, n: 0, errors: 0, firstErrors: [] })),
    skills: { punish: { n: 0, hit: 0 }, tactics: { n: 0, hit: 0 }, convert: { n: 0, hit: 0 }, resist: { n: 0, hit: 0 }, clock: { games: 0, errors: 0, moves: 0 } },
    endings: {}, perGame: [], shared: true,
  };
}

/* ====================== snapshots (trend over batches) ====================== */

export function snapshotOf(profile) {
  const cats = {};
  for (const c of profile.categories) cats[c.id] = { count: c.count, cost: Math.round(c.cost) };
  return {
    v: 1, date: profile.generated, games: profile.games, results: { ...profile.results },
    /* the set of games reviewed, so two batches of the same size on the same
       day stay two points on the trend */
    batch: hashOf(profile.perGame.map(g => g.id).sort().join(',')),
    rating: profile.rating.used, acpl: profile.acpl, expected: profile.expected,
    phases: Object.fromEntries(profile.phases.map(p => [p.id, p.acpl])),
    categories: cats, strengths: profile.strengths.map(s => s.id).slice(0, 12),
    player: profile.player.name,
  };
}

export function validSnapshot(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s) || s.v !== 1) return null;
  if (typeof s.date !== 'string' || typeof s.batch !== 'string' || typeof s.player !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date) || !ID_RE.test(s.batch)) return null;
  const num = (x, lo, hi) => (Number.isFinite(x) && x >= lo && x <= hi ? x : null);
  const games = num(s.games, 1, LIMITS.maxGames);
  if (games === null) return null;
  const out = {
    v: 1, date: s.date, games, results: {}, rating: num(s.rating, 100, 3500) || 1500,
    batch: s.batch,
    acpl: num(s.acpl, 0, 2000), expected: num(s.expected, 0, 2000) || 0, phases: {}, categories: Object.create(null), strengths: [],
    player: normalizeName(s.player),
  };
  for (const k of ['win', 'draw', 'loss', 'unknown']) out.results[k] = num(s.results && s.results[k], 0, LIMITS.maxGames) || 0;
  for (const k of ['opening', 'middlegame', 'endgame']) out.phases[k] = num(s.phases && s.phases[k], 0, 2000);
  if (s.categories && typeof s.categories === 'object' && !Array.isArray(s.categories) && Object.keys(s.categories).length <= 64) {
    for (const [id, v] of Object.entries(s.categories)) {
      if (!Object.hasOwn(CATEGORIES, id) || !v || typeof v !== 'object') continue;
      out.categories[id] = { count: num(v.count, 0, 100000) || 0, cost: num(v.cost, 0, 1e8) || 0 };
    }
  }
  if (Array.isArray(s.strengths)) out.strengths = s.strengths.slice(0, 64).filter(x => typeof x === 'string' && x.length <= 60).slice(0, 12);
  return out;
}

/* ====================== estimates and text ====================== */

export function estimateSeconds(games, identity, quality) {
  const q = QUALITY[quality] || QUALITY.standard;
  let positions = 0, mine = 0;
  for (const g of games) {
    const color = playerColor(g, identity);
    if (!color) continue;
    positions += g.plies.length + 1;
    mine += g.plies.filter(p => p.color === color).length;
  }
  const slowShare = 0.22;
  return Math.round((positions * q.fast + mine * slowShare * (2 * q.slow + q.threat)) / 1000);
}

export function formatDuration(secs) {
  if (secs < 60) return `${Math.max(5, Math.round(secs / 5) * 5)} seconds`;
  if (secs < 3600) return `${Math.round(secs / 60)} min`;
  return `${Math.floor(secs / 3600)} h ${Math.round((secs % 3600) / 60)} min`;
}

export function formatEval(cp) {
  if (!Number.isFinite(cp)) return '';
  if (Math.abs(cp) >= MATE - 1000) { const n = MATE - Math.abs(cp); return (cp > 0 ? '#' : '#-') + n; }
  return (cp > 0 ? '+' : '') + (cp / 100).toFixed(1);
}

/* Three cues for a recall question: the right one for `category` and two from
   other categories, ordered by a seed so the same drill always asks the same
   question. Returns [{ text, correct }]. */
export function cueQuestion(category, seed) {
  const right = CATEGORIES[category];
  if (!right || !right.cue) return [];
  const others = Object.entries(CATEGORIES).filter(([id, c]) => id !== category && c.cue);
  if (others.length < 2) return [];
  /* two independent halves of the hash, so neither index is derived from the
     other and neither can go negative */
  const digest = hashOf(String(seed || category));
  const n = parseInt(digest.slice(0, 8), 16), m = parseInt(digest.slice(8, 16), 16);
  const a = others[n % others.length];
  const rest = others.filter(o => o[0] !== a[0]);
  const b = rest[m % rest.length];
  const picks = [{ text: right.cue, correct: true }, { text: a[1].cue, correct: false }, { text: b[1].cue, correct: false }];
  /* a fixed rotation, so the right answer is not always first */
  const at = (n + m) % 3;
  return picks.slice(at).concat(picks.slice(0, at));
}

export function weaknessSentence(w, games) {
  const each = (w.avgCost / 100).toFixed(1);
  const directional = ['hanging', 'fork', 'pin', 'skewer', 'discovered', 'double-check', 'trapped', 'back-rank', 'deflection', 'promotion'].includes(w.id);
  let dir = `${w.count} times`;
  if (directional && w.allowed + w.missed === w.count) {
    if (w.allowed && w.missed) dir = `allowed ${w.allowed} and missed ${w.missed}`;
    else if (w.allowed) dir = `allowed ${w.allowed}`;
    else if (w.missed) dir = `missed ${w.missed}`;
  }
  return `${w.label}: ${dir} in ${w.games} of ${games} games, ${each} pawns each on average.`;
}

/* The page loads this file by its own versioned script tag and reads it
   from here; node tests use the exports above. */
if (typeof window !== 'undefined') {
  window.GameReviewCore = Object.freeze({
    Chess, MATE, LIMITS, QUALITY, FLAG_LOSS, ACPL_ELO, eloFromAcpl, acplForElo, other, START_FEN,
    splitPgn, tagOf, clocksOf, hashOf, normalizeName, parseGame, parseGames, namesIn, makeIdentity, isAlias,
    playerColor, resultFor, nullMoveFen, MOTIFS, TACTICAL, motifOf, classifyLoss, CLS_LABEL, CLS_MARK, phaseOf,
    gradeGame, describeError, CATEGORIES, HABITS, familySlug, buildProfile, sanOf, lineSan, errorNote,
    similarity, puzzleRecord, selectDrills, REVIEW_DAYS, scheduleDrill, scoreDrill, snapshotOf, validSnapshot, materialOf, LOST_ALREADY, ID_RE, byteLength, validRating,
    estimateSeconds, formatDuration, formatEval, weaknessSentence, cueQuestion, MOTIFS, HABITS,
    PACK_LIMITS, PACK_ID, buildPack, validPack, profileFromPack,
  });
}
