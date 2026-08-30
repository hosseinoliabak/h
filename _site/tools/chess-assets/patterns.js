/* Pattern coach: named checkmates, attacking plans, positional ideas, and
   endgame techniques, each read straight off a chess.js board.

   Every pattern has an id, a family, a name, one line for a child, and up to
   three detectors that take a chess.js position and the side executing the
   pattern ('w' or 'b'):

     achieved(pos, side)  the pattern is on the board right now (a named mate
                          has been delivered, a knight sits on its outpost).
     building(pos, side)  a checklist of the pattern's ingredients with a
                          done flag on each, so the coach can say how far a
                          side is from the goal and what is still missing.

   Nothing in here searches. The engine's job is to price the plans the
   detectors find; this file only says what the pieces are doing.

   The geometry of the named mates follows the diagrams in the Wikipedia
   "Checkmate pattern" article (revision fetched 2026-08-30) and the Lichess
   puzzle theme names. The `lichess` count is how many of the 6,100,960
   puzzles in the Lichess puzzle database carried that theme on 2026-08-30,
   which is the frequency ordering the catalog uses.

   Licensed with the site. Board access goes through chess.js only. */

import { Chess } from './chess.js';

const FILES = 'abcdefgh';
const PIECE_WORD = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

const other = c => (c === 'w' ? 'b' : 'w');
const fileOf = sq => FILES.indexOf(sq[0]);
const rankOf = sq => +sq[1];
const mkSq = (f, r) => (f >= 0 && f <= 7 && r >= 1 && r <= 8 ? FILES[f] + r : null);
/* a1 is dark, h1 is light */
const sqColor = sq => ((fileOf(sq) + rankOf(sq)) % 2 === 1 ? 'dark' : 'light');
const sideName = c => (c === 'w' ? 'White' : 'Black');
const cheb = (a, b) => Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rankOf(a) - rankOf(b)));
/* squares are written from the executing side's point of view: rel('b', 'h7')
   is h2, so one detector serves both colors */
const rel = (side, sq) => (side === 'w' ? sq : sq[0] + (9 - rankOf(sq)));
const relRank = (side, r) => (side === 'w' ? r : 9 - r);
/* forward direction for a side, +1 for White */
const fwd = side => (side === 'w' ? 1 : -1);
const homeRank = side => (side === 'w' ? 1 : 8);

function pieces(pos, color, type) {
  const out = [];
  for (const row of pos.board()) for (const c of row) {
    if (!c) continue;
    if (color && c.color !== color) continue;
    if (type && c.type !== type) continue;
    out.push(c);
  }
  return out;
}
const count = (pos, color, type) => pieces(pos, color, type).length;
function kingSq(pos, color) {
  const k = pieces(pos, color, 'k')[0];
  return k ? k.square : null;
}
function neighbors(sq) {
  const out = [];
  const f = fileOf(sq), r = rankOf(sq);
  for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
    if (!df && !dr) continue;
    const s = mkSq(f + df, r + dr);
    if (s) out.push(s);
  }
  return out;
}
function attackersOf(pos, sq, color, type) {
  let list;
  try { list = pos.attackers(sq, color); } catch (e) { return []; }
  if (!type) return list;
  return list.filter(s => (pos.get(s) || {}).type === type);
}
const attacked = (pos, sq, color, type) => attackersOf(pos, sq, color, type).length > 0;
const at = (pos, sq) => (sq ? pos.get(sq) || null : null);
const isOwn = (pos, sq, color, type) => {
  const p = at(pos, sq);
  return !!p && p.color === color && (!type || p.type === type);
};
const empty = (pos, sq) => !!sq && !at(pos, sq);
const onEdge = sq => fileOf(sq) === 0 || fileOf(sq) === 7 || rankOf(sq) === 1 || rankOf(sq) === 8;
const inCorner = sq => (fileOf(sq) === 0 || fileOf(sq) === 7) && (rankOf(sq) === 1 || rankOf(sq) === 8);
const onEdgeFile = sq => fileOf(sq) === 0 || fileOf(sq) === 7;
const adjacent = (a, b) => cheb(a, b) === 1;
const orthAdjacent = (a, b) => adjacent(a, b) && (fileOf(a) === fileOf(b) || rankOf(a) === rankOf(b));
const diagAdjacent = (a, b) => adjacent(a, b) && fileOf(a) !== fileOf(b) && rankOf(a) !== rankOf(b);
/* sign of the diagonal running from a through b: +1 for the a1-h8 direction */
const diagSign = (a, b) => Math.sign((fileOf(b) - fileOf(a)) * (rankOf(b) - rankOf(a)));
/* squares strictly between two squares on a shared line */
function between(a, b) {
  const df = Math.sign(fileOf(b) - fileOf(a)), dr = Math.sign(rankOf(b) - rankOf(a));
  const out = [];
  let f = fileOf(a) + df, r = rankOf(a) + dr;
  while (mkSq(f, r) && mkSq(f, r) !== b) { out.push(mkSq(f, r)); f += df; r += dr; }
  return out;
}
const sameLine = (a, b) => fileOf(a) === fileOf(b) || rankOf(a) === rankOf(b)
  || Math.abs(fileOf(a) - fileOf(b)) === Math.abs(rankOf(a) - rankOf(b));
function pawnsOnFile(pos, f, color) {
  let n = 0;
  for (let r = 2; r <= 7; r++) if (isOwn(pos, mkSq(f, r), color, 'p')) n++;
  return n;
}
function isPassedPawn(pos, sq, color) {
  const f = fileOf(sq), r = rankOf(sq), d = fwd(color);
  for (let df = -1; df <= 1; df++)
    for (let rr = r + d; rr >= 1 && rr <= 8; rr += d)
      if (isOwn(pos, mkSq(f + df, rr), other(color), 'p')) return false;
  return true;
}
function isIsolatedPawn(pos, sq, color) {
  const f = fileOf(sq);
  return !pawnsOnFile(pos, f - 1, color) && !pawnsOnFile(pos, f + 1, color);
}
/* no enemy pawn on the neighboring files can ever advance to attack this square */
function unassailable(pos, sq, color) {
  const f = fileOf(sq), r = rankOf(sq), d = fwd(color);
  for (const df of [-1, 1])
    for (let rr = r + d; rr >= 1 && rr <= 8; rr += d)
      if (isOwn(pos, mkSq(f + df, rr), other(color), 'p')) return false;
  return true;
}
/* pawn islands: groups of neighboring files that hold at least one pawn */
function pawnIslands(pos, color) {
  let islands = 0, prev = false;
  for (let f = 0; f < 8; f++) {
    const has = pawnsOnFile(pos, f, color) > 0;
    if (has && !prev) islands++;
    prev = has;
  }
  return islands;
}
/* the king has castled kingside or sits where a castled king sits */
const kingKingside = (pos, color) => {
  const k = kingSq(pos, color);
  return !!k && fileOf(k) >= 6 && rankOf(k) === homeRank(color);
};
const kingQueenside = (pos, color) => {
  const k = kingSq(pos, color);
  return !!k && fileOf(k) <= 2 && rankOf(k) === homeRank(color);
};
/* the king still stands in the middle files of its home rank without having castled */
function kingUncastled(pos, color) {
  const k = kingSq(pos, color);
  if (!k || rankOf(k) !== homeRank(color)) return false;
  return fileOf(k) >= 3 && fileOf(k) <= 5;
}
/* the king is still in the middle: on its home rank or one step out of it */
function kingInCenter(pos, color) {
  const k = kingSq(pos, color);
  return !!k && fileOf(k) >= 3 && fileOf(k) <= 5 && Math.abs(rankOf(k) - homeRank(color)) <= 1;
}
const material = (pos, color) => pieces(pos, color).reduce((s, p) => s + ({ p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 })[p.type], 0);
const nonPawnMaterial = (pos, color) => pieces(pos, color).filter(p => p.type !== 'p' && p.type !== 'k')
  .reduce((s, p) => s + ({ n: 3, b: 3, r: 5, q: 9 })[p.type], 0);
const isEndgame = pos => !count(pos, 'w', 'q') && !count(pos, 'b', 'q') && nonPawnMaterial(pos, 'w') <= 8 && nonPawnMaterial(pos, 'b') <= 8;
const pawnEnding = pos => pieces(pos).every(p => p.type === 'p' || p.type === 'k');
/* a side's pawns that shelter its king: the three files around it, home side */
function kingZone(pos, color) {
  const k = kingSq(pos, color);
  if (!k) return [];
  return neighbors(k);
}

/* ============================== checkmate geometry ============================== */
/* Everything a named mate needs to know, computed once per position. */
function mateInfo(pos, side) {
  if (!pos.isCheckmate() || pos.turn() !== other(side)) return null;
  const victim = other(side);
  const king = kingSq(pos, victim);
  if (!king) return null;
  const checkers = attackersOf(pos, king, side).map(s => ({ ...pos.get(s), square: s }));
  const around = neighbors(king);
  const ownBlocked = around.filter(s => isOwn(pos, s, victim));
  /* escape squares are judged with the mated king lifted off the board, so a
     square behind the king on the checking line counts as covered */
  let probe;
  try { probe = new Chess(pos.fen()); probe.remove(king); } catch (e) { probe = pos; }
  const covered = around.filter(s => attacked(probe, s, side));
  const c = checkers.length === 1 ? checkers[0] : null;
  return { side, victim, king, checkers, c, around, ownBlocked, covered, probe,
    back: rankOf(king) === homeRank(victim) };
}
/* which pieces of `side` protect a square, by type */
const guardedBy = (pos, sq, side, type) => attacked(pos, sq, side, type);

/* One entry per named mate. `test` returns true when the geometry matches;
   the order below is specific first, generic last, and classifyMate walks it. */
