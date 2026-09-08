/* Game Review board.
 *
 * A chess board drawn with createElement and piece images from
 * chess-assets/pieces/. It keeps its own chess.js position, shows legal
 * targets for a selected piece, takes a move by click and click or by
 * drag, asks which piece to promote to, and can draw arrows and mark
 * squares. Nothing here evaluates anything; the page decides what a move
 * means and calls back in.
 */
import { Chess } from './chess-assets/chess.js';

const FILES = 'abcdefgh';
const PIECE_WORD = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const SVG = 'http://www.w3.org/2000/svg';

export function createBoard(container, options = {}) {
  const pieces = options.pieces || 'chess-assets/pieces/';
  const onMove = typeof options.onMove === 'function' ? options.onMove : () => false;
  const state = { chess: new Chess(), orientation: 'w', locked: false, movable: null, selected: null, lastMove: null, arrows: [], marks: [], drag: null };

  container.replaceChildren();
  container.classList.add('gr-board');
  const grid = document.createElement('div');
  grid.className = 'gr-squares';
  const overlay = document.createElementNS(SVG, 'svg');
  overlay.setAttribute('viewBox', '0 0 8 8');
  overlay.setAttribute('preserveAspectRatio', 'none');
  overlay.setAttribute('class', 'gr-arrows');
  overlay.setAttribute('aria-hidden', 'true');
  const promo = document.createElement('div');
  promo.className = 'gr-promo';
  promo.hidden = true;
  container.append(grid, overlay, promo);

  const squareName = (x, y) => (state.orientation === 'w' ? FILES[x] + (8 - y) : FILES[7 - x] + (y + 1));
  const cellOf = sq => (state.orientation === 'w'
    ? { x: FILES.indexOf(sq[0]), y: 8 - +sq[1] }
    : { x: 7 - FILES.indexOf(sq[0]), y: +sq[1] - 1 });

  function render() {
    const frag = document.createDocumentFragment();
    const c = state.chess;
    const kingInCheck = c.inCheck() ? kingSquare(c, c.turn()) : null;
    const targets = new Set();
    if (state.selected) for (const m of c.moves({ square: state.selected, verbose: true })) targets.add(m.to);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const sq = squareName(x, y);
      const f = FILES.indexOf(sq[0]), r = +sq[1] - 1;
      const cell = document.createElement('div');
      cell.className = 'gr-sq ' + ((f + r) % 2 === 0 ? 'dark' : 'light');
      cell.dataset.sq = sq;
      const p = c.get(sq);
      if (p) {
        const img = document.createElement('img');
        img.src = pieces + p.color + p.type.toUpperCase() + '.svg';
        img.alt = (p.color === 'w' ? 'white ' : 'black ') + PIECE_WORD[p.type];
        img.draggable = false;
        cell.appendChild(img);
      }
      if (state.lastMove && (sq === state.lastMove.from || sq === state.lastMove.to)) cell.classList.add('last');
      if (state.selected === sq) cell.classList.add('sel');
      if (kingInCheck === sq) cell.classList.add('check');
      if (targets.has(sq)) {
        const dot = document.createElement('div');
        dot.className = 'gr-dot' + (p ? ' cap' : '');
        cell.appendChild(dot);
      }
      for (const m of state.marks) if (m.sq === sq) cell.classList.add('mark-' + m.cls);
      if (x === 0) { const s = document.createElement('span'); s.className = 'gr-coord rank'; s.textContent = sq[1]; cell.appendChild(s); }
      if (y === 7) { const s = document.createElement('span'); s.className = 'gr-coord file'; s.textContent = sq[0]; cell.appendChild(s); }
      frag.appendChild(cell);
    }
    grid.replaceChildren(frag);
    drawArrows();
  }

  function drawArrows() {
    overlay.replaceChildren();
    for (const a of state.arrows) {
      if (!/^[a-h][1-8]$/.test(a.from || '') || !/^[a-h][1-8]$/.test(a.to || '') || a.from === a.to) continue;
      const p = cellOf(a.from), q = cellOf(a.to);
      const x1 = p.x + 0.5, y1 = p.y + 0.5, x2 = q.x + 0.5, y2 = q.y + 0.5;
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
      const ux = dx / len, uy = dy / len;
      const head = 0.32, shaft = 0.12;
      const tipX = x2 - ux * 0.18, tipY = y2 - uy * 0.18;
      const baseX = tipX - ux * head, baseY = tipY - uy * head;
      const startX = x1 + ux * 0.3, startY = y1 + uy * 0.3;
      const g = document.createElementNS(SVG, 'g');
      g.setAttribute('class', 'gr-arrow ' + (a.kind || 'best'));
      const line = document.createElementNS(SVG, 'line');
      line.setAttribute('x1', startX.toFixed(3)); line.setAttribute('y1', startY.toFixed(3));
      line.setAttribute('x2', baseX.toFixed(3)); line.setAttribute('y2', baseY.toFixed(3));
      line.setAttribute('stroke-width', String(shaft));
      const tri = document.createElementNS(SVG, 'polygon');
      const px = -uy, py = ux;
      tri.setAttribute('points', [
        tipX.toFixed(3) + ',' + tipY.toFixed(3),
        (baseX + px * 0.22).toFixed(3) + ',' + (baseY + py * 0.22).toFixed(3),
        (baseX - px * 0.22).toFixed(3) + ',' + (baseY - py * 0.22).toFixed(3),
      ].join(' '));
      g.append(line, tri);
      overlay.appendChild(g);
    }
  }

  function kingSquare(c, color) {
    const found = c.findPiece({ type: 'k', color });
    return found && found.length ? found[0] : null;
  }

  function canPick(sq) {
    if (state.locked) return false;
    const p = state.chess.get(sq);
    if (!p || p.color !== state.chess.turn()) return false;
    if (state.movable && p.color !== state.movable) return false;
    return true;
  }

  function squareUnder(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cell = el && el.closest ? el.closest('.gr-sq') : null;
    return cell && grid.contains(cell) ? cell.dataset.sq : null;
  }

  function tryMove(from, to) {
    const legal = state.chess.moves({ square: from, verbose: true }).filter(m => m.to === to);
    state.selected = null;
    if (!legal.length) { render(); return; }
    if (legal.some(m => m.promotion)) { askPromotion(from, to, legal[0].color); return; }
    finish(from, to, undefined);
  }

  function finish(from, to, promotion) {
    promo.hidden = true;
    promo.replaceChildren();
    render();
    onMove(from, to, promotion);
  }

  function askPromotion(from, to, color) {
    promo.replaceChildren();
    for (const t of ['q', 'r', 'b', 'n']) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'gr-promo-btn';
      const img = document.createElement('img');
      img.src = pieces + color + t.toUpperCase() + '.svg';
      img.alt = PIECE_WORD[t];
      b.appendChild(img);
      b.addEventListener('click', () => finish(from, to, t));
      promo.appendChild(b);
    }
    promo.hidden = false;
    render();
  }

  grid.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const sq = squareUnder(e);
    if (!sq) return;
    if (canPick(sq)) {
      e.preventDefault();
      const again = state.selected === sq;
      state.selected = sq;
      render();
      const img = grid.querySelector(`[data-sq="${sq}"] img`);
      state.drag = { from: sq, again, moved: false, x: e.clientX, y: e.clientY, ghost: null, src: img ? img.src : null };
    } else if (state.selected) {
      e.preventDefault();
      tryMove(state.selected, sq);
    }
  });
  const onMoveEvent = e => {
    const d = state.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) {
      d.moved = true;
      if (d.src) {
        const g = document.createElement('img');
        g.src = d.src; g.className = 'gr-ghost'; g.alt = '';
        const s = grid.clientWidth / 8 * 0.9;
        g.style.width = s + 'px'; g.style.height = s + 'px';
        document.body.appendChild(g);
        d.ghost = g;
        const orig = grid.querySelector(`[data-sq="${d.from}"] img`);
        if (orig) orig.style.opacity = '.35';
      }
    }
    if (d.ghost) {
      const s = parseFloat(d.ghost.style.width);
      d.ghost.style.left = (e.clientX - s / 2) + 'px';
      d.ghost.style.top = (e.clientY - s / 2) + 'px';
    }
  };
  const onUp = e => {
    const d = state.drag;
    if (!d) return;
    state.drag = null;
    if (d.ghost) d.ghost.remove();
    const orig = grid.querySelector(`[data-sq="${d.from}"] img`);
    if (orig) orig.style.opacity = '';
    if (d.moved) {
      const target = squareUnder(e);
      if (target && target !== d.from) tryMove(d.from, target);
      else { state.selected = null; render(); }
    } else if (d.again) { state.selected = null; render(); }
  };
  const onCancel = () => {
    const d = state.drag;
    if (!d) return;
    if (d.ghost) d.ghost.remove();
    state.drag = null; state.selected = null; render();
  };
  document.addEventListener('pointermove', onMoveEvent);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onCancel);

  const api = {
    el: container,
    /* Show a position. `pos` is a FEN or a chess.js instance; the board
       copies it, so the caller's game is never touched. */
    set(pos, { lastMove = null, arrows = [], marks = [] } = {}) {
      const fen = typeof pos === 'string' ? pos : pos.fen();
      try { state.chess = new Chess(fen); } catch (e) { return false; }
      state.selected = null;
      state.lastMove = lastMove;
      state.arrows = arrows;
      state.marks = marks;
      promo.hidden = true;
      render();
      return true;
    },
    fen() { return state.chess.fen(); },
    turn() { return state.chess.turn(); },
    orientation(color) {
      if (color !== 'w' && color !== 'b') return state.orientation;
      state.orientation = color;
      render();
      return color;
    },
    lock(flag) { state.locked = !!flag; if (flag) { state.selected = null; render(); } },
    /* Only this color may move; null lets the side to move play. */
    movable(color) { state.movable = color === 'w' || color === 'b' ? color : null; },
    arrows(list) { state.arrows = Array.isArray(list) ? list : []; drawArrows(); },
    marks(list) { state.marks = Array.isArray(list) ? list : []; render(); },
    destroy() {
      document.removeEventListener('pointermove', onMoveEvent);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      container.replaceChildren();
    },
  };
  render();
  return api;
}

if (typeof window !== 'undefined') window.GameReviewBoard = Object.freeze({ createBoard });
