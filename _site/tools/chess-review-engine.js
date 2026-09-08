/* Game Review engine.
 *
 * One Stockfish worker, the same WASM build the coach page ships, driven
 * over UCI with a queue so two searches never overlap. Every job carries a
 * kind, and stop(kind) drops the queued jobs of that kind and interrupts a
 * running one, which is how a review run is abandoned without leaving a
 * search behind.
 *
 * Scores are centipawns from the side to move. A mate in n is MATE - n.
 */
export const MATE = 100000;
/* how long a job may go unanswered before the worker is given up on */
export const DEFAULT_TIMEOUT_MS = 60000;
export const STOP_GRACE_MS = 4000;

export function parseInfo(line) {
  if (!line.startsWith('info ') || !line.includes(' pv ')) return null;
  const depth = /\bdepth (\d+)/.exec(line);
  const cp = /\bscore cp (-?\d+)/.exec(line);
  const mate = /\bscore mate (-?\d+)/.exec(line);
  const pv = /\bpv (.+)$/.exec(line);
  const mp = /\bmultipv (\d+)/.exec(line);
  if (!depth || !pv || (!cp && !mate)) return null;
  const m = mate ? parseInt(mate[1], 10) : null;
  const score = m !== null ? (m > 0 ? MATE - m : -MATE - m) : parseInt(cp[1], 10);
  const moves = pv[1].trim().split(/\s+/).filter(u => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(u));
  return { depth: +depth[1], score, mate: m, pv: moves, multipv: mp ? +mp[1] : 1 };
}

export class Engine {
  constructor(url, { hash = 32 } = {}) {
    this.worker = new Worker(url);
    this.worker.onmessage = e => this._line(String(e.data));
    this.worker.onerror = () => this._fail();
    this.queue = [];
    this.current = null;
    this.failed = false;
    this.ready = this.run({ kind: 'init', cmds: ['uci'], done: l => l === 'uciok', timeoutMs: 90000 })
      .then(() => this.run({ kind: 'init', cmds: [`setoption name Hash value ${hash}`, 'setoption name UCI_LimitStrength value false', 'setoption name Skill Level value 20', 'isready'], done: l => l === 'readyok', timeoutMs: 30000 }));
  }
  _line(line) {
    const job = this.current;
    if (!job) return;
    if (job.onLine) job.onLine(line);
    if (job.done(line)) { clearTimeout(job.timer); this.current = null; job.resolve(line); this._pump(); }
  }
  _flush() {
    const jobs = this.queue.splice(0);
    if (this.current) { jobs.unshift(this.current); this.current = null; }
    for (const j of jobs) { clearTimeout(j.timer); j.reject(new Error('engine failed')); }
  }
  run(job) {
    return new Promise((resolve, reject) => {
      if (this.failed) { reject(new Error('engine failed')); return; }
      job.resolve = resolve; job.reject = reject;
      this.queue.push(job);
      this._pump();
    });
  }
  _pump() {
    if (this.current || !this.queue.length) return;
    this.current = this.queue.shift();
    const job = this.current;
    /* a worker that never answers would otherwise leave the page waiting
       forever; past the deadline the engine is declared failed and every
       waiting job is rejected */
    job.timer = setTimeout(() => { if (this.current === job) this._fail(); }, job.timeoutMs || DEFAULT_TIMEOUT_MS);
    for (const c of job.cmds) this.worker.postMessage(c);
  }
  _fail() {
    this.failed = true;
    try { this.worker.terminate(); } catch (e) {}
    this._flush();
  }
  /* Drop every queued job of this kind and interrupt a running one. */
  stop(kind) {
    this.queue = this.queue.filter(j => {
      if (j.kind !== kind) return true;
      j.stopped = true;
      j.resolve('bestmove (none)');
      return false;
    });
    if (this.current && this.current.kind === kind) {
      const job = this.current;
      job.stopped = true;
      this.worker.postMessage('stop');
      /* a stop that is not answered is a hung worker */
      clearTimeout(job.timer);
      job.timer = setTimeout(() => { if (this.current === job) this._fail(); }, STOP_GRACE_MS);
    }
  }
  newGame() { return this.run({ kind: 'init', cmds: ['ucinewgame', 'isready'], done: l => l === 'readyok' }); }

  /* One search. `movetime` in milliseconds or `depth` in plies; multipv
     lines come back in `lines`, the first of them in the top-level fields. */
  evaluate(fen, { movetime = 300, depth = 0, multipv = 1, kind = 'eval' } = {}) {
    const infos = {};
    const job = {
      kind, timeoutMs: depth > 0 ? 120000 : movetime * 4 + 10000,
      cmds: [`setoption name MultiPV value ${multipv}`, `position fen ${fen}`, depth > 0 ? `go depth ${depth}` : `go movetime ${movetime}`],
      onLine: l => { const i = parseInfo(l); if (i) infos[i.multipv] = i; },
      done: l => l.startsWith('bestmove'),
    };
    return this.run(job).then(l => {
      const word = l.split(/\s+/)[1];
      const best = /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(word || '') ? word : null;
      const lines = Object.keys(infos).map(k => +k).sort((a, b) => a - b).map(k => infos[k]);
      /* a best move without a score line is not a result the page can use;
         `stopped` means stop() cut this search short */
      if (!job.stopped && (!best || !lines.length)) throw new Error('engine answered without a move and a score');
      const top = lines[0] || { score: 0, mate: null, depth: 0, pv: best ? [best] : [] };
      return { score: top.score, mate: top.mate, depth: top.depth, pv: top.pv.length ? top.pv : (best ? [best] : []), best, lines, stopped: !!job.stopped };
    });
  }
  terminate() { this._fail(); }
}

if (typeof window !== 'undefined') window.GameReviewEngine = Object.freeze({ Engine, MATE, parseInfo });