const MATES = [
  { id: 'fools-mate', name: 'Fool’s mate', lichess: null,
    blurb: 'The fastest mate in chess. After f3 and g4 the queen lands on h4 and the king has no way out.',
    test: (pos, m) => m.c && m.c.type === 'q' && kingUncastled(pos, m.victim) && cheb(m.c.square, m.king) >= 2
      && pieces(pos, m.victim, 'p').filter(p => p.square === rel(m.victim, 'f3') || p.square === rel(m.victim, 'g4')).length === 2 },
  { id: 'scholars-mate', name: 'Scholar’s mate', lichess: null,
    blurb: 'Queen takes f7, protected by the bishop on c4, while the king still stands on e8. Every beginner falls for it once.',
    test: (pos, m) => m.c && m.c.type === 'q' && m.c.square === rel(m.side, 'f7') && m.king === rel(m.side, 'e8')
      && guardedBy(pos, m.c.square, m.side, 'b') },
  { id: 'bishop-knight-mate', name: 'Bishop and knight mate', lichess: null,
    blurb: 'One of the four basic mates. King, bishop, and knight drive the lone king to the corner of the bishop’s color.',
    test: (pos, m) => m.c && 'nb'.includes(m.c.type) && pieces(pos, m.victim).length === 1
      && count(pos, m.side, 'b') === 1 && count(pos, m.side, 'n') === 1 && pieces(pos, m.side).length === 3 },
  { id: 'two-bishops-mate', name: 'Two bishops mate', lichess: null,
    blurb: 'One of the four basic mates. Two bishops and the king walk the lone king into a corner.',
    test: (pos, m) => m.c && m.c.type === 'b' && pieces(pos, m.victim).length === 1
      && count(pos, m.side, 'b') === 2 && pieces(pos, m.side).length === 3 },
  { id: 'box-mate', name: 'Box mate', lichess: null,
    blurb: 'King and rook against a lone king. The rook mates along the edge and the king blocks the way back into the board.',
    test: (pos, m) => m.c && m.c.type === 'r' && onEdge(m.king) && pieces(pos, m.victim).length === 1
      && pieces(pos, m.side).length === 2 && m.around.some(s => attacked(pos, s, m.side, 'k')) },
  { id: 'smothered-mate', name: 'Smothered mate', lichess: 24039,
    blurb: 'A knight mates a king that is boxed in by its own pieces. Nobody can take the knight, and there is nowhere to go.',
    test: (pos, m) => m.c && m.c.type === 'n' && m.around.every(s => isOwn(pos, s, m.victim)) },
  { id: 'arabian-mate', name: 'Arabian mate', lichess: 7474,
    blurb: 'Rook and knight trap the king in the corner. The rook sits next to the king and the knight guards it from two squares away.',
    test: (pos, m) => {
      if (!m.c || m.c.type !== 'r' || !inCorner(m.king) || !orthAdjacent(m.c.square, m.king)) return false;
      const df = fileOf(m.king) === 0 ? 2 : -2, dr = rankOf(m.king) === 1 ? 2 : -2;
      return isOwn(pos, mkSq(fileOf(m.king) + df, rankOf(m.king) + dr), m.side, 'n');
    } },
  { id: 'anastasia-mate', name: 'Anastasia’s mate', lichess: 7441,
    blurb: 'A knight on e7 takes away g8 and g6, and a rook comes down the h-file. The king is trapped between the edge and its own pawn.',
    test: (pos, m) => {
      if (!m.c || !'rq'.includes(m.c.type) || !onEdgeFile(m.king) || fileOf(m.c.square) !== fileOf(m.king)) return false;
      const inward = fileOf(m.king) === 0 ? 3 : -3;
      return isOwn(pos, mkSq(fileOf(m.king) + inward, rankOf(m.king)), m.side, 'n');
    } },
  { id: 'hook-mate', name: 'Hook mate', lichess: 10625,
    blurb: 'A rook mates next to the king, a knight protects the rook, and a pawn protects the knight. Three pieces hooked together.',
    test: (pos, m) => {
      if (!m.c || m.c.type !== 'r' || !orthAdjacent(m.c.square, m.king)) return false;
      const knights = attackersOf(pos, m.c.square, m.side, 'n');
      return knights.some(n => guardedBy(pos, n, m.side, 'p'));
    } },
  { id: 'vukovic-mate', name: 'Vuković’s mate', lichess: 2445,
    blurb: 'A protected rook mates the king on the edge while a knight covers the last escape squares. Fischer used it at age thirteen.',
    /* Wikipedia gives the king or a pawn as the usual protector, but the pattern
       is the protected rook plus the knight, whatever does the protecting: the
       Fischer example itself has the rook held by a bishop. */
    test: (pos, m) => m.c && m.c.type === 'r' && onEdge(m.king) && orthAdjacent(m.c.square, m.king)
      && attackersOf(pos, m.c.square, m.side).length > 0
      && m.around.some(s => !isOwn(pos, s, m.victim) && attacked(pos, s, m.side, 'n')) },
  { id: 'corner-mate', name: 'Corner mate', lichess: 10783,
    blurb: 'A knight mates the king in the corner while a rook seals the next file and the king’s own pawn blocks the last square.',
    test: (pos, m) => {
      if (!m.c || m.c.type !== 'n' || !inCorner(m.king)) return false;
      const innerFile = fileOf(m.king) === 0 ? 1 : 6;
      const rq = pieces(pos, m.side).filter(p => 'rq'.includes(p.type) && fileOf(p.square) === innerFile);
      const front = mkSq(fileOf(m.king), rankOf(m.king) + (rankOf(m.king) === 1 ? 1 : -1));
      return rq.length > 0 && isOwn(pos, front, m.victim, 'p');
    } },
  { id: 'greco-mate', name: 'Greco’s mate', lichess: null,
    blurb: 'A bishop covers g8, the king’s own g-pawn blocks g7, and the queen mates down the h-file.',
    test: (pos, m) => {
      if (!m.c || !'rq'.includes(m.c.type) || !onEdgeFile(m.king) || fileOf(m.c.square) !== fileOf(m.king)) return false;
      const inner = fileOf(m.king) === 0 ? 1 : -1;
      const beside = mkSq(fileOf(m.king) + inner, rankOf(m.king));
      const diag = mkSq(fileOf(m.king) + inner, rankOf(m.king) + fwd(m.victim));
      return attacked(pos, beside, m.side, 'b') && isOwn(pos, diag, m.victim, 'p');
    } },
  { id: 'blackburne-mate', name: 'Blackburne’s mate', lichess: null,
    blurb: 'A bishop mates on h7, a knight on g5 protects it, and the other bishop takes the long diagonal. Rare and beautiful.',
    test: (pos, m) => m.c && m.c.type === 'b' && guardedBy(pos, m.c.square, m.side, 'n')
      && pieces(pos, m.side, 'b').some(b => b.square !== m.c.square && m.around.some(s => attackersOf(pos, s, m.side, 'b').includes(b.square))) },
  { id: 'boden-mate', name: 'Boden’s mate', lichess: 3720,
    blurb: 'Two bishops on crossing diagonals mate a king that castled queenside and is blocked by its own rook and pawn.',
    test: (pos, m) => {
      if (!m.c || m.c.type !== 'b' || !m.ownBlocked.length) return false;
      const helper = pieces(pos, m.side, 'b').find(b => b.square !== m.c.square
        && m.around.some(s => attackersOf(pos, s, m.side, 'b').includes(b.square)));
      if (!helper) return false;
      const target = m.around.find(s => attackersOf(pos, s, m.side, 'b').includes(helper.square));
      return diagSign(m.c.square, m.king) !== diagSign(helper.square, target);
    } },
  { id: 'double-bishop-mate', name: 'Double bishop mate', lichess: 3710,
    blurb: 'Two bishops on side-by-side diagonals. One gives check, the other takes away every square the king could run to.',
    test: (pos, m) => {
      if (!m.c || m.c.type !== 'b') return false;
      const helper = pieces(pos, m.side, 'b').find(b => b.square !== m.c.square
        && m.around.some(s => attackersOf(pos, s, m.side, 'b').includes(b.square)));
      if (!helper) return false;
      const target = m.around.find(s => attackersOf(pos, s, m.side, 'b').includes(helper.square));
      return diagSign(m.c.square, m.king) === diagSign(helper.square, target);
    } },
  { id: 'balestra-mate', name: 'Balestra mate', lichess: 1364,
    blurb: 'The queen cuts off the king’s file and diagonal, and a bishop delivers the mate.',
    test: (pos, m) => m.c && m.c.type === 'b' && m.around.filter(s => attacked(pos, s, m.side, 'q')).length >= 2 },
  { id: 'reti-mate', name: 'Réti’s mate', lichess: null,
    blurb: 'A bishop, protected by a rook or queen, mates a king that is hemmed in by its own pieces on three or four sides.',
    test: (pos, m) => m.c && m.c.type === 'b' && m.ownBlocked.length >= 3
      && (guardedBy(pos, m.c.square, m.side, 'r') || guardedBy(pos, m.c.square, m.side, 'q')) },
  { id: 'morphy-mate', name: 'Morphy’s mate', lichess: 7133,
    blurb: 'A bishop on the long diagonal gives the check, and a rook on the g-file keeps the king in the corner.',
    test: (pos, m) => {
      if (!m.c || m.c.type !== 'b' || !onEdgeFile(m.king)) return false;
      const innerFile = fileOf(m.king) === 0 ? 1 : 6;
      return pieces(pos, m.side).some(p => 'rq'.includes(p.type) && fileOf(p.square) === innerFile
        && m.around.some(s => attackersOf(pos, s, m.side).includes(p.square)));
    } },
  { id: 'pillsbury-mate', name: 'Pillsbury’s mate', lichess: 67645,
    blurb: 'A rook checks down the g-file while a bishop on the long diagonal cuts the king off. One of the most common mates in puzzles.',
    test: (pos, m) => m.c && m.c.type === 'r' && fileOf(m.c.square) === fileOf(m.king) && m.back
      && m.around.some(s => !isOwn(pos, s, m.victim) && attacked(pos, s, m.side, 'b')) },
  { id: 'damiano-bishop-mate', name: 'Damiano’s bishop mate', lichess: null,
    blurb: 'The queen mates on h7 next to the king, and a bishop on the b1-h7 diagonal protects her.',
    test: (pos, m) => m.c && m.c.type === 'q' && adjacent(m.c.square, m.king) && guardedBy(pos, m.c.square, m.side, 'b') },
  { id: 'damiano-mate', name: 'Damiano’s mate', lichess: null,
    blurb: 'A pawn on g6 protects the queen as she mates on h7. Usually the rook is sacrificed on h8 first to drag the king over.',
    test: (pos, m) => m.c && m.c.type === 'q' && adjacent(m.c.square, m.king) && guardedBy(pos, m.c.square, m.side, 'p')
      && onEdgeFile(m.c.square) },
  { id: 'lolli-mate', name: 'Lolli’s mate', lichess: null,
    blurb: 'A pawn on f6 breaks into the fianchetto and the queen mates on g7. The h-file sacrifices come first.',
    test: (pos, m) => m.c && m.c.type === 'q' && orthAdjacent(m.c.square, m.king) && m.back
      && attackersOf(pos, m.c.square, m.side, 'p').some(p => rankOf(p) === relRank(m.side, 6)) },
  { id: 'epaulette-mate', name: 'Epaulette mate', lichess: 22648,
    blurb: 'The queen mates from two squares away and the king cannot step sideways because its own rooks sit on both shoulders.',
    test: (pos, m) => {
      if (!m.c || m.c.type !== 'q' || cheb(m.c.square, m.king) !== 2) return false;
      const sameFile = fileOf(m.c.square) === fileOf(m.king), sameRank = rankOf(m.c.square) === rankOf(m.king);
      if (!sameFile && !sameRank) return false;
      const f = fileOf(m.king), r = rankOf(m.king);
      const sides = sameFile ? [mkSq(f - 1, r), mkSq(f + 1, r)] : [mkSq(f, r - 1), mkSq(f, r + 1)];
      return sides.every(s => s && isOwn(pos, s, m.victim));
    } },
  { id: 'swallow-tail-mate', name: 'Swallow’s tail mate', lichess: 8397,
    blurb: 'A protected queen checks the king head-on, and the two squares behind the king are taken by its own rooks.',
    test: (pos, m) => {
      if (!m.c || m.c.type !== 'q' || !orthAdjacent(m.c.square, m.king)) return false;
      const df = fileOf(m.king) - fileOf(m.c.square), dr = rankOf(m.king) - rankOf(m.c.square);
      const behind = df ? [mkSq(fileOf(m.king) + df, rankOf(m.king) - 1), mkSq(fileOf(m.king) + df, rankOf(m.king) + 1)]
                        : [mkSq(fileOf(m.king) - 1, rankOf(m.king) + dr), mkSq(fileOf(m.king) + 1, rankOf(m.king) + dr)];
      return behind.every(s => s && isOwn(pos, s, m.victim));
    } },
  { id: 'dovetail-mate', name: 'Dovetail mate', lichess: 4013,
    blurb: 'The queen mates diagonally next to the king, and the two squares she does not cover are blocked by the king’s own men.',
    test: (pos, m) => {
      if (!m.c || m.c.type !== 'q' || !diagAdjacent(m.c.square, m.king)) return false;
      const free = m.around.filter(s => s !== m.c.square && !attackersOf(m.probe, s, m.side, 'q').includes(m.c.square));
      return free.length === 2 && free.every(s => isOwn(pos, s, m.victim));
    } },
  { id: 'triangle-mate', name: 'Triangle mate', lichess: 7741,
    blurb: 'Queen, rook, and king form a triangle. The rook stands two squares behind the queen on the same file and protects her.',
    test: (pos, m) => m.c && m.c.type === 'q' && adjacent(m.c.square, m.king)
      && attackersOf(pos, m.c.square, m.side, 'r').some(r => cheb(r, m.c.square) === 2
        && (fileOf(r) === fileOf(m.c.square) || rankOf(r) === rankOf(m.c.square))) },
  { id: 'kill-box-mate', name: 'Kill box mate', lichess: 5440,
    blurb: 'A rook next to the king and a queen two squares along the diagonal build a three by three box the king cannot leave.',
    test: (pos, m) => m.c && m.c.type === 'r' && orthAdjacent(m.c.square, m.king)
      && pieces(pos, m.side, 'q').some(q => cheb(q.square, m.c.square) === 2
        && Math.abs(fileOf(q.square) - fileOf(m.c.square)) === 2 && Math.abs(rankOf(q.square) - rankOf(m.c.square)) === 2
        && between(q.square, m.c.square).every(s => empty(pos, s))) },
  { id: 'blind-swine-mate', name: 'Blind swine mate', lichess: 6361,
    blurb: 'Two rooks on the seventh rank eat the pawns and mate the king on the back rank.',
    test: (pos, m) => m.c && m.c.type === 'r' && m.back && rankOf(m.c.square) === homeRank(m.victim) + fwd(m.victim)
      && count(pos, m.side, 'r') >= 2 && pieces(pos, m.side, 'r').filter(r => rankOf(r.square) === rankOf(m.c.square)).length >= 2 },
  { id: 'mayet-mate', name: 'Mayet’s mate', lichess: null,
    blurb: 'A rook mates on h8 next to the king, protected from far away by a bishop on the long diagonal.',
    test: (pos, m) => m.c && m.c.type === 'r' && m.back && onEdgeFile(m.c.square) && adjacent(m.c.square, m.king)
      && guardedBy(pos, m.c.square, m.side, 'b') },
  { id: 'opera-mate', name: 'Opera mate', lichess: 63940,
    blurb: 'A rook mates on the back rank and a bishop protects it. Morphy played it at the Paris opera in 1858.',
    test: (pos, m) => m.c && m.c.type === 'r' && m.back && rankOf(m.c.square) === rankOf(m.king)
      && guardedBy(pos, m.c.square, m.side, 'b') },
  { id: 'anderssen-mate', name: 'Anderssen’s mate', lichess: null,
    blurb: 'A rook or queen mates on the back rank, protected by a pawn on the seventh.',
    test: (pos, m) => m.c && 'rq'.includes(m.c.type) && m.back && guardedBy(pos, m.c.square, m.side, 'p') },
  { id: 'legal-mate', name: 'Légal’s mate', lichess: null,
    blurb: 'The queen is given away, and two knights plus a bishop mate the king in the center of the board.',
    test: (pos, m) => m.c && 'nb'.includes(m.c.type) && count(pos, m.side, 'n') >= 2 && count(pos, m.side, 'b') >= 1
      && !count(pos, m.side, 'q') && kingInCenter(pos, m.victim)
      && ['n', 'b'].every(t => pieces(pos, m.side, t).some(p => p.square !== m.c.square
        && m.around.some(s => attackersOf(pos, s, m.side, t).includes(p.square)))) },
  { id: 'suffocation-mate', name: 'Suffocation mate', lichess: null,
    blurb: 'A knight gives the check while a bishop or queen takes the king’s escape squares away.',
    test: (pos, m) => m.c && m.c.type === 'n' && m.around.some(s => !isOwn(pos, s, m.victim)
      && (attacked(pos, s, m.side, 'b') || attacked(pos, s, m.side, 'q'))) },
  { id: 'ladder-mate', name: 'Ladder mate', lichess: null,
    blurb: 'Two rooks, or rook and queen, push the king rank by rank to the edge and mate it there. The lawnmower.',
    test: (pos, m) => {
      if (!m.c || !'rq'.includes(m.c.type) || !onEdge(m.king)) return false;
      const alongRank = rankOf(m.king) === 1 || rankOf(m.king) === 8;
      if (alongRank ? rankOf(m.c.square) !== rankOf(m.king) : fileOf(m.c.square) !== fileOf(m.king)) return false;
      const inner = alongRank ? rankOf(m.king) + (rankOf(m.king) === 1 ? 1 : -1) : fileOf(m.king) + (fileOf(m.king) === 0 ? 1 : -1);
      return pieces(pos, m.side).some(p => 'rq'.includes(p.type) && p.square !== m.c.square
        && (alongRank ? rankOf(p.square) === inner : fileOf(p.square) === inner)) && !m.ownBlocked.length;
    } },
  { id: 'back-rank-mate', name: 'Back-rank mate', lichess: 206205,
    blurb: 'A rook or queen mates on the back rank because the king’s own pawns block every way out. The most common mate of all.',
    test: (pos, m) => m.c && 'rq'.includes(m.c.type) && m.back && rankOf(m.c.square) === rankOf(m.king)
      && m.around.filter(s => rankOf(s) !== rankOf(m.king)).some(s => isOwn(pos, s, m.victim)) },
  { id: 'queen-king-mate', name: 'Queen mate', lichess: null,
    blurb: 'The queen mates right next to the king and her own king protects her. The first mate every player learns.',
    test: (pos, m) => m.c && m.c.type === 'q' && adjacent(m.c.square, m.king) && guardedBy(pos, m.c.square, m.side, 'k') },
  { id: 'david-goliath-mate', name: 'David and Goliath mate', lichess: null,
    blurb: 'The humble pawn delivers the mate.',
    test: (pos, m) => m.c && m.c.type === 'p' },
];

/* the first named mate whose geometry fits the checkmate on the board */
export function classifyMate(pos, side) {
  const m = mateInfo(pos, side);
  if (!m) return null;
  for (const p of MATES) { try { if (p.test(pos, m)) return p.id; } catch (e) { /* keep looking */ } }
  return 'checkmate';
}

/* ============================== ingredients ============================== */
/* Small board facts the checklists are built from. `side` is always the side
   executing the pattern; the victim is the other side. */
const vBackRank = (pos, side) => {
  const k = kingSq(pos, other(side));
  return !!k && rankOf(k) === homeRank(other(side));
};
/* the squares in front of the enemy king (toward the middle of the board) */
function frontSquares(pos, side) {
  const v = other(side), k = kingSq(pos, v);
  if (!k) return [];
  const r = rankOf(k) + fwd(v);
  return [-1, 0, 1].map(df => mkSq(fileOf(k) + df, r)).filter(Boolean);
}
/* the enemy king is on its back rank with its own men in front of it */
function weakBackRank(pos, side) {
  if (!vBackRank(pos, side)) return false;
  const v = other(side), front = frontSquares(pos, side);
  const own = front.filter(sq => isOwn(pos, sq, v)).length;
  return own >= 2 && front.every(sq => isOwn(pos, sq, v) || attacked(pos, sq, side));
}
/* enemy heavy pieces still guarding the back rank */
const backRankGuards = (pos, side) => pieces(pos, other(side)).filter(p => 'rq'.includes(p.type) && rankOf(p.square) === homeRank(other(side))).length;
/* an attacking rook or queen already aims at some square of the enemy back rank */
function heavyAimsAtBackRank(pos, side) {
  const r = homeRank(other(side));
  for (let f = 0; f < 8; f++) {
    const sq = mkSq(f, r);
    if (attacked(pos, sq, side, 'r') || attacked(pos, sq, side, 'q')) return true;
  }
  return false;
}
/* a file with no pawns of either color */
const openFile = (pos, f) => !pawnsOnFile(pos, f, 'w') && !pawnsOnFile(pos, f, 'b');
const halfOpenFile = (pos, f, side) => !pawnsOnFile(pos, f, side) && pawnsOnFile(pos, f, other(side)) > 0;
const has = (pos, side, type, n = 1) => count(pos, side, type) >= n;
const pieceOn = (pos, side, type, sq) => isOwn(pos, sq, side, type);
const aims = (pos, side, type, sq) => !!sq && attacked(pos, sq, side, type);
/* a piece of `type` stands on `sq` or can go there in one move */
const canReach = (pos, side, type, sq) => pieceOn(pos, side, type, sq) || aims(pos, side, type, sq);
const vPawn = (pos, side, sq) => isOwn(pos, sq, other(side), 'p');
const R = rel;
/* the enemy king castled short and still has its pawn shield */
const shortCastled = (pos, side) => kingKingside(pos, other(side));
/* enemy fianchetto: king on g8, pawn g6, the bishop on g7 gone or present */
const vFianchetto = (pos, side) => shortCastled(pos, side) && vPawn(pos, side, R(side, 'g6'));
/* the enemy dark-square (or light-square) bishop that guards g7 is gone */
const vLacksBishopOn = (pos, side, color) => !pieces(pos, other(side), 'b').some(b => sqColor(b.square) === color);
const kingDistance = (pos, side) => {
  const a = kingSq(pos, side), b = kingSq(pos, other(side));
  return a && b ? cheb(a, b) : 9;
};
/* squares next to the enemy king that our pieces attack */
const zoneHits = (pos, side) => neighbors(kingSq(pos, other(side)) || 'e4').filter(sq => attacked(pos, sq, side)).length;
/* enemy pawns on one wing (files a-d or e-h) */
const wingPawns = (pos, color, queenside) => pieces(pos, color, 'p').filter(p => queenside ? fileOf(p.square) <= 3 : fileOf(p.square) >= 4).length;
/* our passed pawns */
const passedPawns = (pos, side) => pieces(pos, side, 'p').filter(p => isPassedPawn(pos, p.square, side));
const step = (text, done, squares = []) => ({ text, done: !!done, squares });

/* ============================== the catalog ============================== */
/* family: mate | attack | positional | endgame
   plan:   how a child gets there, in one breath
   building(pos, side): the checklist, or null when the pattern cannot apply
   achieved(pos, side): the finished pattern (named mates check the mate) */
const PATTERNS = [];
const add = p => PATTERNS.push(p);
const mateBy = id => MATES.find(m => m.id === id);
const mateAchieved = id => (pos, side) => classifyMate(pos, side) === id;

/* ---------- mates, most common first (Lichess puzzle counts) ---------- */
add({ id: 'back-rank-mate', family: 'mate',
  plan: 'Keep the enemy king locked behind its own pawns, get a rook or queen onto an open file, and count the defenders of the back rank before you go in.',
  achieved: mateAchieved('back-rank-mate'),
  building: (pos, side) => {
    if (!vBackRank(pos, side) || !(has(pos, side, 'r') || has(pos, side, 'q'))) return null;
    return [
      step('The enemy king stands on its back rank', true),
      step('Its own pawns block the squares in front of it', weakBackRank(pos, side), frontSquares(pos, side)),
      step('One of your rooks or queens already aims at the back rank', heavyAimsAtBackRank(pos, side)),
      step('No enemy rook or queen is left to guard the back rank', backRankGuards(pos, side) === 0),
    ];
  } });
add({ id: 'pillsbury-mate', family: 'mate',
  plan: 'Put a bishop on the long diagonal aimed at the king, then bring a rook to the g-file, if needed by taking on g7 first.',
  achieved: mateAchieved('pillsbury-mate'),
  building: (pos, side) => {
    if (!shortCastled(pos, side) || !has(pos, side, 'r') || !has(pos, side, 'b')) return null;
    const g7 = R(side, 'g7'), h8 = R(side, 'h8');
    return [
      step('The enemy king has castled short', true),
      step('A bishop aims along the long diagonal at g7 or h8', aims(pos, side, 'b', g7) || aims(pos, side, 'b', h8) || pieceOn(pos, side, 'b', R(side, 'h6'))),
      step('A rook can come to the g-file', pieces(pos, side, 'r').some(r => fileOf(r.square) === 6) || [1,2,3,4,5,6,7,8].some(n => aims(pos, side, 'r', 'g' + n))),
      step('The g-file is open or the g7 pawn can be taken', !vPawn(pos, side, g7) || attacked(pos, g7, side)),
    ];
  } });
