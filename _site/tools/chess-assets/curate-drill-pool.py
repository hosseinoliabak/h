"""
Build the Game Review drill pool from the Lichess puzzle export.

The Game Review page finds a player's weaknesses in their own games and then
hands them positions to practice. The positions come from here, one file per
tactical or endgame theme and one file per opening family, each holding a
rating-spread sample of puzzles whose solution asks for several moves from the
player. The page fetches only the files it needs for the weaknesses it found.

Selection rules:
- Rating deviation at most 90, popularity at least 85, at least 300 plays, so
  every puzzle is one the Lichess crowd has confirmed.
- Theme files keep puzzles with at least three player moves in the solution
  (six plies, since the first move in the export is the opponent's), because
  a drill on this page is played for several moves, not one. Opening files
  accept two player moves, since positions that early are shorter, and the
  drill continues against the engine once the solution ends.
- Bands of 200 rating points from 800 to 2600; a puzzle below 800 lands in the
  lowest band and one above 2800 in the highest. Each (theme, band) cell is a
  seeded reservoir sample of PER_CELL puzzles, so the same export selects the
  same puzzles on every run (the files also record the day they were made).
- Opening families are the first token of OpeningTags (set by Lichess only for
  puzzles that start before move 20). A family is written when it has at least
  MIN_FAMILY candidates, sampled in three rating groups so a club player and an
  expert both find positions at their level.

Usage, from the repository root. The export sits beside the script or is
given as the first argument.
    curl -O https://database.lichess.org/lichess_db_puzzle.csv.zst
    python3 tools/chess-assets/curate-drill-pool.py [path/to/lichess_db_puzzle.csv.zst]
Writes tools/chess-assets/drill-pool/index.json, <theme>.json, and
openings/<family>.json. Source: https://database.lichess.org/#puzzles (CC0).
"""
import csv
import collections
import datetime
import json
import os
import random
import re
import shutil
import subprocess
import sys

random.seed(42)

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'lichess_db_puzzle.csv.zst')
OUT_DIR = os.path.join(HERE, 'drill-pool')
OPENINGS_DIR = os.path.join(OUT_DIR, 'openings')

BAND_LO, BAND_HI, BAND = 800, 2600, 200
BANDS = list(range(BAND_LO, BAND_HI + 1, BAND))
PER_CELL = 60
MIN_FAMILY = 300
OPENING_GROUPS = [(0, 1400), (1400, 1900), (1900, 4000)]
PER_OPENING_GROUP = 50
MAX_DEV, MIN_POP, MIN_PLAYS = 90, 85, 300
MIN_THEME_PLIES, MIN_OPENING_PLIES = 6, 4

# Themes the profile can send a player to, in the order the page lists them.
THEMES = [
    'hangingPiece', 'fork', 'pin', 'skewer', 'discoveredAttack', 'discoveredCheck', 'doubleCheck',
    'trappedPiece', 'deflection', 'attraction', 'clearance', 'interference', 'capturingDefender',
    'xRayAttack', 'intermezzo', 'sacrifice',
    'backRankMate', 'mateIn3', 'mateIn4', 'smotheredMate', 'arabianMate', 'anastasiaMate', 'hookMate',
    'exposedKing', 'kingsideAttack', 'queensideAttack', 'attackingF2F7',
    'defensiveMove', 'quietMove', 'zugzwang',
    'advancedPawn', 'promotion',
    'pawnEndgame', 'rookEndgame', 'bishopEndgame', 'knightEndgame', 'queenEndgame', 'queenRookEndgame',
]
THEME_SET = set(THEMES)


