/* Leela-family neural network opponents, fully client-side.
   Runs lc0-format networks (Maia 1100-1900, Lc0 T70) exported to ONNX via
   lc0 leela2onnx, through ONNX Runtime Web (WASM). Input encoding follows
   lc0's INPUT_CLASSICAL_112_PLANE format (src/neural/encoder.cc); the
   policy-index table lives in leela-policy.js. Written for this site;
   networks (C) their authors, see the page credits. */

import { POLICY_UCI } from './leela-policy.js';

const UCI_TO_IDX = new Map(POLICY_UCI.map((m, i) => [m, i]));

/* ---------- position encoding (INPUT_CLASSICAL_112_PLANE) ---------- */

const PIECE_PLANE = { p: 0, n: 1, b: 2, r: 3, q: 4, k: 5 };
const PLANES = 112, PER_BOARD = 13, HISTORY = 8;

/* fen key for repetition counting: placement, turn, castling, ep */
const repKey = fen => fen.split(' ').slice(0, 4).join(' ');

const STARTPOS = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';

/* Encode a game line (FENs oldest -> newest, ending at the position to move
   in) into the 112x8x8 input tensor, from the side-to-move's perspective. */
export function encodeFens(fens) {
  const data = new Float32Array(PLANES * 64);
  const cur = fens[fens.length - 1];
  const [placement, stm, castling, , halfmove] = cur.split(' ');
  const black = stm === 'b';

  /* repetition count for every position in the line */
  const seen = new Map(), reps = [];
  for (const f of fens) {
    const k = repKey(f);
    const n = seen.get(k) || 0;
    reps.push(n);
    seen.set(k, n + 1);
  }

  const standardStart = fens[0].startsWith(STARTPOS);
  for (let h = 0; h < HISTORY; h++) {
    let idx = fens.length - 1 - h;
    if (idx < 0) {
      if (standardStart) break;        // zero-fill missing history
      idx = 0;                         // custom start: repeat oldest position
    }
    const rows = fens[idx].split(' ')[0].split('/');   // rank 8 first
    for (let r8 = 0; r8 < 8; r8++) {
      const rank = 7 - r8;             // absolute rank index, rank 1 = 0
      let file = 0;
      for (const ch of rows[r8]) {
        if (ch >= '1' && ch <= '8') { file += +ch; continue; }
        const white = ch === ch.toUpperCase();
        const ours = black ? !white : white;
        const plane = h * PER_BOARD + (ours ? 0 : 6) + PIECE_PLANE[ch.toLowerCase()];
        const encRank = black ? 7 - rank : rank;
        data[plane * 64 + encRank * 8 + file] = 1;
        file++;
      }
    }
    if (reps[idx] >= 1) data.fill(1, (h * PER_BOARD + 12) * 64, (h * PER_BOARD + 13) * 64);
  }

  /* aux planes: castling (ours 000, ours 00, theirs 000, theirs 00),
     side to move, rule-50 count, zeros, ones */
  const has = c => castling.includes(c);
  const aux = [black ? has('q') : has('Q'), black ? has('k') : has('K'),
               black ? has('Q') : has('q'), black ? has('K') : has('k'),
               black, false, false, true];
  aux.forEach((on, i) => { if (on) data.fill(1, (104 + i) * 64, (105 + i) * 64); });
  data.fill(+halfmove || 0, 109 * 64, 110 * 64);
  return data;
}

/* Map an absolute UCI move to its policy index, given the side to move.
   Black moves are rank-flipped (lc0 encodes from the mover's perspective);
   knight promotions use the bare from-to entry. */
export function uciToPolicyIndex(uci, black) {
  let m = uci.endsWith('n') ? uci.slice(0, 4) : uci;
  if (black) {
    m = m[0] + (9 - +m[1]) + m[2] + (9 - +m[3]) + (m[4] || '');
  }
  return UCI_TO_IDX.get(m);
}

/* ---------- network ---------- */

/* All runtime files (ort bundle, wasm, models) live alongside this module. */
const HERE = f => new URL(f, import.meta.url).href;

let ortP = null;
const loadOrt = () => ortP || (ortP = import(HERE('ort.wasm.bundle.min.mjs')).then(ort => {
  ort.env.wasm.wasmPaths = HERE('./');
  ort.env.wasm.numThreads = 1;         // GitHub Pages lacks COOP/COEP headers
  return ort;
}));