add({ id: 'opera-mate', family: 'mate',
  plan: 'Against a king still on its back rank, put a bishop on the diagonal that guards the mating square, then drop a rook onto the back rank.',
  achieved: mateAchieved('opera-mate'),
  building: (pos, side) => {
    if (!vBackRank(pos, side) || !has(pos, side, 'r') || !has(pos, side, 'b')) return null;
    const back = homeRank(other(side));
    const guarded = [0,1,2,3,4,5,6,7].some(f => { const sq = mkSq(f, back); return aims(pos, side, 'b', sq) && (aims(pos, side, 'r', sq) || aims(pos, side, 'q', sq)); });
    return [
      step('The enemy king stands on its back rank', true),
      step('An open or half-open file leads to that rank', [0,1,2,3,4,5,6,7].some(f => !pawnsOnFile(pos, f, other(side)) && [side].some(() => pieces(pos, side, 'r').some(r => fileOf(r.square) === f)))),
      step('A bishop guards a back-rank square your rook can land on', guarded),
      step('Its own pieces block the king from stepping forward', weakBackRank(pos, side) || frontSquares(pos, side).filter(sq => isOwn(pos, sq, other(side))).length >= 1),
    ];
  } });
add({ id: 'smothered-mate', family: 'mate',
  plan: 'Get the king into the corner with its rook next to it, check with the knight, give the queen on g8 so the rook must take, then Nf7 mate.',
  achieved: mateAchieved('smothered-mate'),
  building: (pos, side) => {
    if (!has(pos, side, 'n') || !vBackRank(pos, side)) return null;
    const k = kingSq(pos, other(side));
    const f7 = R(side, 'f7'), g8 = R(side, 'g8'), h8 = R(side, 'h8');
    const boxed = neighbors(k).filter(sq => isOwn(pos, sq, other(side))).length;
    return [
      step('The enemy king is near the corner', shortCastled(pos, side) || kingQueenside(pos, other(side))),
      step('Its own pieces crowd the squares around it', boxed >= 3, neighbors(k).filter(sq => isOwn(pos, sq, other(side)))),
      step('A knight can reach the mating square (f7 or h6 style)', canReach(pos, side, 'n', f7) || canReach(pos, side, 'n', R(side, 'h6')) || canReach(pos, side, 'n', R(side, 'd7'))),
      step('A queen is ready for the g8 sacrifice, or the king is fully boxed in', has(pos, side, 'q') ? (aims(pos, side, 'q', g8) || aims(pos, side, 'q', R(side, 'b8'))) : (pieceOn(pos, other(side), 'k', h8) && boxed >= 3)),
    ];
  } });
add({ id: 'epaulette-mate', family: 'mate',
  plan: 'Lure the king between its own rooks (or other pieces) on the back rank, then check it with the queen from two squares away.',
  achieved: mateAchieved('epaulette-mate'),
  building: (pos, side) => {
    if (!has(pos, side, 'q') || !vBackRank(pos, side)) return null;
    const k = kingSq(pos, other(side)), f = fileOf(k), r = rankOf(k);
    const flanks = [mkSq(f - 1, r), mkSq(f + 1, r)].filter(Boolean);
    return [
      step('The enemy king stands on its back rank', true),
      step('Its own pieces stand on both sides of it', flanks.length === 2 && flanks.every(sq => isOwn(pos, sq, other(side))), flanks),
      step('Your queen can reach the square two in front of the king', aims(pos, side, 'q', mkSq(f, r + 2 * fwd(other(side))))),
    ];
  } });
add({ id: 'corner-mate', family: 'mate',
  plan: 'Seal the g-file with a rook or queen while the king sits in the corner behind its h-pawn, then a knight check on f7 is mate.',
  achieved: mateAchieved('corner-mate'),
  building: (pos, side) => {
    if (!has(pos, side, 'n')) return null;
    const k = kingSq(pos, other(side));
    return [
      step('The enemy king is in or next to the corner', !!k && cheb(k, R(side, 'h8')) <= 1 || cheb(k, R(side, 'a8')) <= 1),
      step('Its h-pawn blocks the square in front of it', vPawn(pos, side, R(side, 'h7')) || vPawn(pos, side, R(side, 'a7'))),
      step('A rook or queen controls the g-file', pieces(pos, side).some(p => 'rq'.includes(p.type) && (fileOf(p.square) === 6 || fileOf(p.square) === 1))),
      step('A knight can jump to f7', canReach(pos, side, 'n', R(side, 'f7')) || canReach(pos, side, 'n', R(side, 'c7'))),
    ];
  } });
add({ id: 'hook-mate', family: 'mate',
  plan: 'Build the hook. A pawn protects a knight, the knight protects the rook, and the rook checks the king from next door.',
  achieved: mateAchieved('hook-mate'),
  building: (pos, side) => {
    if (!has(pos, side, 'r') || !has(pos, side, 'n')) return null;
    const k = kingSq(pos, other(side));
    const knightsNear = pieces(pos, side, 'n').filter(n => cheb(n.square, k) <= 2);
    return [
      step('A knight stands within two squares of the enemy king', knightsNear.length > 0, knightsNear.map(n => n.square)),
      step('A pawn protects that knight', knightsNear.some(n => attacked(pos, n.square, side, 'p'))),
      step('A rook can reach a square next to the king that the knight protects', neighbors(k).some(sq => aims(pos, side, 'r', sq) && attacked(pos, sq, side, 'n'))),
    ];
  } });
add({ id: 'swallow-tail-mate', family: 'mate',
  plan: 'When the enemy king has pieces on both diagonal squares behind it, a protected queen check from directly in front is mate.',
  achieved: mateAchieved('swallow-tail-mate'),
  building: (pos, side) => {
    if (!has(pos, side, 'q')) return null;
    const v = other(side), k = kingSq(pos, v), f = fileOf(k), r = rankOf(k) - fwd(v);
    const tail = [mkSq(f - 1, r), mkSq(f + 1, r)].filter(Boolean);
    return [
      step('Two of the king’s own pieces stand on the squares diagonally behind it', tail.length === 2 && tail.every(sq => isOwn(pos, sq, v)), tail),
      step('Your queen can reach the square in front of the king', aims(pos, side, 'q', mkSq(f, rankOf(k) + fwd(v)))),
      step('Something of yours protects that square', attacked(pos, mkSq(f, rankOf(k) + fwd(v)) || k, side, 'r') || attacked(pos, mkSq(f, rankOf(k) + fwd(v)) || k, side, 'b') || attacked(pos, mkSq(f, rankOf(k) + fwd(v)) || k, side, 'n') || attacked(pos, mkSq(f, rankOf(k) + fwd(v)) || k, side, 'p')),
    ];
  } });
add({ id: 'triangle-mate', family: 'mate',
  plan: 'Put a rook two squares behind where the queen will land, so the rook protects her, and check the king from next to it.',
  achieved: mateAchieved('triangle-mate'),
  building: (pos, side) => {
    if (!has(pos, side, 'q') || !has(pos, side, 'r')) return null;
    const k = kingSq(pos, other(side));
    return [
      step('The enemy king is on the edge or blocked on one side', onEdge(k) || neighbors(k).some(sq => isOwn(pos, sq, other(side)))),
      step('Your queen can reach a square next to the king', neighbors(k).some(sq => aims(pos, side, 'q', sq))),
      step('A rook lines up two squares behind that square', neighbors(k).some(sq => aims(pos, side, 'q', sq) && pieces(pos, side, 'r').some(r => cheb(r.square, sq) === 2 && (fileOf(r.square) === fileOf(sq) || rankOf(r.square) === rankOf(sq))))),
    ];
  } });
add({ id: 'arabian-mate', family: 'mate',
  plan: 'Drive the king into the corner, plant the knight two squares away on the diagonal, and bring the rook next to the king.',
  achieved: mateAchieved('arabian-mate'),
  building: (pos, side) => {
    if (!has(pos, side, 'r') || !has(pos, side, 'n')) return null;
    const k = kingSq(pos, other(side));
    const corners = ['a1', 'h1', 'a8', 'h8'];
    const near = corners.find(c => cheb(c, k) <= 1);
    if (!near) return null;
    const df = fileOf(near) === 0 ? 2 : -2, dr = rankOf(near) === 1 ? 2 : -2;
    const post = mkSq(fileOf(near) + df, rankOf(near) + dr);
    return [
      step('The enemy king is in or next to a corner', true),
      step(`A knight sits or can land on ${post}`, canReach(pos, side, 'n', post), [post]),
      step('A rook can reach the square next to the corner', neighbors(near).some(sq => aims(pos, side, 'r', sq))),
    ];
  } });
add({ id: 'anastasia-mate', family: 'mate',
  plan: 'Knight to e7 takes g8 and g6 away, then open the h-file (often with a queen sacrifice on h7) and check with the rook.',
  achieved: mateAchieved('anastasia-mate'),
  building: (pos, side) => {
    if (!has(pos, side, 'r') && !has(pos, side, 'q')) return null;
    if (!has(pos, side, 'n') || !shortCastled(pos, side)) return null;
    const e7 = R(side, 'e7');
    return [
      step('The enemy king has castled short', true),
      step('A knight can reach e7', canReach(pos, side, 'n', e7), [e7]),
      step('A rook or queen can come to the h-file', pieces(pos, side).some(p => 'rq'.includes(p.type) && (fileOf(p.square) === 7 || [1,2,3,4,5,6].some(n => aims(pos, side, p.type, 'h' + n))))),
      step('The h-file is open, or the h7 pawn can be removed', !vPawn(pos, side, R(side, 'h7')) || attacked(pos, R(side, 'h7'), side)),
    ];
  } });
add({ id: 'morphy-mate', family: 'mate',
  plan: 'Bishop on the long diagonal, rook on the g-file, and the king’s own h-pawn does the rest.',
  achieved: mateAchieved('morphy-mate'),
  building: (pos, side) => {
    if (!has(pos, side, 'b') || !has(pos, side, 'r')) return null;
    if (!shortCastled(pos, side)) return null;
    return [
      step('The enemy king has castled short', true),
      step('A bishop aims along the long diagonal at g7', aims(pos, side, 'b', R(side, 'g7')) || pieceOn(pos, side, 'b', R(side, 'f6'))),
      step('A rook can reach the g-file', pieces(pos, side, 'r').some(r => fileOf(r.square) === 6) || [1,2,3,4,5,6,7,8].some(n => aims(pos, side, 'r', 'g' + n))),
      step('The h-pawn still blocks h7', vPawn(pos, side, R(side, 'h7'))),
    ];
  } });
add({ id: 'blind-swine-mate', family: 'mate',
  plan: 'Get both rooks onto the seventh rank. They eat the pawns and mate the king on the back rank.',
  achieved: mateAchieved('blind-swine-mate'),
  building: (pos, side) => {
    if (!has(pos, side, 'r', 2)) return null;
    const seventh = relRank(side, 7);
    const on7 = pieces(pos, side, 'r').filter(r => rankOf(r.square) === seventh);
    return [
      step('One rook has reached the seventh rank', on7.length >= 1, on7.map(r => r.square)),
      step('The second rook can join it', on7.length >= 2 || pieces(pos, side, 'r').some(r => rankOf(r.square) !== seventh && [0,1,2,3,4,5,6,7].some(f => aims(pos, side, 'r', mkSq(f, seventh))))),
      step('The enemy king is on its back rank', vBackRank(pos, side)),
    ];
  } });
add({ id: 'kill-box-mate', family: 'mate',
  plan: 'Put the queen two squares diagonally from where the rook will check, and the king on the edge has no box to leave.',
  achieved: mateAchieved('kill-box-mate'),
  building: (pos, side) => {
    if (!has(pos, side, 'q') || !has(pos, side, 'r')) return null;
    const k = kingSq(pos, other(side));
    return [
      step('The enemy king is on the edge', onEdge(k)),
      step('Your queen stands within two squares of the king', pieces(pos, side, 'q').some(q => cheb(q.square, k) <= 2)),
      step('A rook can check from next to the king', neighbors(k).some(sq => aims(pos, side, 'r', sq))),
    ];
  } });
add({ id: 'dovetail-mate', family: 'mate',
  plan: 'When two of the king’s own pieces block its escape, a protected queen check from the diagonal next to it is mate.',
  achieved: mateAchieved('dovetail-mate'),
  building: (pos, side) => {
    if (!has(pos, side, 'q')) return null;
    const k = kingSq(pos, other(side));
    return [
      step('The king is away from the edge with its own pieces beside it', !onEdge(k) && neighbors(k).filter(sq => isOwn(pos, sq, other(side))).length >= 2),
      step('Your queen can reach a square diagonally next to the king', neighbors(k).some(sq => diagAdjacent(sq, k) && aims(pos, side, 'q', sq))),
      step('That square is protected by another of your pieces', neighbors(k).some(sq => diagAdjacent(sq, k) && aims(pos, side, 'q', sq) && ['r','b','n','p','k'].some(t => attacked(pos, sq, side, t)))),
    ];
  } });
add({ id: 'boden-mate', family: 'mate',
  plan: 'Against a king that castled long, aim one bishop at c8 from f4 and the other at b7 from a6, then the queen sacrifice on c3 opens the diagonal.',
  achieved: mateAchieved('boden-mate'),
  building: (pos, side) => {
    if (!has(pos, side, 'b', 2) || !kingQueenside(pos, other(side))) return null;
    const k = kingSq(pos, other(side));
    return [
      step('The enemy king has castled long', true),
      step('One bishop aims at the king’s diagonal from the f4 side', pieces(pos, side, 'b').some(b => diagSign(b.square, k) === -1 && sameLine(b.square, k))),
      step('The other bishop aims at the other diagonal from the a6 side', pieces(pos, side, 'b').some(b => neighbors(k).some(sq => attackersOf(pos, sq, side, 'b').includes(b.square) && diagSign(b.square, sq) === 1))),
      step('Its own rook or pawn blocks its escape', neighbors(k).some(sq => isOwn(pos, sq, other(side)))),
    ];
  } });
add({ id: 'double-bishop-mate', family: 'mate',
  plan: 'Line both bishops up on neighboring diagonals toward the king in the corner; one checks, the other takes the escape squares.',
  achieved: mateAchieved('double-bishop-mate'),
  building: (pos, side) => {
    if (!has(pos, side, 'b', 2)) return null;
    const k = kingSq(pos, other(side));
    return [
      step('The enemy king is near a corner', ['a1','h1','a8','h8'].some(c => cheb(c, k) <= 1)),
      step('A bishop aims at the king or a square next to it', pieces(pos, side, 'b').some(b => attackersOf(pos, k, side, 'b').includes(b.square) || neighbors(k).some(sq => attackersOf(pos, sq, side, 'b').includes(b.square)))),
      step('The second bishop aims at another square next to it', pieces(pos, side, 'b').filter(b => neighbors(k).some(sq => attackersOf(pos, sq, side, 'b').includes(b.square))).length >= 2),
    ];
  } });
add({ id: 'greco-mate', family: 'mate',
  plan: 'A bishop on the a2-g8 diagonal watches g8; open the h-file, and the queen mates there while the g-pawn blocks the king.',
  achieved: mateAchieved('greco-mate'),
  building: (pos, side) => {
    if (!has(pos, side, 'q') || !has(pos, side, 'b') || !shortCastled(pos, side)) return null;
    return [
      step('The enemy king has castled short', true),
      step('A bishop aims at g8', aims(pos, side, 'b', R(side, 'g8')) || pieceOn(pos, side, 'b', R(side, 'g8'))),
      step('The g-pawn still blocks g7', vPawn(pos, side, R(side, 'g7'))),
      step('The h-file is open or the queen can reach it', !vPawn(pos, side, R(side, 'h7')) || [1,2,3,4,5,6].some(n => aims(pos, side, 'q', 'h' + n))),
    ];
  } });
add({ id: 'damiano-bishop-mate', family: 'mate',
  plan: 'Sacrifice the bishop on h7 to drag the king out, drop the bishop back to g6, and the queen mates on h7 with the bishop behind her.',
  achieved: mateAchieved('damiano-bishop-mate'),
  building: (pos, side) => {
    if (!has(pos, side, 'q') || !has(pos, side, 'b') || !shortCastled(pos, side)) return null;
    const h7 = R(side, 'h7'), g6 = R(side, 'g6');
    return [
      step('The enemy king has castled short', true),
      step('A bishop aims at h7', aims(pos, side, 'b', h7), [h7]),
      step('The bishop can drop back to g6 behind the queen', canReach(pos, side, 'b', g6), [g6]),
      step('The queen can reach the h-file', [1,2,3,4,5,6,7].some(n => aims(pos, side, 'q', 'h' + n))),
    ];
  } });
add({ id: 'damiano-mate', family: 'mate',
  plan: 'A pawn on g6 protects h7. Sacrifice the rook on h8 to drag the king over, then the queen checks on the h-file and mates on h7.',
  achieved: mateAchieved('damiano-mate'),
  building: (pos, side) => {
    if (!has(pos, side, 'q') || !shortCastled(pos, side)) return null;
    return [
      step('The enemy king has castled short', true),
      step('Your pawn stands on g6 (or can get there)', pieceOn(pos, side, 'p', R(side, 'g6')) || pieceOn(pos, side, 'p', R(side, 'g5')) || pieceOn(pos, side, 'p', R(side, 'h5'))),
      step('The h-file is open for your rook or queen', !vPawn(pos, side, R(side, 'h7')) || attacked(pos, R(side, 'h7'), side, 'r') || attacked(pos, R(side, 'h7'), side, 'q')),
      step('Your queen can reach the h-file', [1,2,3,4,5,6,7].some(n => aims(pos, side, 'q', 'h' + n))),
    ];
  } });
