/* Rebuild chess-assets/openings.json from the Lichess chess-openings tables.
   Run from the repository root, with the five TSVs downloaded beside it:

     for f in a b c d e; do
       curl -O https://raw.githubusercontent.com/lichess-org/chess-openings/master/$f.tsv
     done
     node tools/chess-assets/gen-openings.mjs a.tsv b.tsv c.tsv d.tsv e.tsv

   Source: https://github.com/lichess-org/chess-openings (CC0 1.0). Each line is
   "eco<TAB>name<TAB>pgn"; the pgn is replayed with the site's own chess.js and
   the resulting position, trimmed to its first four FEN fields, becomes the key.
   Positions are keyed rather than move orders so a transposition is recognized. */
import { Chess } from './chess.js';
import fs from 'node:fs';
import path from 'node:path';

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: node gen-openings.mjs a.tsv b.tsv c.tsv d.tsv e.tsv'); process.exit(1); }
const seen = new Map();
let skipped = 0;
for (const file of files) {
  for (const line of fs.readFileSync(file, 'utf8').split('\n').slice(1)) {
    if (!line.trim()) continue;
    const [eco, name, pgn] = line.split('\t');
    if (!eco || !name || !pgn) { skipped++; continue; }
    const board = new Chess();
    let ok = true;
    for (const token of pgn.replace(/\d+\.\s*/g, ' ').split(/\s+/).filter(Boolean)) {
      try { if (!board.move(token)) { ok = false; break; } } catch (e) { ok = false; break; }
    }
    if (!ok) { skipped++; console.error('unplayable:', eco, name); continue; }
    const epd = board.fen().split(' ').slice(0, 4).join(' ');
    if (!seen.has(epd)) seen.set(epd, [epd, eco, name]);
  }
}
const out = {
  source: 'lichess-org/chess-openings (CC0 1.0)',
  generated: new Date().toISOString().slice(0, 10),
  entries: [...seen.values()],
};
const dest = path.join(path.dirname(new URL(import.meta.url).pathname), 'openings.json');
fs.writeFileSync(dest, JSON.stringify(out));
console.log(`${seen.size} positions written to ${dest} (${skipped} skipped)`);
