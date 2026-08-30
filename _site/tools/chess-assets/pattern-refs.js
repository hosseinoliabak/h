/* Reference material for the patterns: for each one, either a position that
   shows the finished idea or a master game that contains it.

   pattern-refs.json is validated before it ships. Every entry must make its own
   pattern's detector fire, which is checked in tools/security-tests, so a
   reference cannot quietly point at a game that does not contain the pattern.
   Loaded on demand, like the opening tables, and every failure is quiet. */

import { fetchJson } from './json-fetch.js';

let refs = null;
let loading = null;

const SQUARE = '[a-h][1-8]';
const FEN_RE = new RegExp('^[1-8pnbrqkPNBRQK/]+ [wb] (-|[KQkq]{1,4}) (-|' + SQUARE + ')( \\d+ \\d+)?$');
const SAN_RE = /^[1-9OKQRBNa-h][^\s]{0,9}$/;

/* Each field is checked for the destination it is going to: the FEN goes to
   chess.js, the PGN is replayed move by move, and the text goes to textContent
   and never to markup. A pattern may carry a bare position showing the finished
   idea, a master game containing it, or both. */
function cleanItem(raw, kind) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const hero = raw.hero === 'b' ? 'b' : raw.hero === 'w' ? 'w' : null;
  if (!hero) return null;
  const text = value => (typeof value === 'string' && value.length && value.length <= 400 ? value : null);
  const title = text(raw.title), note = text(raw.note);
  if (!title || !note) return null;
  const source = typeof raw.source === 'string' && /^https:\/\/[^\s"'<>]{1,300}$/.test(raw.source) ? raw.source : '';
  if (kind === 'position') {
    if (typeof raw.fen !== 'string' || raw.fen.length > 120 || !FEN_RE.test(raw.fen)) return null;
    return { kind, hero, fen: raw.fen, title, note, source };
  }
  if (typeof raw.pgn !== 'string' || raw.pgn.length > 4000) return null;
  const tokens = raw.pgn.replace(/\d+\.(\.\.)?/g, ' ').split(/\s+/).filter(Boolean);
  if (tokens.length < 10 || tokens.length > 400 || !tokens.every(t => SAN_RE.test(t))) return null;
  return { kind, hero, pgn: raw.pgn, title, note, source };
}
function cleanRef(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const position = cleanItem(raw.position, 'position');
  const game = cleanItem(raw.game, 'game');
  if (!position && !game) return null;
  const out = {};
  if (position) out.position = position;
  if (game) out.game = game;
  return out;
}

export function loadPatternRefs(url = './chess-assets/pattern-refs.json') {
  if (refs) return Promise.resolve(refs);
  if (loading) return loading;
  loading = fetchJson(url, { maxBytes: 1024 * 1024 })
    .then(data => {
      if (!data || !data.refs || typeof data.refs !== 'object') throw new Error('no refs');
      const map = new Map();
      for (const [id, raw] of Object.entries(data.refs)) {
        if (!/^[a-z0-9-]{1,40}$/.test(id)) continue;
        const ref = cleanRef(raw);
        if (ref) map.set(id, ref);
      }
      refs = map;
      return refs;
    })
    .catch(() => { loading = null; return null; });
  return loading;
}
export function refFor(id) {
  return refs ? refs.get(id) || null : null;
}
export const patternRefsReady = () => !!refs;
export { cleanRef, cleanItem };