add({ id: 'lolli-mate', family: 'mate',
  plan: 'Push a pawn to f6 into the fianchetto, bring the queen to h6, and mate on g7.',
  achieved: mateAchieved('lolli-mate'),
  building: (pos, side) => {
    if (!has(pos, side, 'q') || !vFianchetto(pos, side)) return null;
    return [
      step('The enemy king sits in a fianchetto (pawn on g6)', true),
      step('Its dark-square bishop is gone from g7', !pieceOn(pos, other(side), 'b', R(side, 'g7'))),
      step('Your pawn can reach f6', pieceOn(pos, side, 'p', R(side, 'f6')) || pieceOn(pos, side, 'p', R(side, 'f5')) || pieceOn(pos, side, 'p', R(side, 'e5'))),
      step('Your queen can reach h6', canReach(pos, side, 'q', R(side, 'h6'))),
    ];
  } });
add({ id: 'scholars-mate', family: 'mate',
  plan: 'Queen to h5 and bishop to c4 both hit f7. It only works if the other side does not defend f7, so learn to stop it too.',
  achieved: mateAchieved('scholars-mate'),
  building: (pos, side) => {
    const f7 = R(side, 'f7');
    if (!pieceOn(pos, other(side), 'k', R(side, 'e8')) || !has(pos, side, 'q')) return null;
    return [
      step('The enemy king is still on its starting square', true),
      step('A bishop aims at f7', aims(pos, side, 'b', f7)),
      step('The queen aims at f7', aims(pos, side, 'q', f7)),
      step('Only the king defends f7', attackersOf(pos, f7, other(side)).every(sq => (pos.get(sq) || {}).type === 'k')),
    ];
  } });
add({ id: 'fools-mate', family: 'mate',
  plan: 'It only happens when the other side weakens the e1-h4 diagonal with f3 and g4. Know it so you never allow it.',
  achieved: mateAchieved('fools-mate'),
  building: (pos, side) => {
    if (!pieceOn(pos, other(side), 'k', R(side, 'e8')) || !has(pos, side, 'q')) return null;
    const f6 = R(side, 'f6'), g5 = R(side, 'g5');
    if (!vPawn(pos, side, f6) && !vPawn(pos, side, g5)) return null;
    return [
      step('The enemy f-pawn has moved', vPawn(pos, side, f6) || vPawn(pos, side, R(side, 'f5'))),
      step('The enemy g-pawn has moved two squares', vPawn(pos, side, g5)),
      step('Your queen can reach the open diagonal', aims(pos, side, 'q', R(side, 'h4')) || aims(pos, side, 'q', R(side, 'h5'))),
    ];
  } });
add({ id: 'ladder-mate', family: 'mate',
  plan: 'Use two rooks (or rook and queen) like a lawnmower. One cuts the king off on a rank, the other checks on the next rank, and you repeat that to the edge.',
  achieved: mateAchieved('ladder-mate'),
  building: (pos, side) => {
    const heavy = pieces(pos, side).filter(p => 'rq'.includes(p.type));
    if (heavy.length < 2) return null;
    const k = kingSq(pos, other(side));
    return [
      step('You have two rooks or rook and queen', true),
      step('The enemy king has few defenders nearby', pieces(pos, other(side)).filter(p => p.type !== 'k' && cheb(p.square, k) <= 2).length <= 1),
      step('One heavy piece already cuts the king off on a rank or file', heavy.some(h => Math.abs(rankOf(h.square) - rankOf(k)) === 1 || Math.abs(fileOf(h.square) - fileOf(k)) === 1)),
    ];
  } });
add({ id: 'box-mate', family: 'mate',
  plan: 'Rook and king against a lone king. Use the rook as a fence, walk your king up to take the opposition, then check to push the king back, all the way to the edge.',
  achieved: mateAchieved('box-mate'),
  building: (pos, side) => {
    if (pieces(pos, other(side)).length !== 1 || !has(pos, side, 'r') || has(pos, side, 'q')) return null;
    const k = kingSq(pos, other(side));
    return [
      step('The enemy has only its king left', true),
      step('The enemy king is on the edge', onEdge(k)),
      step('Your king stands two squares from it, in opposition', kingDistance(pos, side) === 2),
    ];
  } });
add({ id: 'queen-king-mate', family: 'mate',
  plan: 'Queen and king against a lone king. Shrink the box with the queen a knight’s move away from the king, bring your king up, and mate on the edge. Watch for stalemate.',
  achieved: mateAchieved('queen-king-mate'),
  building: (pos, side) => {
    if (pieces(pos, other(side)).length !== 1 || !has(pos, side, 'q')) return null;
    const k = kingSq(pos, other(side));
    return [
      step('The enemy has only its king left', true),
      step('The enemy king is on the edge', onEdge(k)),
      step('Your king is close enough to help', kingDistance(pos, side) <= 2),
    ];
  } });
add({ id: 'bishop-knight-mate', family: 'mate',
  plan: 'Drive the king to the corner that matches your bishop’s color. The knight makes a W shape along the edge. It takes up to 34 moves.',
  achieved: mateAchieved('bishop-knight-mate'),
  building: (pos, side) => {
    if (pieces(pos, other(side)).length !== 1 || pieces(pos, side).length !== 3 || !has(pos, side, 'b') || !has(pos, side, 'n')) return null;
    const k = kingSq(pos, other(side)), bcol = sqColor(pieces(pos, side, 'b')[0].square);
    const goodCorner = ['a1','h1','a8','h8'].filter(c => sqColor(c) === bcol);
    return [
      step('Bishop and knight against a lone king', true),
      step('The enemy king is on the edge', onEdge(k)),
      step('It is being pushed toward the corner of your bishop’s color', goodCorner.some(c => cheb(c, k) <= 2)),
    ];
  } });
add({ id: 'two-bishops-mate', family: 'mate',
  plan: 'Keep the bishops side by side so they build a wall of two diagonals, bring your king up, and squeeze the lone king into a corner.',
  achieved: mateAchieved('two-bishops-mate'),
  building: (pos, side) => {
    if (pieces(pos, other(side)).length !== 1 || pieces(pos, side).length !== 3 || !has(pos, side, 'b', 2)) return null;
    const k = kingSq(pos, other(side)), bs = pieces(pos, side, 'b');
    return [
      step('Two bishops against a lone king', true),
      step('The bishops stand side by side', cheb(bs[0].square, bs[1].square) === 1),
      step('The enemy king is on the edge', onEdge(k)),
    ];
  } });
add({ id: 'legal-mate', family: 'mate',
  plan: 'When a bishop pins your knight to your queen, check whether Nxe5 works anyway. If they take the queen, Bxf7+ and Nd5 is mate.',
  achieved: mateAchieved('legal-mate'),
  building: (pos, side) => {
    if (!has(pos, side, 'n', 2) || !has(pos, side, 'b') || !kingInCenter(pos, other(side))) return null;
    const f7 = R(side, 'f7'), e5 = R(side, 'e5'), d5 = R(side, 'd5');
    return [
      step('The enemy king is still in the center', true),
      step('A bishop aims at f7', aims(pos, side, 'b', f7)),
      step('A knight can take on e5', canReach(pos, side, 'n', e5) && (vPawn(pos, side, e5) || empty(pos, e5))),
      step('The other knight can reach d5', canReach(pos, side, 'n', d5)),
    ];
  } });
add({ id: 'reti-mate', family: 'mate',
  plan: 'When the king is crowded by its own pieces, a bishop check backed by a rook on the same file can be mate. Réti did it in eleven moves.',
  achieved: mateAchieved('reti-mate'),
  building: (pos, side) => {
    if (!has(pos, side, 'b') || !(has(pos, side, 'r') || has(pos, side, 'q'))) return null;
    const k = kingSq(pos, other(side));
    return [
      step('The enemy king is crowded by three or more of its own men', neighbors(k).filter(sq => isOwn(pos, sq, other(side))).length >= 3),
      step('A bishop can check it', neighbors(k).some(sq => aims(pos, side, 'b', sq) && diagAdjacent(sq, k))),
      step('A rook or queen protects the checking square', neighbors(k).some(sq => diagAdjacent(sq, k) && aims(pos, side, 'b', sq) && (attacked(pos, sq, side, 'r') || attacked(pos, sq, side, 'q')))),
    ];
  } });
add({ id: 'mayet-mate', family: 'mate',
  plan: 'Bishop on the long diagonal, then a rook lands on h8 next to the king. The bishop protects it from far away.',
  achieved: mateAchieved('mayet-mate'),
  building: (pos, side) => {
    if (!has(pos, side, 'b') || !has(pos, side, 'r') || !shortCastled(pos, side)) return null;
    const h8 = R(side, 'h8');
    return [
      step('The enemy king has castled short', true),
      step('A bishop aims at h8 along the long diagonal', aims(pos, side, 'b', h8)),
      step('A rook can reach the h-file', pieces(pos, side, 'r').some(r => fileOf(r.square) === 7) || [1,2,3,4,5,6,7,8].some(n => aims(pos, side, 'r', 'h' + n))),
      step('The h-file is open', !vPawn(pos, side, R(side, 'h7'))),
    ];
  } });
add({ id: 'anderssen-mate', family: 'mate',
  plan: 'Push a pawn to the seventh next to the king, protect it, and land a rook or queen on the back rank behind it.',
  achieved: mateAchieved('anderssen-mate'),
  building: (pos, side) => {
    if (!vBackRank(pos, side) || !(has(pos, side, 'r') || has(pos, side, 'q'))) return null;
    const seventh = relRank(side, 7);
    return [
      step('The enemy king is on its back rank', true),
      step('One of your pawns has reached the seventh rank', pieces(pos, side, 'p').some(p => rankOf(p.square) === seventh)),
      step('A rook or queen aims at the back rank', heavyAimsAtBackRank(pos, side)),
    ];
  } });
add({ id: 'vukovic-mate', family: 'mate',
  plan: 'With the king on the edge, a knight covers the escape squares while a rook, protected by your king or a pawn, checks from next door.',
  achieved: mateAchieved('vukovic-mate'),
  building: (pos, side) => {
    if (!has(pos, side, 'r') || !has(pos, side, 'n')) return null;
    const k = kingSq(pos, other(side));
    return [
      step('The enemy king is on the edge', onEdge(k)),
      step('A knight covers squares next to the king', neighbors(k).some(sq => attacked(pos, sq, side, 'n'))),
      step('A rook can check from next to the king with protection', neighbors(k).some(sq => aims(pos, side, 'r', sq) && (attacked(pos, sq, side, 'k') || attacked(pos, sq, side, 'p')))),
    ];
  } });
add({ id: 'balestra-mate', family: 'mate',
  plan: 'The queen takes the king’s file and diagonal from a distance, and a bishop finishes with the check.',
  achieved: mateAchieved('balestra-mate'),
  building: (pos, side) => {
    if (!has(pos, side, 'q') || !has(pos, side, 'b')) return null;
    const k = kingSq(pos, other(side));
    return [
      step('Your queen already covers two squares next to the enemy king', neighbors(k).filter(sq => attacked(pos, sq, side, 'q')).length >= 2),
      step('A bishop can give check', neighbors(k).some(sq => diagAdjacent(sq, k) && aims(pos, side, 'b', sq)) || attackersOf(pos, k, side, 'b').length > 0),
    ];
  } });
add({ id: 'suffocation-mate', family: 'mate',
  plan: 'A bishop takes the king’s escape squares along a diagonal, and a knight check does the rest.',
  achieved: mateAchieved('suffocation-mate'),
  building: (pos, side) => {
    if (!has(pos, side, 'n') || !has(pos, side, 'b')) return null;
    const k = kingSq(pos, other(side));
    return [
      step('A bishop covers squares next to the enemy king', neighbors(k).some(sq => attacked(pos, sq, side, 'b'))),
      step('A knight stands within two squares of the king', pieces(pos, side, 'n').some(n => cheb(n.square, k) <= 2)),
      step('The king is crowded by its own pieces', neighbors(k).filter(sq => isOwn(pos, sq, other(side))).length >= 2),
    ];
  } });
add({ id: 'david-goliath-mate', family: 'mate',
  plan: 'Rare and funny, because the pawn gives the mate. It needs the king trapped by its own pawns and your pieces covering the rest.',
  achieved: mateAchieved('david-goliath-mate'),
  building: () => null });
add({ id: 'blackburne-mate', family: 'mate',
  plan: 'Knight on g5, one bishop on the long diagonal, and the other bishop lands on h7 with check. Often a queen sacrifice opens the way.',
  achieved: mateAchieved('blackburne-mate'),
  building: (pos, side) => {
    if (!has(pos, side, 'b', 2) || !has(pos, side, 'n') || !shortCastled(pos, side)) return null;
    return [
      step('The enemy king has castled short', true),
      step('A knight sits on or can reach g5', canReach(pos, side, 'n', R(side, 'g5'))),
      step('A bishop aims along the long diagonal at g7', aims(pos, side, 'b', R(side, 'g7'))),
      step('The other bishop aims at h7', aims(pos, side, 'b', R(side, 'h7'))),
    ];
  } });

/* ---------- attacking plans ---------- */
add({ id: 'greek-gift', family: 'attack', name: 'Greek gift', lichess: null,
  blurb: 'The bishop sacrifice on h7. Bxh7+, Kxh7, Ng5+ and the queen comes to h5. The oldest attacking recipe against a castled king.',
  plan: 'Bishop on the b1-h7 diagonal, knight ready for g5, queen ready for h5, and no enemy knight on f6. Then give the bishop on h7.',
  achieved: (pos, side) => (pieceOn(pos, side, 'b', R(side, 'h7')) && pos.inCheck() && pos.turn() === other(side))
    || (pieceOn(pos, side, 'n', R(side, 'g5')) && pieceOn(pos, side, 'q', R(side, 'h5')) && !vPawn(pos, side, R(side, 'h7')) && shortCastled(pos, side)),
  building: (pos, side) => {
    if (!shortCastled(pos, side) || !has(pos, side, 'b') || !has(pos, side, 'n') || !has(pos, side, 'q')) return null;
    const h7 = R(side, 'h7'), g5 = R(side, 'g5'), h5 = R(side, 'h5'), f6 = R(side, 'f6');
    return [
      step('The enemy king has castled short with its h-pawn at home', vPawn(pos, side, h7)),
      step('A bishop aims at h7', aims(pos, side, 'b', h7), [h7]),
      step('A knight can jump to g5', canReach(pos, side, 'n', g5), [g5]),
      step('The queen can reach h5', canReach(pos, side, 'q', h5), [h5]),
      step('No enemy knight guards from f6', !pieceOn(pos, other(side), 'n', f6)),
    ];
  } });
add({ id: 'double-bishop-sacrifice', family: 'attack', name: 'Double bishop sacrifice', lichess: null,
  blurb: 'Lasker’s idea from 1889. One bishop goes on h7, the other on g7, and the bare king faces queen and rook.',
  plan: 'Both bishops aimed at the king’s pawns, queen ready to join on h5 or g4, and a rook that can lift to the third rank to finish.',
  achieved: (pos, side) => shortCastled(pos, side) && !vPawn(pos, side, R(side, 'g7')) && !vPawn(pos, side, R(side, 'h7')) && has(pos, side, 'q')
    && pieces(pos, side, 'q').some(q => cheb(q.square, kingSq(pos, other(side))) <= 2),
  building: (pos, side) => {
    if (!shortCastled(pos, side) || !has(pos, side, 'b', 2) || !has(pos, side, 'q')) return null;
    const g7 = R(side, 'g7'), h7 = R(side, 'h7');
    return [
      step('The enemy king has castled short', true),
      step('One bishop aims at h7', aims(pos, side, 'b', h7), [h7]),
      step('The other bishop aims at g7', aims(pos, side, 'b', g7), [g7]),
      step('The queen can reach h5 or g4', canReach(pos, side, 'q', R(side, 'h5')) || canReach(pos, side, 'q', R(side, 'g4'))),
      step('A rook can lift to the third rank', pieces(pos, side, 'r').some(r => rankOf(r.square) === relRank(side, 3)) || [0,1,2,3,4,5,6,7].some(f => aims(pos, side, 'r', mkSq(f, relRank(side, 3))))),
    ];
  } });
add({ id: 'rook-lift', family: 'attack', name: 'Rook lift', lichess: null,
  blurb: 'A rook climbs to the third rank and slides across to the g- or h-file, joining the attack in front of its own pawns.',
  plan: 'Move the pawn in front of the rook, bring the rook to the third rank, then swing it over to the file next to the enemy king.',
  achieved: (pos, side) => shortCastled(pos, side) && pieces(pos, side, 'r').some(r => fileOf(r.square) >= 6 && rankOf(r.square) >= relRank(side, 3) && rankOf(r.square) !== homeRank(side) && (side === 'w' ? rankOf(r.square) <= 6 : rankOf(r.square) >= 3)),
  building: (pos, side) => {
    if (!shortCastled(pos, side) || !has(pos, side, 'r')) return null;
    const third = relRank(side, 3);
    const lifted = pieces(pos, side, 'r').filter(r => rankOf(r.square) !== homeRank(side));
    return [
      step('The enemy king has castled short', true),
      step('A rook has left the back rank', lifted.length > 0, lifted.map(r => r.square)),
      step('It stands on the third rank with the rank clear toward the king', lifted.some(r => rankOf(r.square) === third && [6, 7].some(f => attackersOf(pos, mkSq(f, third), side, 'r').includes(r.square)))),
      step('Queen or bishop already point at the king', zoneHits(pos, side) >= 1),
    ];
  } });