export class LeelaNet {
  constructor() { this.session = null; this.ort = null; }

  /* Fetch (with progress callback 0..1), gunzip if needed, create session. */
  async load(modelFile, onProgress) {
    const ort = await loadOrt();
    const resp = await fetch(HERE(modelFile));
    if (!resp.ok) throw new Error('model fetch failed: ' + resp.status);
    const total = +resp.headers.get('Content-Length') || 0;
    let buf;
    if (resp.body && onProgress && total) {
      const reader = resp.body.getReader(), chunks = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); got += value.length;
        onProgress(Math.min(1, got / total));
      }
      buf = await new Blob(chunks).arrayBuffer();
    } else {
      buf = await resp.arrayBuffer();
    }
    const head = new Uint8Array(buf, 0, 2);
    if (head[0] === 0x1f && head[1] === 0x8b) {
      const ds = new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip')));
      buf = await ds.arrayBuffer();
    }
    this.ort = ort;
    this.session = await ort.InferenceSession.create(buf, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    return this;
  }

  /* Run the net on a game line; returns raw policy logits and WDL. */
  async evaluate(fens) {
    const planes = encodeFens(fens);
    const tensor = new this.ort.Tensor('float32', planes, [1, 112, 8, 8]);
    const out = await this.session.run({ [this.session.inputNames[0]]: tensor });
    const policy = out[this.session.outputNames.find(n => n.includes('policy'))].data;
    const wdlOut = this.session.outputNames.find(n => n.includes('wdl'));
    const wdl = wdlOut ? Array.from(out[wdlOut].data) : null;
    return { policy, wdl };
  }
}

/* ---------- move choice ---------- */

/* Softmax the policy over the legal moves and pick one.
   temperature: 0 = always the top move; 1 = sample the net's own distribution.
   topP: nucleus cutoff — sampling never leaves the smallest set of moves
   whose combined probability exceeds this (guards the absurd tail).
   biasFn: optional per-move logit bonus in "centipawn-like" units (persona
   style flavor); applied before sampling.
   Returns { uci, prob, candidates } — candidates sorted by probability. */
export function chooseMove(policy, legalUcis, black, { temperature = 1, topP = 0.95, biasFn = null } = {}) {
  const entries = [];
  for (const uci of legalUcis) {
    const idx = uciToPolicyIndex(uci, black);
    if (idx === undefined) continue;
    let logit = policy[idx];
    if (biasFn) logit += biasFn(uci) / 40;
    entries.push({ uci, logit });
  }
  if (!entries.length) return null;
  const max = Math.max(...entries.map(e => e.logit));
  let sum = 0;
  for (const e of entries) { e.p = Math.exp(e.logit - max); sum += e.p; }
  for (const e of entries) e.p /= sum;
  entries.sort((a, b) => b.p - a.p);

  let pick = entries[0];
  if (temperature > 0 && entries.length > 1) {
    /* nucleus: keep the head of the distribution */
    const pool = [];
    let mass = 0;
    for (const e of entries) { pool.push(e); mass += e.p; if (mass >= topP) break; }
    /* re-softmax the pool at the given temperature */
    let tsum = 0;
    for (const e of pool) { e.tp = Math.pow(e.p, 1 / temperature); tsum += e.tp; }
    let roll = Math.random() * tsum;
    for (const e of pool) { roll -= e.tp; if (roll <= 0) { pick = e; break; } }
  }
  return { uci: pick.uci, prob: pick.p, candidates: entries };
}

/* One-ply value lookahead for the strongest personas: evaluate the position
   after each candidate move with the net's value head and blend it with the
   policy prior. cands: [{uci, prob, afterFen}]. Returns the same list with a
   .score field, best first. Our expected score = opponent's loss + draw/2,
   since WDL is always from the side to move. */
export async function valueRerank(net, baseFens, cands, lambda = 0.5) {
  for (const c of cands) {
    const { wdl } = await net.evaluate([...baseFens, c.afterFen]);
    const our = wdl ? wdl[2] + wdl[1] / 2 : 0.5;
    c.score = lambda * c.prob + (1 - lambda) * our;
  }
  return cands.slice().sort((a, b) => b.score - a.score);
}