def band_of(rating):
    return max(BAND_LO, min(BAND_HI, (rating // BAND) * BAND))


def group_of(rating):
    for i, (lo, hi) in enumerate(OPENING_GROUPS):
        if lo <= rating < hi:
            return i
    return len(OPENING_GROUPS) - 1


class Reservoir:
    """Seeded reservoir sample of a fixed size over a stream of rows."""

    def __init__(self, keep):
        self.keep = keep
        self.rows = []
        self.seen = 0

    def offer(self, row):
        self.seen += 1
        if len(self.rows) < self.keep:
            self.rows.append(row)
        else:
            j = random.randrange(self.seen)
            if j < self.keep:
                self.rows[j] = row


FAMILY = re.compile(r'^[A-Za-z0-9_\-]{1,60}$')
PUZZLE_ID = re.compile(r'^[A-Za-z0-9]{5}$')
UCI = re.compile(r'^[a-h][1-8][a-h][1-8][qrbn]?$')


def family_of(row):
    """The first opening tag as a file-name-safe slug, or an empty string."""
    if len(row) <= 9 or not row[9]:
        return ''
    first = row[9].split()[0]
    return first if FAMILY.match(first) else ''


def row_ok(row):
    """Every field this script reads is present and well formed."""
    if len(row) < 10 or not PUZZLE_ID.match(row[0]) or len(row[1]) > 100 or len(row[7]) > 300:
        return False
    moves = row[2].split()
    return 0 < len(moves) <= 40 and all(UCI.match(m) for m in moves)


def compact(row):
    """[id, fen, moves, rating, themes, opening family]"""
    return [row[0], row[1], row[2], int(row[3]), row[7], family_of(row)]


def display_name(family):
    return family.replace('_', ' ')


def main():
    if not os.path.exists(RAW):
        sys.exit('export not found: ' + RAW)
    theme_cells = {}       # (theme, band) -> Reservoir
    family_groups = {}     # (family, group) -> Reservoir
    family_counts = collections.Counter()
    scanned = kept = 0
    proc = subprocess.Popen(['zstdcat', RAW], stdout=subprocess.PIPE, text=True)
    reader = csv.reader(proc.stdout)
    header = next(reader)
    expected = ['PuzzleId', 'FEN', 'Moves', 'Rating', 'RatingDeviation', 'Popularity', 'NbPlays', 'Themes', 'GameUrl', 'OpeningTags']
    if header[:10] != expected:
        sys.exit('unexpected columns: ' + ','.join(header))
    for row in reader:
        scanned += 1
        if not row_ok(row):
            continue
        try:
            rating = int(row[3]); dev = int(row[4]); pop = int(row[5]); plays = int(row[6])
        except (ValueError, IndexError):
            continue
        if dev > MAX_DEV or pop < MIN_POP or plays < MIN_PLAYS:
            continue
        plies = len(row[2].split())
        if plies < MIN_OPENING_PLIES:
            continue
        kept += 1
        tags = row[7].split()
        if plies >= MIN_THEME_PLIES:
            band = band_of(rating)
            for t in tags:
                if t in THEME_SET:
                    theme_cells.setdefault((t, band), Reservoir(PER_CELL)).offer(row)
        family = family_of(row)
        if family:
            family_counts[family] += 1
            family_groups.setdefault((family, group_of(rating)), Reservoir(PER_OPENING_GROUP)).offer(row)
    if proc.wait() != 0:
        sys.exit('zstdcat failed; the pool was not written')
    print(f'scanned={scanned} kept={kept}', file=sys.stderr)

    # write the whole pool beside the old one, then swap, so a failure part
    # way through never leaves a half-replaced directory
    staging = OUT_DIR + '.staging'
    shutil.rmtree(staging, ignore_errors=True)
    os.makedirs(os.path.join(staging, 'openings'))
    today = datetime.date.today().isoformat()
    source = 'Lichess puzzle database (CC0), https://database.lichess.org/#puzzles'
    index = {'v': 1, 'generated': today, 'source': source, 'bands': BANDS, 'themes': {}, 'openings': {}}

    for t in THEMES:
        puzzles = []
        counts = {}
        for band in BANDS:
            cell = theme_cells.get((t, band))
            rows = sorted(cell.rows, key=lambda r: int(r[3])) if cell else []
            counts[str(band)] = len(rows)
            puzzles.extend(compact(r) for r in rows)
        index['themes'][t] = counts
        with open(os.path.join(staging, t + '.json'), 'w') as f:
            json.dump({'v': 1, 'theme': t, 'generated': today, 'source': source, 'puzzles': puzzles}, f, separators=(',', ':'))

    written = 0
    for family, count in family_counts.most_common():
        if count < MIN_FAMILY:
            break
        puzzles = []
        for g in range(len(OPENING_GROUPS)):
            cell = family_groups.get((family, g))
            if cell:
                puzzles.extend(compact(r) for r in sorted(cell.rows, key=lambda r: int(r[3])))
        if not puzzles:
            continue
        index['openings'][family] = {'name': display_name(family), 'count': len(puzzles)}
        target = os.path.join(staging, 'openings', family + '.json')
        assert os.path.dirname(os.path.abspath(target)) == os.path.abspath(os.path.join(staging, 'openings'))
        with open(target, 'w') as f:
            json.dump({'v': 1, 'family': family, 'name': display_name(family), 'generated': today, 'source': source, 'puzzles': puzzles}, f, separators=(',', ':'))
        written += 1

    with open(os.path.join(staging, 'index.json'), 'w') as f:
        json.dump(index, f, separators=(',', ':'))
    # the old pool is kept until the new one is in place, then removed
    old = OUT_DIR + '.old'
    shutil.rmtree(old, ignore_errors=True)
    if os.path.isdir(OUT_DIR):
        os.rename(OUT_DIR, old)
    try:
        os.rename(staging, OUT_DIR)
    except OSError:
        if os.path.isdir(old):
            os.rename(old, OUT_DIR)
        raise
    shutil.rmtree(old, ignore_errors=True)
    total = sum(sum(c.values()) for c in index['themes'].values())
    print(f'{len(THEMES)} theme files ({total} puzzles), {written} opening files, index written to {OUT_DIR}', file=sys.stderr)


if __name__ == '__main__':
    main()