add({ id: 'pawn-storm-opposite-castling', family: 'attack', name: 'Pawn storm', lichess: null,
  blurb: 'Kings castled on opposite sides. Whoever opens a file toward the enemy king first usually wins, so the pawns in front of your king are free to charge.',
  plan: 'Push the g- and h-pawns at the enemy king, trade to open a file, then bring rooks and queen down it.',
  achieved: (pos, side) => {
    const vk = kingSq(pos, other(side)), ak = kingSq(pos, side);
    if (!vk || !ak) return false;
    const vSide = fileOf(vk) >= 4 ? 'k' : 'q';
    const files = vSide === 'k' ? [5, 6, 7] : [0, 1, 2];
    return Math.abs(fileOf(vk) - fileOf(ak)) >= 3 && files.some(f => !pawnsOnFile(pos, f, side) && (!pawnsOnFile(pos, f, other(side)) || pieces(pos, side).some(p => 'rq'.includes(p.type) && fileOf(p.square) === f)));
  },
  building: (pos, side) => {
    const vk = kingSq(pos, other(side)), ak = kingSq(pos, side);
    if (!vk || !ak || Math.abs(fileOf(vk) - fileOf(ak)) < 3 || rankOf(vk) !== homeRank(other(side))) return null;
    const kingside = fileOf(vk) >= 4;
    const files = kingside ? [5, 6, 7] : [0, 1, 2];
    const stormers = pieces(pos, side, 'p').filter(p => files.includes(fileOf(p.square)));
    const far = stormers.filter(p => Math.abs(rankOf(p.square) - homeRank(side)) >= 3);
    return [
      step('The kings are castled on opposite sides', true),
      step('Your pawns on that wing have started marching', far.length >= 1, far.map(p => p.square)),
      step('Two of them are past the middle of the board', far.length >= 2),
      step('A file toward the king is open or half-open', files.some(f => !pawnsOnFile(pos, f, side))),
      step('A rook or queen stands on that file', files.some(f => !pawnsOnFile(pos, f, side) && pieces(pos, side).some(p => 'rq'.includes(p.type) && fileOf(p.square) === f))),
    ];
  } });
add({ id: 'h-file-attack', family: 'attack', name: 'Open the h-file', lichess: null,
  blurb: 'Against a fianchetto king, play h4, h5, hxg6, and bring a rook or queen down the open h-file. Fischer called it “sac, sac, mate.”',
  plan: 'Push the h-pawn to h5, trade it on g6, trade the dark bishops if you can, then double on the h-file with queen and rook.',
  achieved: (pos, side) => shortCastled(pos, side) && !pawnsOnFile(pos, 7, side) && !pawnsOnFile(pos, 7, other(side))
    && pieces(pos, side).some(p => 'rq'.includes(p.type) && fileOf(p.square) === 7),
  building: (pos, side) => {
    if (!vFianchetto(pos, side)) return null;
    const hp = pieces(pos, side, 'p').find(p => fileOf(p.square) === 7);
    return [
      step('The enemy king sits in a fianchetto', true),
      step('Your h-pawn has reached h5', hp ? Math.abs(rankOf(hp.square) - homeRank(side)) >= 4 : true, hp ? [hp.square] : []),
      step('The h-file is open', !pawnsOnFile(pos, 7, side) && !pawnsOnFile(pos, 7, other(side))),
      step('The enemy fianchetto bishop is gone', !pieceOn(pos, other(side), 'b', R(side, 'g7'))),
      step('A rook or queen stands on the h-file', pieces(pos, side).some(p => 'rq'.includes(p.type) && fileOf(p.square) === 7)),
    ];
  } });
add({ id: 'long-diagonal-battery', family: 'attack', name: 'Long-diagonal battery', lichess: null,
  blurb: 'Queen and bishop on the same long diagonal, both pointing at g7. Every move of the front piece is a threat.',
  plan: 'Put the bishop on the long diagonal aimed at g7, then line the queen up on the same diagonal in front of or behind it.',
  achieved: (pos, side) => {
    const q = pieces(pos, side, 'q'), b = pieces(pos, side, 'b');
    const vk = kingSq(pos, other(side));
    if (!vk) return false;
    const target = fileOf(vk) >= 4 ? R(side, 'g7') : R(side, 'b7');
    return q.some(qq => b.some(bb => sameLine(qq.square, bb.square) && diagSign(qq.square, bb.square) !== 0 && sameLine(qq.square, target) && sameLine(bb.square, target)
      && diagSign(qq.square, target) === diagSign(bb.square, target) && between(qq.square, bb.square).every(sq => empty(pos, sq))));
  },
  building: (pos, side) => {
    if (!has(pos, side, 'q') || !has(pos, side, 'b')) return null;
    const vk = kingSq(pos, other(side));
    if (!vk || rankOf(vk) !== homeRank(other(side))) return null;
    const target = fileOf(vk) >= 4 ? R(side, 'g7') : R(side, 'b7');
    return [
      step(`A bishop aims at ${target}`, aims(pos, side, 'b', target), [target]),
      step('The enemy fianchetto bishop is gone', !pieceOn(pos, other(side), 'b', target)),
      step(`The queen can join the diagonal toward ${target}`, aims(pos, side, 'q', target) || pieces(pos, side, 'q').some(q => sameLine(q.square, target) && diagSign(q.square, target) !== 0)),
    ];
  } });
add({ id: 'queen-knight-attack', family: 'attack', name: 'Queen and knight attack', lichess: null,
  blurb: 'Queen and knight are the deadliest pair near a king, because the knight covers the squares the queen cannot.',
  plan: 'Post the knight on f5, g5, or h5 near the enemy king, keep it protected, and bring the queen to the same side.',
  /* What makes a knight part of the attack is the squares it takes away, not how
     close it stands. A knight on f5 is three squares from a king on h8 by any
     ruler, and it is still the piece that costs the king g7 and h6. */
  achieved: (pos, side) => {
    const vk = kingSq(pos, other(side));
    if (!vk) return false;
    const zone = [vk, ...neighbors(vk)];
    return pieces(pos, side, 'n').some(n => zone.some(sq => attackersOf(pos, sq, side, 'n').includes(n.square))
        && attackersOf(pos, n.square, side).length > 0)
      && neighbors(vk).some(sq => attacked(pos, sq, side, 'q'));
  },
  building: (pos, side) => {
    if (!has(pos, side, 'q') || !has(pos, side, 'n')) return null;
    const vk = kingSq(pos, other(side));
    const zone = [vk, ...neighbors(vk)];
    const near = pieces(pos, side, 'n').filter(n => zone.some(sq => attackersOf(pos, sq, side, 'n').includes(n.square)));
    return [
      step('A knight covers a square next to the enemy king', near.length > 0, near.map(n => n.square)),
      step('That knight is protected', near.some(n => attackersOf(pos, n.square, side).length > 0)),
      step('The queen attacks a square next to the king', neighbors(vk).some(sq => attacked(pos, sq, side, 'q'))),
    ];
  } });
add({ id: 'alekhines-gun', family: 'attack', name: 'Alekhine’s gun', lichess: null,
  blurb: 'Rook, rook, queen stacked on one file, the queen at the back. Alekhine loaded it against Nimzowitsch in 1930.',
  plan: 'Double the rooks on the file that matters, then put the queen behind them so all three push together.',
  achieved: (pos, side) => {
    const rs = pieces(pos, side, 'r'), q = pieces(pos, side, 'q')[0];
    if (rs.length < 2 || !q) return false;
    return rs.some(a => rs.some(b => a !== b && fileOf(a.square) === fileOf(b.square) && fileOf(q.square) === fileOf(a.square)
      && (side === 'w' ? rankOf(q.square) < Math.min(rankOf(a.square), rankOf(b.square)) : rankOf(q.square) > Math.max(rankOf(a.square), rankOf(b.square)))));
  },
  building: (pos, side) => {
    if (!has(pos, side, 'r', 2) || !has(pos, side, 'q')) return null;
    const rs = pieces(pos, side, 'r');
    const doubled = rs.some(a => rs.some(b => a !== b && fileOf(a.square) === fileOf(b.square)));
    return [
      step('Two rooks stand on the same file', doubled),
      step('The queen can come behind them', doubled && rs.some(a => rs.some(b => a !== b && fileOf(a.square) === fileOf(b.square) && [1,2,3,4,5,6,7,8].some(n => aims(pos, side, 'q', FILES[fileOf(a.square)] + n))))),
    ];
  } });
add({ id: 'windmill', family: 'attack', name: 'Windmill', lichess: null,
  blurb: 'A rook gives check, steps aside to uncover a bishop check, and comes back to check again, eating a piece each turn. Torre did it to Lasker in 1925.',
  plan: 'Bishop on the long diagonal pointing at the king, a rook next to the king that blocks the bishop, and every rook move becomes a discovered check.',
  achieved: (pos, side) => {
    const vk = kingSq(pos, other(side));
    return !!vk && pieces(pos, side, 'b').some(b => sameLine(b.square, vk) && diagSign(b.square, vk) !== 0
      && between(b.square, vk).filter(sq => !empty(pos, sq)).length === 1 && between(b.square, vk).some(sq => isOwn(pos, sq, side, 'r') && adjacent(sq, vk)));
  },
  building: (pos, side) => {
    if (!has(pos, side, 'r') || !has(pos, side, 'b')) return null;
    const vk = kingSq(pos, other(side));
    const aimed = pieces(pos, side, 'b').filter(b => sameLine(b.square, vk) && diagSign(b.square, vk) !== 0);
    return [
      step('A bishop stands on a diagonal that leads to the enemy king', aimed.length > 0, aimed.map(b => b.square)),
      step('A rook stands next to the enemy king', pieces(pos, side, 'r').some(r => adjacent(r.square, vk))),
      step('The rook is the only piece between bishop and king', aimed.some(b => between(b.square, vk).filter(sq => !empty(pos, sq)).length === 1 && between(b.square, vk).some(sq => isOwn(pos, sq, side, 'r')))),
    ];
  } });
add({ id: 'rooks-on-seventh', family: 'attack', name: 'Rooks on the seventh', lichess: null,
  blurb: 'Two rooks on the seventh rank eat pawns and threaten mate. Capablanca called one rook there worth a pawn.',
  plan: 'Open a file, put a rook on the seventh rank behind the enemy pawns, then double with the second rook.',
  achieved: (pos, side) => pieces(pos, side, 'r').filter(r => rankOf(r.square) === relRank(side, 7)).length >= 2,
  building: (pos, side) => {
    if (!has(pos, side, 'r')) return null;
    const seventh = relRank(side, 7);
    const on7 = pieces(pos, side, 'r').filter(r => rankOf(r.square) === seventh);
    return [
      step('A file is open for a rook', [0,1,2,3,4,5,6,7].some(f => openFile(pos, f) || halfOpenFile(pos, f, side))),
      step('One rook has reached the seventh rank', on7.length >= 1, on7.map(r => r.square)),
      step('A second rook can join it', on7.length >= 2 || (has(pos, side, 'r', 2) && [0,1,2,3,4,5,6,7].some(f => aims(pos, side, 'r', mkSq(f, seventh))))),
    ];
  } });
add({ id: 'exchange-sac-c3', family: 'attack', name: 'Exchange sacrifice on c3', lichess: null,
  blurb: 'The Sicilian player gives a rook for the knight on c3. The pawns in front of the white king are wrecked and the long diagonal opens.',
  plan: 'Rook on the half-open c-file, the enemy king castled long, a knight on c3 to take, and a queen or bishop ready to hit c3 and b2 afterward.',
  /* the squares belong to the defender, so they are written on the defender's
     side of the board: c6/c7 in the attacker's frame is the enemy c3/c2 */
  achieved: (pos, side) => kingQueenside(pos, other(side)) && vPawn(pos, side, R(side, 'c6')) && vPawn(pos, side, R(side, 'c7')) && !pawnsOnFile(pos, 1, other(side)),
  building: (pos, side) => {
    if (!kingQueenside(pos, other(side)) || !has(pos, side, 'r')) return null;
    const c3 = R(side, 'c6'), b2 = R(side, 'b7');
    return [
      step('The enemy king has castled long', true),
      step('An enemy knight stands on c3', pieceOn(pos, other(side), 'n', c3), [c3]),
      step('Your rook stands on the half-open c-file', pieces(pos, side, 'r').some(r => fileOf(r.square) === 2) && !pawnsOnFile(pos, 2, side)),
      step('A queen or bishop can hit c3 or b2 afterward', aims(pos, side, 'q', c3) || aims(pos, side, 'b', c3) || aims(pos, side, 'q', b2) || aims(pos, side, 'b', b2)),
    ];
  } });
add({ id: 'f-pawn-lever', family: 'attack', name: 'f-pawn lever', lichess: null,
  blurb: 'The f-pawn advances to f5 and pries open the king’s cover. Karpov squeezed Unzicker this way in 1974.',
  plan: 'With the center locked, push the f-pawn to f4 and then f5, so that f5 or f6 rips the pawn shield in front of the castled king.',
  achieved: (pos, side) => shortCastled(pos, side) && (pieceOn(pos, side, 'p', R(side, 'f5')) || pieceOn(pos, side, 'p', R(side, 'f6'))),
  building: (pos, side) => {
    if (!shortCastled(pos, side)) return null;
    const fp = pieces(pos, side, 'p').find(p => fileOf(p.square) === 5);
    if (!fp) return null;
    return [
      step('The enemy king has castled short', true),
      step('Your e-pawn holds the center', pieceOn(pos, side, 'p', R(side, 'e4')) || pieceOn(pos, side, 'p', R(side, 'e5'))),
      step('The f-pawn has reached f4', Math.abs(rankOf(fp.square) - homeRank(side)) >= 3, [fp.square]),
      step('It can push to f5 next', pieceOn(pos, side, 'p', R(side, 'f4')) && empty(pos, R(side, 'f5'))),
    ];
  } });
add({ id: 'king-in-center-attack', family: 'attack', name: 'King in the center', lichess: null,
  blurb: 'A king that never castled is a target. Open the middle files and every check comes with a threat.',
  plan: 'Do not let the king castle. Open the e- or d-file, put a rook on it, and develop with threats so there is no time to run.',
  achieved: (pos, side) => kingInCenter(pos, other(side)) && [3, 4].some(f => (openFile(pos, f) || halfOpenFile(pos, f, side)) && pieces(pos, side).some(p => 'rq'.includes(p.type) && fileOf(p.square) === f)),
  building: (pos, side) => {
    if (!kingInCenter(pos, other(side))) return null;
    const rights = pos.getCastlingRights ? pos.getCastlingRights(other(side)) : { k: false, q: false };
    const canCastle = !!(rights.k || rights.q);
    return [
      step('The enemy king is still in the center', true),
      step('It can no longer castle', !canCastle),
      step('A central file is open or half-open', [3, 4].some(f => openFile(pos, f) || halfOpenFile(pos, f, side))),
      step('A rook or queen stands on that file', [3, 4].some(f => (openFile(pos, f) || halfOpenFile(pos, f, side)) && pieces(pos, side).some(p => 'rq'.includes(p.type) && fileOf(p.square) === f))),
    ];
  } });
add({ id: 'open-file-battery', family: 'attack', name: 'Doubled on an open file', lichess: null,
  blurb: 'Two rooks, or rook and queen, on the one open file. Whoever owns it gets to the seventh rank first.',
  plan: 'Find the file with no pawns, put one rook on it, then the second heavy piece behind it.',
  achieved: (pos, side) => [0,1,2,3,4,5,6,7].some(f => openFile(pos, f) && pieces(pos, side).filter(p => 'rq'.includes(p.type) && fileOf(p.square) === f).length >= 2),
  building: (pos, side) => {
    const open = [0,1,2,3,4,5,6,7].filter(f => openFile(pos, f));
    if (!open.length || !has(pos, side, 'r')) return null;
    return [
      step('An open file exists', true),
      step('A rook stands on it', open.some(f => pieces(pos, side, 'r').some(r => fileOf(r.square) === f))),
      step('A second rook or the queen can join', open.some(f => pieces(pos, side, 'r').some(r => fileOf(r.square) === f) && pieces(pos, side).some(p => 'rq'.includes(p.type) && fileOf(p.square) !== f && [1,2,3,4,5,6,7,8].some(n => aims(pos, side, p.type, FILES[f] + n))))),
    ];
  } });
add({ id: 'f7-strike', family: 'attack', name: 'Strike on f7', lichess: null,
  blurb: 'f7 is the weakest square at the start, guarded only by the king. Bishop plus knight sacrifices there drag the king into the open.',
  plan: 'Bishop on c4, knight to g5 or e5, and if only the king guards f7, take it and follow with checks.',
  /* the strike lands on f7 whether the king castled or not, and after Bxf7+ the
     king is usually dragged off its square, so the test is that one of our
     pieces stands on f7 with the king still next to it */
  achieved: (pos, side) => {
    const f7 = R(side, 'f7'), vk = kingSq(pos, other(side));
    return !!vk && (isOwn(pos, f7, side, 'b') || isOwn(pos, f7, side, 'n')) && cheb(f7, vk) <= 2;
  },
  building: (pos, side) => {
    if (!kingUncastled(pos, other(side)) && !shortCastled(pos, side)) return null;
    const f7 = R(side, 'f7');
    return [
      step('The enemy king is still near f7', true),
      step('A bishop aims at f7', aims(pos, side, 'b', f7), [f7]),
      step('A knight aims at f7', aims(pos, side, 'n', f7), [f7]),
      step('Only the king defends f7', attackersOf(pos, f7, other(side)).every(sq => (pos.get(sq) || {}).type === 'k')),
    ];
  } });

/* ---------- positional ideas ---------- */
add({ id: 'knight-outpost', family: 'positional', name: 'Knight outpost', lichess: null,
  blurb: 'A knight on a square no enemy pawn can ever attack, held there by your own pawn. Kasparov’s octopus on d3.',
  plan: 'Find a square on the fifth or sixth rank that enemy pawns can never reach, protect it with a pawn, and bring the knight there.',
  /* An outpost is a square no enemy pawn can ever attack. A pawn holding it is
     the ideal and makes it permanent, but Kasparov's octopus knight on d3 was
     held by a bishop, so any defender counts and the pawn is a separate step. */
  achieved: (pos, side) => pieces(pos, side, 'n').some(n => Math.abs(rankOf(n.square) - homeRank(side)) >= 4
    && unassailable(pos, n.square, side) && attackersOf(pos, n.square, side).length > 0),
  building: (pos, side) => {
    if (!has(pos, side, 'n')) return null;
    const posts = [];
    for (let f = 0; f < 8; f++) for (const r of [5, 6]) {
      const sq = mkSq(f, relRank(side, r));
      if (unassailable(pos, sq, side) && attacked(pos, sq, side) && !isOwn(pos, sq, other(side), 'p')) posts.push(sq);
    }
    if (!posts.length) return null;
    return [
      step(`An outpost square exists (${posts.join(', ')})`, true, posts),
      step('A knight can reach it', posts.some(sq => canReach(pos, side, 'n', sq))),
      step('A knight sits on it', posts.some(sq => pieceOn(pos, side, 'n', sq))),
      step('One of your pawns holds the square, which makes it permanent',
        posts.some(sq => pieceOn(pos, side, 'n', sq) && attacked(pos, sq, side, 'p'))),
    ];
  } });
add({ id: 'bishop-pair', family: 'positional', name: 'Bishop pair', lichess: null,
  blurb: 'Two bishops against bishop and knight, in an open position, are worth about half a pawn. They cover both colors.',
  plan: 'Trade a knight for one of the enemy bishops, then open the position with pawn trades so your two bishops see the whole board.',
  achieved: (pos, side) => has(pos, side, 'b', 2) && count(pos, other(side), 'b') <= 1 && pieces(pos, 'w', 'p').length + pieces(pos, 'b', 'p').length <= 12,
  building: (pos, side) => {
    if (!has(pos, side, 'b', 2)) return null;
    return [
      step('You still have both bishops', true),
      step('The other side has lost one of theirs', count(pos, other(side), 'b') <= 1),
      step('The position is open (twelve pawns or fewer)', pieces(pos, 'w', 'p').length + pieces(pos, 'b', 'p').length <= 12),
    ];
  } });
add({ id: 'good-vs-bad-bishop', family: 'positional', name: 'Good bishop against bad bishop', lichess: null,
  blurb: 'A bishop stuck behind its own pawns is a tall pawn. Keep your pawns off your bishop’s color, and fix theirs on their bishop’s color.',
  plan: 'Put your pawns on the opposite color of your bishop, trade the pieces that are not bishops, and lock the enemy pawns on the color of theirs.',
  achieved: (pos, side) => {
    const vb = pieces(pos, other(side), 'b');
    if (vb.length !== 1 || count(pos, side, 'b') + count(pos, side, 'n') === 0) return false;
    const col = sqColor(vb[0].square);
    const bad = pieces(pos, other(side), 'p').filter(p => sqColor(p.square) === col).length;
    if (bad < 4) return false;
    /* the comparison is how blocked each bishop is by its OWN pawns, so a
       bishop of the same color as theirs still counts when ours is the free one */
    return pieces(pos, side, 'b').every(b =>
      pieces(pos, side, 'p').filter(p => sqColor(p.square) === sqColor(b.square)).length < bad);
  },
  building: (pos, side) => {
    const vb = pieces(pos, other(side), 'b');
    if (vb.length !== 1) return null;
    const col = sqColor(vb[0].square);
    const bad = pieces(pos, other(side), 'p').filter(p => sqColor(p.square) === col).length;
    return [
      step(`The enemy has one bishop, on ${col} squares`, true),
      step(`Their pawns stand on ${col} squares too (${bad})`, bad >= 4),
      step('Your own bishop is freer than theirs', pieces(pos, side, 'b').every(b =>
        pieces(pos, side, 'p').filter(p => sqColor(p.square) === sqColor(b.square)).length < bad)),
    ];
  } });
add({ id: 'opposite-colored-bishops-attack', family: 'positional', name: 'Opposite-colored bishops attack', lichess: null,
  blurb: 'With queens on, opposite-colored bishops favor the attacker, because the defender’s bishop can never guard the squares yours attacks.',
  plan: 'Keep the queens on, aim your bishop at the enemy king, and attack on your bishop’s color where their bishop cannot help.',
  achieved: (pos, side) => {
    const a = pieces(pos, side, 'b'), b = pieces(pos, other(side), 'b');
    return a.length === 1 && b.length === 1 && sqColor(a[0].square) !== sqColor(b[0].square) && has(pos, side, 'q') && zoneHits(pos, side) >= 1;
  },
  building: (pos, side) => {
    const a = pieces(pos, side, 'b'), b = pieces(pos, other(side), 'b');
    if (a.length !== 1 || b.length !== 1 || sqColor(a[0].square) === sqColor(b[0].square)) return null;
    return [
      step('The bishops move on opposite colors', true),
      step('Queens are still on the board', has(pos, side, 'q')),
      step('Your bishop and queen aim at the enemy king’s squares', zoneHits(pos, side) >= 1),
    ];
  } });
add({ id: 'iqp-attack', family: 'positional', name: 'Isolated queen’s pawn attack', lichess: null,
  blurb: 'The isolated d-pawn is weak in the endgame but strong in the middlegame, because it gives space, the e5 square, and open files for an attack.',
  plan: 'Use the open lines. Knight to e5, rooks on the e- and d-files, queen toward the kingside, and look for the d4-d5 push at the right moment.',
  achieved: (pos, side) => pieces(pos, side, 'p').some(p => fileOf(p.square) === 3 && isIsolatedPawn(pos, p.square, side))
    && (pieceOn(pos, side, 'n', R(side, 'e5')) || pieces(pos, side, 'r').some(r => fileOf(r.square) === 4)) && has(pos, side, 'q'),
  building: (pos, side) => {
    const iqp = pieces(pos, side, 'p').find(p => fileOf(p.square) === 3 && isIsolatedPawn(pos, p.square, side));
    if (!iqp) return null;
    return [
      step('You have an isolated d-pawn', true, [iqp.square]),
      step('A knight can use the e5 outpost', canReach(pos, side, 'n', R(side, 'e5'))),
      step('A rook stands on the e-file', pieces(pos, side, 'r').some(r => fileOf(r.square) === 4)),
      step('Queens are still on', has(pos, side, 'q')),
    ];
  } });
add({ id: 'iqp-blockade', family: 'positional', name: 'Blockade the isolated pawn', lichess: null,
  blurb: 'Against an isolated pawn, put a knight on the square in front of it, trade pieces, and win the pawn in the endgame.',
  plan: 'Occupy d5 (or d4) with a knight, trade minor pieces so the attack fades, then attack the pawn with rooks and queen.',
  achieved: (pos, side) => {
    const iqp = pieces(pos, other(side), 'p').find(p => fileOf(p.square) === 3 && isIsolatedPawn(pos, p.square, other(side)));
    if (!iqp) return false;
    const front = mkSq(3, rankOf(iqp.square) + fwd(other(side)));
    return isOwn(pos, front, side, 'n') || isOwn(pos, front, side, 'b') || isOwn(pos, front, side, 'q');
  },
  building: (pos, side) => {
    const iqp = pieces(pos, other(side), 'p').find(p => fileOf(p.square) === 3 && isIsolatedPawn(pos, p.square, other(side)));
    if (!iqp) return null;
    const front = mkSq(3, rankOf(iqp.square) + fwd(other(side)));
    return [
      step('The enemy has an isolated d-pawn', true, [iqp.square]),
      step(`A piece of yours can reach ${front}`, canReach(pos, side, 'n', front) || canReach(pos, side, 'b', front) || canReach(pos, side, 'q', front), [front]),
      step('Minor pieces have been traded', count(pos, side, 'n') + count(pos, side, 'b') <= 2),
      step('The pawn is attacked more than it is defended', attackersOf(pos, iqp.square, side).length > attackersOf(pos, iqp.square, other(side)).length),
    ];
  } });
add({ id: 'hanging-pawns', family: 'positional', name: 'Hanging pawns', lichess: null,
  blurb: 'Two pawns side by side on c4 and d4 with no neighbors. They give space and threaten to advance, but must be watched.',
  plan: 'Keep them together, prepare the d5 or c5 advance with pieces behind them, and never let one be blocked and the other attacked.',
  achieved: (pos, side) => [4, 5].some(r => pieceOn(pos, side, 'p', mkSq(2, relRank(side, r))) && pieceOn(pos, side, 'p', mkSq(3, relRank(side, r))) && !pawnsOnFile(pos, 1, side) && !pawnsOnFile(pos, 4, side)),
  building: () => null });
add({ id: 'doubled-pawns-target', family: 'positional', name: 'Target the doubled pawns', lichess: null,
  blurb: 'Doubled pawns cannot defend each other. Blockade the front one and attack the back one.',
  plan: 'Find the file with two enemy pawns, put a piece in front of them, and bring a rook to the half-open file behind.',
  achieved: (pos, side) => [0,1,2,3,4,5,6,7].some(f => pawnsOnFile(pos, f, other(side)) >= 2 && pieces(pos, side).some(p => 'rq'.includes(p.type) && fileOf(p.square) === f)),
  building: (pos, side) => {
    const files = [0,1,2,3,4,5,6,7].filter(f => pawnsOnFile(pos, f, other(side)) >= 2);
    if (!files.length) return null;
    return [
      step(`The enemy has doubled pawns on the ${files.map(f => FILES[f]).join(' and ')} file`, true),
      step('The file is half-open for you', files.some(f => !pawnsOnFile(pos, f, side))),
      step('A rook or queen stands on it', files.some(f => pieces(pos, side).some(p => 'rq'.includes(p.type) && fileOf(p.square) === f))),
    ];
  } });
add({ id: 'backward-pawn-target', family: 'positional', name: 'Target the backward pawn', lichess: null,
  blurb: 'A pawn that cannot advance and has no neighbor behind it is a fixed target on a half-open file.',
  plan: 'Control the square in front of the backward pawn, then pile rooks and queen on its file.',
  achieved: (pos, side) => backwardPawns(pos, other(side)).some(sq => !pawnsOnFile(pos, fileOf(sq), side) && (attacked(pos, sq, side, 'r') || attacked(pos, sq, side, 'q'))),
  building: (pos, side) => {
    const targets = backwardPawns(pos, other(side)).filter(sq => !pawnsOnFile(pos, fileOf(sq), side));
    if (!targets.length) return null;
    return [
      step(`The enemy has a backward pawn on ${targets.join(', ')}`, true, targets),
      step('The square in front of it is under your control', targets.some(sq => attacked(pos, mkSq(fileOf(sq), rankOf(sq) + fwd(other(side))), side))),
      step('A rook or queen attacks it', targets.some(sq => attacked(pos, sq, side, 'r') || attacked(pos, sq, side, 'q'))),
    ];
  } });
function backwardPawns(pos, color) {
  const out = [];
  for (const p of pieces(pos, color, 'p')) {
    const f = fileOf(p.square), r = rankOf(p.square), d = fwd(color);
    const front = mkSq(f, r + d);
    if (!front) continue;
    const support = [-1, 1].some(df => { for (let rr = r; rr >= 1 && rr <= 8; rr -= d) if (isOwn(pos, mkSq(f + df, rr), color, 'p')) return true; return false; });
    if (!support && attacked(pos, front, other(color), 'p')) out.push(p.square);
  }
  return out;
}
add({ id: 'pawn-islands', family: 'positional', name: 'Fewer pawn islands', lichess: null,
  blurb: 'Pawns in one group defend each other. The side with fewer islands has fewer weaknesses to defend in the endgame.',
  plan: 'Avoid pawn trades that split your pawns, and make trades that split theirs, then head for the endgame.',
  achieved: (pos, side) => pawnIslands(pos, side) < pawnIslands(pos, other(side)),
  building: () => null });
add({ id: 'passed-pawn', family: 'positional', name: 'Passed pawn', lichess: null,
  blurb: 'A pawn with no enemy pawn in front or beside it. A passed pawn must be pushed, said Nimzowitsch, and it gets stronger with every step.',
  plan: 'Create one from your pawn majority, then advance it with a rook behind it and the king close by.',
  achieved: (pos, side) => passedPawns(pos, side).some(p => Math.abs(rankOf(p.square) - homeRank(side)) >= 4),
  building: (pos, side) => {
    const pp = passedPawns(pos, side);
    const qmaj = wingPawns(pos, side, true) > wingPawns(pos, other(side), true), kmaj = wingPawns(pos, side, false) > wingPawns(pos, other(side), false);
    if (!pp.length && !qmaj && !kmaj) return null;
    return [
      step('You have a pawn majority on one wing', qmaj || kmaj),
      step('You have a passed pawn', pp.length > 0, pp.map(p => p.square)),
      step('It has reached the fifth rank or beyond', pp.some(p => Math.abs(rankOf(p.square) - homeRank(side)) >= 4)),
      step('A rook stands behind it', pp.some(p => pieces(pos, side, 'r').some(r => fileOf(r.square) === fileOf(p.square) && (side === 'w' ? rankOf(r.square) < rankOf(p.square) : rankOf(r.square) > rankOf(p.square))))),
    ];
  } });
add({ id: 'protected-passed-pawn', family: 'positional', name: 'Protected passed pawn', lichess: null,
  blurb: 'A passed pawn guarded by another pawn. No piece can ever win it, so it ties the enemy down for the rest of the game.',
  plan: 'Advance a passed pawn only as far as a neighboring pawn can guard it, then use the tied-down enemy pieces elsewhere.',
  achieved: (pos, side) => passedPawns(pos, side).some(p => attacked(pos, p.square, side, 'p')),
  building: (pos, side) => {
    const pp = passedPawns(pos, side);
    if (!pp.length) return null;
    return [
      step('You have a passed pawn', true, pp.map(p => p.square)),
      step('A pawn of yours stands on the neighboring file behind it', pp.some(p => [-1, 1].some(df => [1, 2].some(back => isOwn(pos, mkSq(fileOf(p.square) + df, rankOf(p.square) - back * fwd(side)), side, 'p'))))),
      step('The passed pawn is protected by a pawn', pp.some(p => attacked(pos, p.square, side, 'p'))),
    ];
  } });
add({ id: 'outside-passed-pawn', family: 'positional', name: 'Outside passed pawn', lichess: null,
  blurb: 'In an endgame, a passed pawn far from the kings is a decoy. The enemy king must go and catch it while yours eats the other pawns.',
  plan: 'In a pawn or minor-piece endgame, create the passed pawn on the wing away from the kings and push it to pull the enemy king away.',
  achieved: (pos, side) => isEndgame(pos) && passedPawns(pos, side).some(p => cheb(p.square, kingSq(pos, other(side))) >= 3 && Math.abs(fileOf(p.square) - fileOf(kingSq(pos, other(side)))) >= 3),
  building: (pos, side) => {
    if (!isEndgame(pos)) return null;
    const pp = passedPawns(pos, side);
    const qmaj = wingPawns(pos, side, true) > wingPawns(pos, other(side), true), kmaj = wingPawns(pos, side, false) > wingPawns(pos, other(side), false);
    if (!pp.length && !qmaj && !kmaj) return null;
    return [
      step('It is an endgame', true),
      step('You have a passed pawn', pp.length > 0, pp.map(p => p.square)),
      step('It is far from the enemy king', pp.some(p => Math.abs(fileOf(p.square) - fileOf(kingSq(pos, other(side)))) >= 3)),
    ];
  } });
add({ id: 'blockade', family: 'positional', name: 'Blockade', lichess: null,
  blurb: 'A piece sitting right in front of an enemy passed or isolated pawn stops it for good. The knight is the best blockader.',
  plan: 'Find the enemy passed or isolated pawn, control the square in front of it, and park a knight there.',
  achieved: (pos, side) => pieces(pos, other(side), 'p').filter(p => isPassedPawn(pos, p.square, other(side)) || isIsolatedPawn(pos, p.square, other(side)))
    .some(p => isOwn(pos, mkSq(fileOf(p.square), rankOf(p.square) + fwd(other(side))), side) && !isOwn(pos, mkSq(fileOf(p.square), rankOf(p.square) + fwd(other(side))), side, 'p')),
  building: (pos, side) => {
    const targets = pieces(pos, other(side), 'p').filter(p => isPassedPawn(pos, p.square, other(side)) || isIsolatedPawn(pos, p.square, other(side)));
    if (!targets.length) return null;
    const fronts = targets.map(p => mkSq(fileOf(p.square), rankOf(p.square) + fwd(other(side)))).filter(Boolean);
    return [
      step('The enemy has a passed or isolated pawn', true, targets.map(p => p.square)),
      step('You control the square in front of it', fronts.some(sq => attacked(pos, sq, side))),
      step('A knight can reach that square', fronts.some(sq => canReach(pos, side, 'n', sq))),
      step('A piece sits on it', fronts.some(sq => isOwn(pos, sq, side) && !isOwn(pos, sq, side, 'p'))),
    ];
  } });
add({ id: 'open-file-control', family: 'positional', name: 'Open file', lichess: null,
  blurb: 'A rook on the only open file is a highway to the seventh rank. Take it before the other side does.',
  plan: 'Put a rook on the file with no pawns, keep an enemy rook from trading on it, and use it to reach the seventh.',
  achieved: (pos, side) => [0,1,2,3,4,5,6,7].some(f => openFile(pos, f) && pieces(pos, side, 'r').some(r => fileOf(r.square) === f) && !pieces(pos, other(side)).some(p => 'rq'.includes(p.type) && fileOf(p.square) === f)),
  building: (pos, side) => {
    const open = [0,1,2,3,4,5,6,7].filter(f => openFile(pos, f));
    if (!open.length || !has(pos, side, 'r')) return null;
    return [
      step(`The ${open.map(f => FILES[f]).join(' and ')} file is open`, true),
      step('A rook can reach it', open.some(f => [1,2,3,4,5,6,7,8].some(n => aims(pos, side, 'r', FILES[f] + n)))),
      step('Your rook stands on it', open.some(f => pieces(pos, side, 'r').some(r => fileOf(r.square) === f))),
      step('No enemy rook or queen contests it', open.some(f => pieces(pos, side, 'r').some(r => fileOf(r.square) === f) && !pieces(pos, other(side)).some(p => 'rq'.includes(p.type) && fileOf(p.square) === f))),
    ];
  } });
add({ id: 'doubled-rooks', family: 'positional', name: 'Doubled rooks', lichess: null,
  blurb: 'Two rooks on one file protect each other and hit twice as hard.',
  plan: 'Put one rook on the useful file, then the other behind it with nothing in between.',
  achieved: (pos, side) => { const rs = pieces(pos, side, 'r'); return rs.length >= 2 && rs.some(a => rs.some(b => a !== b && fileOf(a.square) === fileOf(b.square) && between(a.square, b.square).every(sq => empty(pos, sq)))); },
  building: (pos, side) => {
    if (!has(pos, side, 'r', 2)) return null;
    const rs = pieces(pos, side, 'r');
    return [
      step('You have two rooks', true),
      step('One stands on an open or half-open file', rs.some(r => openFile(pos, fileOf(r.square)) || halfOpenFile(pos, fileOf(r.square), side))),
      step('The other can join it on that file', rs.some(a => rs.some(b => a !== b && [1,2,3,4,5,6,7,8].some(n => aims(pos, side, 'r', FILES[fileOf(a.square)] + n) && attackersOf(pos, FILES[fileOf(a.square)] + n, side, 'r').includes(b.square))))),
    ];
  } });
add({ id: 'half-open-file-pressure', family: 'positional', name: 'Half-open file pressure', lichess: null,
  blurb: 'Your rook on a file where only the enemy has a pawn. That pawn becomes a fixed target.',
  plan: 'Find the file where your pawn is gone and theirs remains, put a rook on it, and add a second attacker.',
  achieved: (pos, side) => [0,1,2,3,4,5,6,7].some(f => halfOpenFile(pos, f, side) && pieces(pos, side).some(p => 'rq'.includes(p.type) && fileOf(p.square) === f && pieces(pos, other(side), 'p').some(pw => fileOf(pw.square) === f && attackersOf(pos, pw.square, side).includes(p.square)))),
  building: (pos, side) => {
    const half = [0,1,2,3,4,5,6,7].filter(f => halfOpenFile(pos, f, side));
    if (!half.length || !has(pos, side, 'r')) return null;
    return [
      step(`The ${half.map(f => FILES[f]).join(', ')} file is half-open for you`, true),
      step('A rook stands on it', half.some(f => pieces(pos, side, 'r').some(r => fileOf(r.square) === f))),
      step('It attacks the enemy pawn on that file', half.some(f => pieces(pos, other(side), 'p').some(pw => fileOf(pw.square) === f && (attacked(pos, pw.square, side, 'r') || attacked(pos, pw.square, side, 'q'))))),
    ];
  } });
add({ id: 'space-advantage', family: 'positional', name: 'Space advantage', lichess: null,
  blurb: 'Pawns on the fifth rank cramp the enemy pieces. With less room, they get in each other’s way.',
  plan: 'Advance center pawns to the fifth rank while keeping them protected, then improve your pieces behind them and wait for the squeeze.',
  achieved: (pos, side) => spaceScore(pos, side) - spaceScore(pos, other(side)) >= 6 && pieces(pos, side, 'p').filter(p => Math.abs(rankOf(p.square) - homeRank(side)) >= 4).length >= 2,
  building: (pos, side) => {
    const adv = pieces(pos, side, 'p').filter(p => Math.abs(rankOf(p.square) - homeRank(side)) >= 4);
    if (spaceScore(pos, side) <= spaceScore(pos, other(side))) return null;
    return [
      step('Your pawns stand farther forward than theirs', true),
      step('Two pawns have crossed the middle of the board', adv.length >= 2, adv.map(p => p.square)),
      step('They are protected', adv.every(p => attacked(pos, p.square, side))),
    ];
  } });
const spaceScore = (pos, side) => pieces(pos, side, 'p').reduce((s, p) => s + Math.abs(rankOf(p.square) - homeRank(side)) - 1, 0);
add({ id: 'pawn-chain-base', family: 'positional', name: 'Attack the base of the chain', lichess: null,
  blurb: 'A pawn chain is only as strong as its base. Attack the pawn at the bottom of the chain, not the tip.',
  plan: 'Find the enemy pawn chain, aim a pawn lever at its base (like ...c5 against d4 in the French), and pile pieces on that pawn.',
  achieved: (pos, side) => chainBases(pos, other(side)).some(b => attacked(pos, b, side, 'p') || (attackersOf(pos, b, side).length >= 2)),
  building: (pos, side) => {
    const bases = chainBases(pos, other(side));
    if (!bases.length) return null;
    return [
      step(`The enemy pawn chain has its base on ${bases.join(', ')}`, true, bases),
      step('A pawn of yours can lever it', bases.some(b => [-1, 1].some(df => [1, 2].some(k => isOwn(pos, mkSq(fileOf(b) + df, rankOf(b) - k * fwd(side)), side, 'p'))))),
      step('Your pieces attack the base', bases.some(b => attackersOf(pos, b, side).length >= 1)),
    ];
  } });
function chainBases(pos, color) {
  const out = [];
  for (const p of pieces(pos, color, 'p')) {
    const f = fileOf(p.square), r = rankOf(p.square), d = fwd(color);
    const guards = [-1, 1].some(df => isOwn(pos, mkSq(f + df, r + d), color, 'p'));
    const guarded = [-1, 1].some(df => isOwn(pos, mkSq(f + df, r - d), color, 'p'));
    if (guards && !guarded) out.push(p.square);
  }
  return out;
}
add({ id: 'minority-attack', family: 'positional', name: 'Minority attack', lichess: null,
  blurb: 'Two pawns attack three. The moves b4 and b5 against c6 leave the enemy with a weak c-pawn, and this is the plan of the Carlsbad structure.',
  plan: 'With pawns on a2, b2 against a7, b7, c6, push b4 and b5, trade on c6, and attack the backward c-pawn with rooks.',
  achieved: (pos, side) => vPawn(pos, side, R(side, 'c6')) && !pawnsOnFile(pos, 2, side) && pieceOn(pos, side, 'p', R(side, 'b5')),
  building: (pos, side) => {
    if (!vPawn(pos, side, R(side, 'c6')) || !vPawn(pos, side, R(side, 'd5')) || pawnsOnFile(pos, 2, side) || !pawnsOnFile(pos, 1, side)) return null;
    const bp = pieces(pos, side, 'p').find(p => fileOf(p.square) === 1);
    return [
      step('The Carlsbad structure is on the board (enemy c6, d5; your c-pawn gone)', true),
      step('The b-pawn has reached b4', Math.abs(rankOf(bp.square) - homeRank(side)) >= 3, [bp.square]),
      step('The b-pawn has reached b5', Math.abs(rankOf(bp.square) - homeRank(side)) >= 4),
      step('A rook stands on the c-file', pieces(pos, side, 'r').some(r => fileOf(r.square) === 2)),
    ];
  } });
add({ id: 'maroczy-bind', family: 'positional', name: 'Maróczy bind', lichess: null,
  blurb: 'Pawns on c4 and e4 clamp the d5 square so the Sicilian player never gets the ...d5 break.',
  plan: 'Put pawns on c4 and e4, keep a knight on c3 to hold d5, and squeeze slowly.',
  achieved: (pos, side) => pieceOn(pos, side, 'p', R(side, 'c4')) && pieceOn(pos, side, 'p', R(side, 'e4')) && !vPawn(pos, side, R(side, 'c5')) && vPawn(pos, side, R(side, 'd6')),
  building: (pos, side) => {
    if (!pieceOn(pos, side, 'p', R(side, 'e4')) || !vPawn(pos, side, R(side, 'd6'))) return null;
    return [
      step('Your e-pawn stands on e4 against a pawn on d6', true),
      step('The enemy c-pawn has been traded', !vPawn(pos, side, R(side, 'c5'))),
      step('Your c-pawn stands on c4', pieceOn(pos, side, 'p', R(side, 'c4'))),
      step('A knight on c3 holds d5', pieceOn(pos, side, 'n', R(side, 'c3'))),
    ];
  } });
add({ id: 'hedgehog', family: 'positional', name: 'Hedgehog', lichess: null,
  blurb: 'Pawns on a6, b6, d6, e6 and pieces curled up behind them. It looks passive, but every ...b5 and ...d5 break is a spike.',
  plan: 'Set the pawns on a6, b6, d6, e6, bishops on b7 and e7, and wait for the ...b5 or ...d5 break.',
  achieved: (pos, side) => ['a3', 'b3', 'd3', 'e3'].every(sq => pieceOn(pos, side, 'p', R(side, sq))) && !pawnsOnFile(pos, 2, side),
  building: (pos, side) => {
    const sqs = ['a3', 'b3', 'd3', 'e3'].map(sq => R(side, sq));
    const done = sqs.filter(sq => pieceOn(pos, side, 'p', sq));
    if (done.length < 2 || pawnsOnFile(pos, 2, side)) return null;
    return [
      step(`Hedgehog pawns in place: ${done.length} of 4`, done.length === 4, done),
      step('A bishop sits on b7', pieceOn(pos, side, 'b', R(side, 'b2'))),
      step('Your pieces stay behind the third rank', pieces(pos, side).filter(p => p.type !== 'p' && Math.abs(rankOf(p.square) - homeRank(side)) >= 3).length === 0),
    ];
  } });
add({ id: 'stonewall', family: 'positional', name: 'Stonewall', lichess: null,
  blurb: 'Pawns on d5, e6, f5 (or d4, e3, f4) build a wall and give a knight the e4 (e5) square for a kingside attack.',
  plan: 'Set the pawns d5, e6, f5 with c6 behind, put a knight on e4, and swing the rook and queen to the kingside.',
  achieved: (pos, side) => ['d4', 'e3', 'f4'].every(sq => pieceOn(pos, side, 'p', R(side, sq))),
  building: (pos, side) => {
    const sqs = ['d4', 'e3', 'f4', 'c3'].map(sq => R(side, sq));
    const done = sqs.filter(sq => pieceOn(pos, side, 'p', sq));
    if (done.length < 2) return null;
    return [
      step(`Stonewall pawns in place: ${done.length} of 4`, done.length >= 3, done),
      step('A knight sits on e5', pieceOn(pos, side, 'n', R(side, 'e5'))),
    ];
  } });
add({ id: 'fianchetto-shelter', family: 'positional', name: 'Fianchetto shelter', lichess: null,
  blurb: 'King on g1, bishop on g2, pawns f2, g3, h2. A solid roof, as long as the bishop stays home.',
  plan: 'Play g3, bishop to g2, castle short, and keep that bishop unless you get something big for it.',
  achieved: (pos, side) => pieceOn(pos, side, 'k', R(side, 'g1')) && pieceOn(pos, side, 'b', R(side, 'g2')) && pieceOn(pos, side, 'p', R(side, 'g3')),
  building: (pos, side) => {
    if (!pieceOn(pos, side, 'p', R(side, 'g3'))) return null;
    return [
      step('The g-pawn stands on g3', true),
      step('A bishop sits on g2', pieceOn(pos, side, 'b', R(side, 'g2'))),
      step('The king has castled behind it', pieceOn(pos, side, 'k', R(side, 'g1'))),
    ];
  } });
add({ id: 'weak-color-complex', family: 'positional', name: 'Weak color complex', lichess: null,
  blurb: 'When a side trades the bishop that guarded one color, every square of that color near its king becomes a hole.',
  plan: 'Trade the enemy bishop of one color, then bring your own bishop and queen to that color around their king.',
  /* Trading off the bishop that guarded one color is what creates the holes, and
     the attack that follows is usually run by the queen and the rooks. Keeping
     your own bishop of that color is a bonus, not a requirement, so it is a step
     rather than a gate. Karpov vs Korchnoi 1974 is the model, and there both
     dark-square bishops came off. */
  achieved: (pos, side) => ['light', 'dark'].some(col => {
    if (!vLacksBishopOn(pos, side, col)) return false;
    const king = kingSq(pos, other(side));
    if (!king) return false;
    const holes = neighbors(king).filter(sq => sqColor(sq) === col && !attacked(pos, sq, other(side), 'p'));
    return holes.length >= 2 && holes.filter(sq => attacked(pos, sq, side)).length >= 2;
  }),
  building: (pos, side) => {
    const col = ['light', 'dark'].find(c => vLacksBishopOn(pos, side, c));
    if (!col) return null;
    const king = kingSq(pos, other(side));
    if (!king) return null;
    const holes = neighbors(king).filter(sq => sqColor(sq) === col && !attacked(pos, sq, other(side), 'p'));
    return [
      step(`The enemy has no ${col}-square bishop left`, true),
      step(`${col === 'light' ? 'Light' : 'Dark'} squares next to their king are not covered by pawns`, holes.length >= 2, holes),
      step('Your pieces attack those squares', holes.filter(sq => attacked(pos, sq, side)).length >= 2),
      step('You still have your own bishop of that color, which makes it worse for them',
        pieces(pos, side, 'b').some(b => sqColor(b.square) === col)),
    ];
  } });
add({ id: 'central-pawn-duo', family: 'positional', name: 'Central pawn duo', lichess: null,
  blurb: 'Pawns side by side on d4 and e4 control four squares in front of them and can roll forward together.',
  plan: 'Get pawns to d4 and e4 side by side, protect them with pieces, and advance one when it wins space or opens lines.',
  achieved: (pos, side) => [4, 5, 6].some(r => pieceOn(pos, side, 'p', mkSq(3, relRank(side, r))) && pieceOn(pos, side, 'p', mkSq(4, relRank(side, r)))),
  building: (pos, side) => {
    const ranks = [4, 5, 6];
    const d = ranks.find(r => pieceOn(pos, side, 'p', mkSq(3, relRank(side, r))));
    const e = ranks.find(r => pieceOn(pos, side, 'p', mkSq(4, relRank(side, r))));
    if (d === undefined && e === undefined) return null;
    return [
      step('A center pawn has reached the fourth rank', true),
      step('Both center pawns stand side by side', d !== undefined && d === e),
      step('The duo has advanced to the fifth rank', d !== undefined && d === e && d >= 5),
    ];
  } });
add({ id: 'pawn-majority', family: 'positional', name: 'Pawn majority', lichess: null,
  blurb: 'More pawns than the enemy on one wing means a passed pawn is waiting to be made there.',
  plan: 'Advance the wing where you have more pawns, trade when it creates a passed pawn, and keep the other wing closed.',
  achieved: (pos, side) => (wingPawns(pos, side, true) > wingPawns(pos, other(side), true) || wingPawns(pos, side, false) > wingPawns(pos, other(side), false)) && passedPawns(pos, side).length > 0,
  building: (pos, side) => {
    const q = wingPawns(pos, side, true) > wingPawns(pos, other(side), true), k = wingPawns(pos, side, false) > wingPawns(pos, other(side), false);
    if (!q && !k) return null;
    const files = q ? [0, 1, 2, 3] : [4, 5, 6, 7];
    return [
      step(`You have a pawn majority on the ${q ? 'queenside' : 'kingside'}`, true),
      step('The majority has started to advance', pieces(pos, side, 'p').some(p => files.includes(fileOf(p.square)) && Math.abs(rankOf(p.square) - homeRank(side)) >= 3)),
      step('It has produced a passed pawn', passedPawns(pos, side).some(p => files.includes(fileOf(p.square)))),
    ];
  } });
add({ id: 'overprotection', family: 'positional', name: 'Overprotection', lichess: null,
  blurb: 'Nimzowitsch’s rule says to defend your strong point (an advanced e5 or d5 pawn) with more pieces than it needs, and they all stand well.',
  plan: 'Advance a center pawn to the fifth rank and defend it with three pieces or pawns.',
  achieved: (pos, side) => [R(side, 'e5'), R(side, 'd5')].some(sq => pieceOn(pos, side, 'p', sq) && attackersOf(pos, sq, side).length >= 3),
  building: (pos, side) => {
    const pts = [R(side, 'e5'), R(side, 'd5')].filter(sq => pieceOn(pos, side, 'p', sq));
    if (!pts.length) return null;
    return [
      step(`A center pawn stands on ${pts.join(' and ')}`, true, pts),
      step('Two pieces or pawns defend it', pts.some(sq => attackersOf(pos, sq, side).length >= 2)),
      step('Three or more defend it', pts.some(sq => attackersOf(pos, sq, side).length >= 3)),
    ];
  } });

/* ---------- endgame techniques ---------- */
add({ id: 'opposition', family: 'endgame', name: 'Opposition', lichess: null,
  blurb: 'Kings face each other with one square between. The side that does not have to move has the opposition and wins the ground.',
  plan: 'In a pawn endgame, step your king so the kings face each other with one square between and it is their move.',
  achieved: (pos, side) => {
    if (!pawnEnding(pos)) return false;
    const a = kingSq(pos, side), b = kingSq(pos, other(side));
    const df = Math.abs(fileOf(a) - fileOf(b)), dr = Math.abs(rankOf(a) - rankOf(b));
    return ((df === 0 && dr === 2) || (dr === 0 && df === 2)) && pos.turn() === other(side);
  },
  building: (pos, side) => {
    if (!pawnEnding(pos)) return null;
    const a = kingSq(pos, side), b = kingSq(pos, other(side));
    return [
      step('It is a king and pawn endgame', true),
      step('Your king is close to the enemy king', cheb(a, b) <= 3),
      step('The kings face each other with one square between', cheb(a, b) === 2 && (fileOf(a) === fileOf(b) || rankOf(a) === rankOf(b))),
      step('And it is their move', cheb(a, b) === 2 && (fileOf(a) === fileOf(b) || rankOf(a) === rankOf(b)) && pos.turn() === other(side)),
    ];
  } });
add({ id: 'square-of-the-pawn', family: 'endgame', name: 'Square of the pawn', lichess: null,
  blurb: 'Draw a square from the pawn to its queening rank. If the enemy king cannot step into it, the pawn queens by itself.',
  plan: 'Count the squares from your passed pawn to promotion; if the enemy king is farther than that, run.',
  achieved: (pos, side) => passedPawns(pos, side).some(p => outsideSquare(pos, p.square, side)),
  building: (pos, side) => {
    if (!pawnEnding(pos)) return null;
    const pp = passedPawns(pos, side);
    if (!pp.length) return null;
    return [
      step('You have a passed pawn', true, pp.map(p => p.square)),
      step('The enemy king is outside its square', pp.some(p => outsideSquare(pos, p.square, side))),
    ];
  } });
function outsideSquare(pos, sq, side) {
  const vk = kingSq(pos, other(side));
  if (!vk) return false;
  const promo = side === 'w' ? 8 : 1;
  let dist = Math.abs(promo - rankOf(sq));
  if (Math.abs(rankOf(sq) - homeRank(side)) === 1) dist -= 1;   // the double step
  const kingMoves = Math.max(Math.abs(fileOf(vk) - fileOf(sq)), Math.abs(rankOf(vk) - promo));
  const toMove = pos.turn() === other(side) ? 1 : 0;
  return kingMoves - toMove > dist;
}
add({ id: 'lucena', family: 'endgame', name: 'Lucena position', lichess: null,
  blurb: 'In a rook endgame with your king in front of the pawn on the seventh, build a bridge with the rook on the fourth rank and the king walks out.',
  plan: 'Rook to the fourth rank, king steps out of the pawn’s way, and the rook shields it from the checks. The bridge.',
  achieved: (pos, side) => {
    if (count(pos, side, 'r') !== 1 || count(pos, other(side), 'r') !== 1 || count(pos, side, 'p') !== 1 || count(pos, other(side), 'p')) return false;
    const p = pieces(pos, side, 'p')[0], k = kingSq(pos, side), vk = kingSq(pos, other(side));
    return rankOf(p.square) === relRank(side, 7) && k === mkSq(fileOf(p.square), relRank(side, 8)) && Math.abs(fileOf(vk) - fileOf(p.square)) >= 2;
  },
  building: (pos, side) => {
    if (count(pos, side, 'r') !== 1 || count(pos, other(side), 'r') !== 1 || count(pos, side, 'p') !== 1 || count(pos, other(side), 'p')) return null;
    const p = pieces(pos, side, 'p')[0], k = kingSq(pos, side), vk = kingSq(pos, other(side));
    return [
      step('Rook and pawn against rook', true),
      step('Your king stands in front of the pawn', fileOf(k) === fileOf(p.square) && (side === 'w' ? rankOf(k) > rankOf(p.square) : rankOf(k) < rankOf(p.square))),
      step('The pawn has reached the seventh', rankOf(p.square) === relRank(side, 7)),
      step('The enemy king is cut off two files away', Math.abs(fileOf(vk) - fileOf(p.square)) >= 2),
    ];
  } });
add({ id: 'philidor-rook', family: 'endgame', name: 'Philidor’s defense', lichess: null,
  blurb: 'In a defending rook endgame, keep your rook on the third rank so the enemy king cannot cross, and only when the pawn advances do you check from behind.',
  plan: 'King in front of the pawn, rook on your third rank until the pawn steps onto it, then rook to the back rank and check from behind.',
  achieved: (pos, side) => {
    if (count(pos, side, 'r') !== 1 || count(pos, other(side), 'r') !== 1 || count(pos, other(side), 'p') !== 1 || count(pos, side, 'p')) return false;
    const p = pieces(pos, other(side), 'p')[0], k = kingSq(pos, side), r = pieces(pos, side, 'r')[0];
    return Math.abs(fileOf(k) - fileOf(p.square)) <= 1 && rankOf(k) === homeRank(side) && rankOf(r.square) === relRank(side, 3) && Math.abs(rankOf(p.square) - homeRank(side)) >= 3;
  },
  building: (pos, side) => {
    if (count(pos, side, 'r') !== 1 || count(pos, other(side), 'r') !== 1 || count(pos, other(side), 'p') !== 1 || count(pos, side, 'p')) return null;
    const p = pieces(pos, other(side), 'p')[0], k = kingSq(pos, side), r = pieces(pos, side, 'r')[0];
    return [
      step('You defend rook against rook and pawn', true),
      step('Your king stands in front of the pawn', Math.abs(fileOf(k) - fileOf(p.square)) <= 1 && (side === 'w' ? rankOf(k) < rankOf(p.square) : rankOf(k) > rankOf(p.square))),
      step('Your rook holds the third rank', rankOf(r.square) === relRank(side, 3)),
    ];
  } });
add({ id: 'rook-behind-passed-pawn', family: 'endgame', name: 'Rook behind the passed pawn', lichess: null,
  blurb: 'Tarrasch’s rule says rooks belong behind passed pawns, your own or the enemy’s. The rook gets stronger with every pawn step.',
  plan: 'Put the rook on the same file as the passed pawn, behind it, and push.',
  achieved: (pos, side) => passedPawns(pos, side).some(p => pieces(pos, side, 'r').some(r => fileOf(r.square) === fileOf(p.square) && (side === 'w' ? rankOf(r.square) < rankOf(p.square) : rankOf(r.square) > rankOf(p.square)))),
  building: (pos, side) => {
    const pp = passedPawns(pos, side);
    if (!pp.length || !has(pos, side, 'r')) return null;
    return [
      step('You have a passed pawn', true, pp.map(p => p.square)),
      step('A rook can reach the square behind it', pp.some(p => { const behind = mkSq(fileOf(p.square), rankOf(p.square) - fwd(side)); return behind && aims(pos, side, 'r', behind); })),
      step('A rook stands behind it on the same file', pp.some(p => pieces(pos, side, 'r').some(r => fileOf(r.square) === fileOf(p.square) && (side === 'w' ? rankOf(r.square) < rankOf(p.square) : rankOf(r.square) > rankOf(p.square))))),
    ];
  } });
add({ id: 'active-king', family: 'endgame', name: 'Active king', lichess: null,
  blurb: 'In the endgame the king is a fighting piece. Walk it to the center and toward the pawns before the other king gets there.',
  plan: 'Once the queens are off, march the king to the middle of the board and toward the pawns.',
  achieved: (pos, side) => isEndgame(pos) && centralityOf(kingSq(pos, side)) >= 2 && centralityOf(kingSq(pos, side)) > centralityOf(kingSq(pos, other(side))),
  building: (pos, side) => {
    if (!isEndgame(pos)) return null;
    return [
      step('Queens are off and the endgame has begun', true),
      step('Your king has left the back rank', rankOf(kingSq(pos, side)) !== homeRank(side)),
      step('It stands in the center', centralityOf(kingSq(pos, side)) >= 2),
      step('It is more active than the enemy king', centralityOf(kingSq(pos, side)) > centralityOf(kingSq(pos, other(side)))),
    ];
  } });
const centralityOf = sq => (sq ? 3 - Math.max(Math.abs(fileOf(sq) - 3.5), Math.abs(rankOf(sq) - 4.5)) + 0.5 : 0);
add({ id: 'wrong-rook-pawn', family: 'endgame', name: 'Wrong rook pawn', lichess: null,
  blurb: 'Bishop and rook pawn cannot win if the bishop does not control the queening corner and the defending king gets there. A famous draw.',
  plan: 'Defending, run your king to the corner in front of the pawn. Attacking, keep the enemy king out of that corner at all costs.',
  achieved: (pos, side) => {
    const v = other(side);
    if (pieces(pos, side).length !== 1 || count(pos, v, 'b') !== 1 || count(pos, v, 'p') !== 1 || pieces(pos, v).length !== 3) return false;
    const p = pieces(pos, v, 'p')[0];
    if (fileOf(p.square) !== 0 && fileOf(p.square) !== 7) return false;
    const corner = mkSq(fileOf(p.square), v === 'w' ? 8 : 1);
    return sqColor(pieces(pos, v, 'b')[0].square) !== sqColor(corner) && cheb(kingSq(pos, side), corner) <= 1;
  },
  building: (pos, side) => {
    const v = other(side);
    if (pieces(pos, side).length !== 1 || count(pos, v, 'b') !== 1 || count(pos, v, 'p') !== 1 || pieces(pos, v).length !== 3) return null;
    const p = pieces(pos, v, 'p')[0];
    if (fileOf(p.square) !== 0 && fileOf(p.square) !== 7) return null;
    const corner = mkSq(fileOf(p.square), v === 'w' ? 8 : 1);
    return [
      step('Lone king against bishop and rook pawn', true),
      step('The bishop does not control the queening corner', sqColor(pieces(pos, v, 'b')[0].square) !== sqColor(corner)),
      step(`Your king is in or next to ${corner}`, cheb(kingSq(pos, side), corner) <= 1, [corner]),
    ];
  } });
add({ id: 'knight-vs-bad-bishop-endgame', family: 'endgame', name: 'Knight against bad bishop', lichess: null,
  blurb: 'A knight beats a bishop whose own pawns stand on its color. Fischer showed it against Taimanov in 1971.',
  plan: 'Fix the enemy pawns on the color of their bishop, bring your king in, and use the knight to attack what the bishop cannot defend.',
  achieved: (pos, side) => {
    if (!isEndgame(pos) || count(pos, side, 'n') !== 1 || count(pos, side, 'b') || count(pos, other(side), 'b') !== 1 || count(pos, other(side), 'n')) return false;
    const col = sqColor(pieces(pos, other(side), 'b')[0].square);
    const ps = pieces(pos, other(side), 'p');
    return ps.length >= 3 && ps.filter(p => sqColor(p.square) === col).length * 2 >= ps.length;
  },
  building: (pos, side) => {
    if (!isEndgame(pos) || count(pos, side, 'n') !== 1 || count(pos, side, 'b') || count(pos, other(side), 'b') !== 1 || count(pos, other(side), 'n')) return null;
    const col = sqColor(pieces(pos, other(side), 'b')[0].square);
    const ps = pieces(pos, other(side), 'p');
    return [
      step('Your knight faces their bishop in an endgame', true),
      step(`Their pawns stand on ${col} squares, the bishop’s color`, ps.filter(p => sqColor(p.square) === col).length * 2 >= ps.length),
      step('Your king is active', centralityOf(kingSq(pos, side)) >= 2),
    ];
  } });

/* names and blurbs for the mate entries come from the MATES table */
for (const p of PATTERNS) {
  if (p.family === 'mate') {
    const m = mateBy(p.id);
    p.name = m.name; p.blurb = m.blurb; p.lichess = m.lichess;
  }
}
const FAMILY_ORDER = { mate: 0, attack: 1, positional: 2, endgame: 3 };
PATTERNS.sort((a, b) => FAMILY_ORDER[a.family] - FAMILY_ORDER[b.family] || (b.lichess || 0) - (a.lichess || 0));
const byId = new Map(PATTERNS.map(p => [p.id, p]));

/* ============================== public API ============================== */
/* One pattern's state for one side. `steps` is the checklist, `done` the count
   of ticked steps, `achieved` whether the finished pattern is on the board. */
export function patternStatus(pos, id, side) {
  const p = byId.get(id);
  if (!p) return null;
  let achieved = false, steps = null;
  try { achieved = !!p.achieved(pos, side); } catch (e) { achieved = false; }
  try { steps = p.building ? p.building(pos, side) : null; } catch (e) { steps = null; }
  const done = steps ? steps.filter(s => s.done).length : 0;
  return { id, side, name: p.name, family: p.family, blurb: p.blurb, plan: p.plan, lichess: p.lichess,
    achieved, steps: steps || [], done, total: steps ? steps.length : 0 };
}
/* Every pattern either side has finished or is at least half way to.
   Sorted: achieved first, then by how complete the checklist is. */
export function detectPatterns(pos, opts = {}) {
  const minShare = opts.minShare === undefined ? 0.5 : opts.minShare;
  const out = { w: [], b: [] };
  for (const side of ['w', 'b']) {
    for (const p of PATTERNS) {
      const st = patternStatus(pos, p.id, side);
      if (!st) continue;
      if (st.achieved) { out[side].push({ ...st, status: 'achieved' }); continue; }
      if (!st.total) continue;
      if (st.done / st.total >= minShare && st.done >= 1) out[side].push({ ...st, status: 'building' });
    }
    out[side].sort((a, b) => (b.status === 'achieved') - (a.status === 'achieved') || (b.done / (b.total || 1)) - (a.done / (a.total || 1)) || (b.lichess || 0) - (a.lichess || 0));
  }
  return out;
}
/* Legal moves for the side to move that tick one more box of the pattern (or
   finish it). This is what the engine is asked to price. */
export function planMoves(pos, id, side) {
  if (pos.turn() !== side) return [];
  const before = patternStatus(pos, id, side);
  if (!before) return [];
  const out = [];
  for (const m of pos.moves({ verbose: true })) {
    let after;
    try { after = new Chess(pos.fen()); after.move(m.san); } catch (e) { continue; }
    const st = patternStatus(after, id, side);
    if (!st) continue;
    const uci = m.from + m.to + (m.promotion || '');
    if (st.achieved && !before.achieved) out.push({ uci, san: m.san, gain: 99 });
    else if (st.done > before.done) out.push({ uci, san: m.san, gain: st.done - before.done });
  }
  return out.sort((a, b) => b.gain - a.gain);
}
/* Walk a line of UCI moves and report which patterns the mover finished or
   advanced along it, so an engine line can be labeled in words. */
export function patternsAlongLine(fen, uciMoves, side, ids) {
  let pos;
  try { pos = new Chess(fen); } catch (e) { return []; }
  const list = ids ? ids.map(id => byId.get(id)).filter(Boolean) : PATTERNS;
  const start = new Map(list.map(p => [p.id, patternStatus(pos, p.id, side)]));
  const found = new Map();
  for (const uci of uciMoves) {
    let mv;
    try { mv = pos.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined }); } catch (e) { break; }
    if (!mv) break;
    for (const p of list) {
      const st = patternStatus(pos, p.id, side), s0 = start.get(p.id);
      if (!st) continue;
      if (st.achieved && !(s0 && s0.achieved)) found.set(p.id, { id: p.id, name: p.name, family: p.family, achieved: true, done: st.done, total: st.total });
      else if (!found.has(p.id) && s0 && st.total && st.done > s0.done && st.done / st.total >= 0.5) found.set(p.id, { id: p.id, name: p.name, family: p.family, achieved: false, done: st.done, total: st.total });
    }
  }
  return [...found.values()].sort((a, b) => (b.achieved - a.achieved) || (b.done / (b.total || 1)) - (a.done / (a.total || 1)));
}
export const patternById = id => byId.get(id) || null;
export const mateName = id => { const m = mateBy(id); return m ? m.name : (id === 'checkmate' ? 'Checkmate' : null); };
export { PATTERNS, FILES, other, rel, relRank, fwd, homeRank, pieces, count, kingSq, neighbors, attackersOf, attacked, at, isOwn, empty,
  onEdge, inCorner, onEdgeFile, adjacent, cheb, between, pawnsOnFile, isPassedPawn, isIsolatedPawn, unassailable, pawnIslands,
  kingKingside, kingQueenside, kingUncastled, kingInCenter, isEndgame, pawnEnding, material, nonPawnMaterial, sqColor, mateInfo, MATES,
  backwardPawns, chainBases, sideName, PIECE_WORD };
