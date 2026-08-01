"""
Rebuild daily-puzzles.json as a technique-cycling curriculum, days 4-1000.
Days 1-3 are preserved verbatim from the existing file (already played/committed).

Design (agreed in planning):
- Days 4-730: existing quota shape (10 -> 1 puzzle/day, stepping down every 73 days).
  Odd/even day pairing from day 4: a "block" day teaches ONE technique (quota
  puzzles, ascending difficulty); the following "interleave" day mixes puzzles
  from the last <=3 taught techniques, at the CURRENT band (so old techniques
  get reviewed at today's difficulty, not the easier band they were first taught
  at). One full pass through the technique list bumps the target rating band up
  by 100 points for the next pass. Band is capped at 2500-2599 for the main
  curriculum; 2600+ is reserved for the tail.
- Days 731-1000: 1 extremely hard puzzle/day, rating >=2600, continuing the SAME
  technique rotation (not reset). Prefers 2700-2799 per technique, falls back to
  2600-2699 when that technique doesn't have enough at 2700+.
- Repetition philosophy (explicitly agreed): repeat the THEME, not the exact
  puzzle -- random sampling from each (technique, band) pool each time, with a
  short recent-exclusion window (last 15 draws from that exact cell) just so the
  same exact puzzle can't reappear on back-to-back visits. No global "never
  reuse a puzzle ID across the whole plan" bookkeeping.
Reproducible: seed 42, matching the original curation script's convention.

Usage: download the current export alongside this script, then run in place:
    curl -O https://database.lichess.org/lichess_db_puzzle.csv.zst
    python3 curate-daily-puzzles.py
Reads and overwrites ./daily-puzzles.json (days 1-3 are read from the existing
file and carried over unchanged before it's overwritten).
"""
import csv, random, subprocess, sys, json, collections, os

random.seed(42)

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'lichess_db_puzzle.csv.zst')
OLD_JSON = os.path.join(HERE, 'daily-puzzles.json')
OUT_JSON = OLD_JSON

LO, HI, BAND = 1200, 2800, 100
NBANDS = (HI - LO) // BAND  # 16, bands 0..15 => 1200-1299 .. 2700-2799
def band_of(rating):
    b = (rating - LO) // BAND
    return max(0, min(NBANDS - 1, b))

LENGTH_TAGS = {'oneMove', 'short', 'long', 'veryLong'}
META_TAGS = {'advantage', 'crushing', 'equality', 'master', 'masterVsMaster', 'superGM'}
PHASE_TAGS = {'opening', 'middlegame', 'endgame'}

# Ordered curriculum: simplest/most exploitable ideas first, building up.
TECHNIQUES = [
    # foundational tactics
    'hangingPiece', 'fork', 'pin', 'skewer', 'discoveredAttack', 'discoveredCheck', 'doubleCheck',
    # removing the defender
    'deflection', 'attraction', 'clearance', 'interference', 'capturingDefender', 'xRayAttack',
    'trappedPiece', 'intermezzo',
    # mating attacks
    'exposedKing', 'kingsideAttack', 'queensideAttack', 'mateIn2', 'backRankMate', 'mateIn3',
    'mateIn4', 'mateIn5',
    # endgame technique
    'pawnEndgame', 'rookEndgame', 'bishopEndgame', 'knightEndgame', 'queenEndgame', 'queenRookEndgame',
    # positional / advanced
    'advancedPawn', 'promotion', 'zugzwang', 'quietMove', 'defensiveMove', 'sacrifice', 'attackingF2F7',
]
TECH_SET = {t: i for i, t in enumerate(TECHNIQUES)}
RESERVOIR_KEEP = 220     # per (technique, band) cell -- comfortable headroom over lifetime draws
MIN_CELL = 60            # below this, widen to neighboring bands before trusting a cell

# ---------- pass 1: stream the raw dump once, build per-(technique,band) reservoirs ----------
reservoirs = {}   # (tech_idx, band) -> list[row]
counts = collections.Counter()
scanned = kept = 0

proc = subprocess.Popen(['zstdcat', RAW], stdout=subprocess.PIPE, text=True)
reader = csv.reader(proc.stdout)
next(reader)  # header
for row in reader:
    scanned += 1
    try:
        rating = int(row[3]); dev = int(row[4]); pop = int(row[5]); plays = int(row[6])
    except (ValueError, IndexError):
        continue
    if not (LO <= rating < HI): continue
    if dev > 85 or pop < 90 or plays < 600: continue
    moves = row[2].split()
    if len(moves) < 4: continue
    kept += 1
    b = band_of(rating)
    tags = row[7].split()
    for t in tags:
        ti = TECH_SET.get(t)
        if ti is None: continue
        key = (ti, b)
        counts[key] += 1
        r = reservoirs.setdefault(key, [])
        if len(r) < RESERVOIR_KEEP:
            r.append(row)
        else:
            j = random.randrange(counts[key])
            if j < RESERVOIR_KEEP:
                r[j] = row
proc.wait()
print(f"scanned={scanned} kept_after_filters={kept}", file=sys.stderr)
print(f"cells built: {len(reservoirs)} / {len(TECHNIQUES) * NBANDS} possible", file=sys.stderr)

# ---------- helpers ----------
recent_used = collections.defaultdict(collections.deque)  # (ti,band) -> recently drawn puzzle ids

def cell_pool(ti, band):
    """Pool for (technique, band), widened to neighbors if too thin. None if unusable."""
    base = reservoirs.get((ti, band), [])
    if len(base) >= MIN_CELL:
        return base
    wide = list(base)
    for nb in (band - 1, band + 1):
        if 0 <= nb < NBANDS:
            wide.extend(reservoirs.get((ti, nb), []))
    return wide if wide else None

def draw(ti, band, n):
    """Random draw of up to n rows for (technique,band), honoring the recent-exclusion window."""
    pool = cell_pool(ti, band)
    if not pool: return []
    key = (ti, band)
    excluded = set(recent_used[key])
    avail = [row for row in pool if row[0] not in excluded]
    if len(avail) < n:
        avail = pool  # thin cell: drop the exclusion rather than come up short
    picks = random.sample(avail, min(n, len(avail)))
    dq = recent_used[key]
    for p in picks:
        dq.append(p[0])
        while len(dq) > 15: dq.popleft()
    return picks

def draw_exact(ti, band, n):
    """Like draw(), but never widens to neighboring bands -- for the tail's
    strict 2700-then-2600 priority order."""
    pool = reservoirs.get((ti, band), [])
    if not pool: return []
    key = (ti, band)
    excluded = set(recent_used[key])
    avail = [row for row in pool if row[0] not in excluded]
    if len(avail) < n:
        avail = pool
    picks = random.sample(avail, min(n, len(avail)))
    dq = recent_used[key]
    for p in picks:
        dq.append(p[0])
        while len(dq) > 15: dq.popleft()
    return picks

def draw_tail(ti, q):
    """Extreme-tail draw: fill from 2700-2799 first, only reach into 2600-2699
    for whatever 2700+ couldn't cover. cell_pool()'s neighbor-widening would
    dilute the 2700 preference by mixing in the much larger 2600 pool, so this
    draws band-by-band directly instead."""
    picks = draw_exact(ti, 15, q)
    if len(picks) < q:
        picks += draw_exact(ti, 14, q - len(picks))
    if len(picks) < q:   # ultra-defensive; not expected given the real inventory
        picks += draw_exact(ti, 13, q - len(picks))
    return picks

def make_row(row, tech, day_type):
    themes = ' '.join(t for t in row[7].split() if t not in LENGTH_TAGS)
    return [row[0], row[1], row[2], int(row[3]), themes, tech, day_type]

# ---------- pass 2: schedule days 4..1000 ----------
DAYS = 1000
def quota_of(d):
    return 10 - (d - 1) // 73 if d <= 730 else 1

old = json.load(open(OLD_JSON))['puzzles']
schedule = [[r[0], r[1], r[2], r[3], r[4], '', 'legacy'] for r in old[0:30]]  # days 1-3, untouched

taught = 0            # count of successfully completed BLOCK days -> drives pass number & technique identity
taught_at_730 = None  # snapshot for diagnostics (the tail keeps advancing `taught` too)
recent_techs = []      # up to 3 most recently taught techniques, for interleave days
skipped_slots = []     # diagnostics: (day, reason)

def band_for_pass(p):
    return min(p - 1, 13)   # cap at 2500-2599; 2600+ reserved for the tail

for d in range(4, DAYS + 1):
    if d == 731:
        taught_at_730 = taught
    q = quota_of(d)
    if d > 730:
        # "extremely difficult" is a hard promise here: skip forward to the next
        # technique in rotation rather than accept a sub-2600 fallback (some
        # techniques, e.g. backRankMate, are recognizable enough that Lichess
        # solvers rarely rate them that brutally even in a hard position).
        tech, picks = None, []
        for offset in range(len(TECHNIQUES)):
            idx = (taught + offset) % len(TECHNIQUES)
            t = TECHNIQUES[idx]
            cand = draw_exact(TECH_SET[t], 15, q)
            if len(cand) < q:
                cand = cand + draw_exact(TECH_SET[t], 14, q - len(cand))
            if len(cand) >= q:
                tech, picks = t, cand
                break
        if tech is None:   # not expected given real inventory; keep the day populated
            tech = TECHNIQUES[taught % len(TECHNIQUES)]
            picks = draw_tail(TECH_SET[tech], q)
            skipped_slots.append((d, f'tail: no technique cleared 2600, used {tech} as fallback'))
        taught += 1
        for row in picks:
            schedule.append(make_row(row, tech, 'tail'))
        continue

    rd = d - 4
    blocked = (rd % 2 == 0)
    pass_num = taught // len(TECHNIQUES) + 1
    band = band_for_pass(pass_num)

    if blocked:
        picks, chosen = [], None
        for offset in range(len(TECHNIQUES)):
            idx = (taught + offset) % len(TECHNIQUES)
            t = TECHNIQUES[idx]
            got = draw(TECH_SET[t], band, q)
            if got:
                picks, chosen = got, t
                break
        if chosen is None:
            skipped_slots.append((d, f'no technique usable at band {band}'))
            continue
        picks.sort(key=lambda r: int(r[3]))   # ascending -> stairstep within the day
        recent_techs.append(chosen)
        if len(recent_techs) > 3: recent_techs.pop(0)
        for row in picks:
            schedule.append(make_row(row, chosen, 'block'))
        taught += 1
        if len(picks) < q:
            skipped_slots.append((d, f'block short by {q - len(picks)} for {chosen}'))
    else:
        pool_techs = recent_techs or [TECHNIQUES[0]]
        n_each = q // len(pool_techs)
        rem = q - n_each * len(pool_techs)
        picks_all = []
        for i, t in enumerate(pool_techs):
            n = n_each + (1 if i < rem else 0)
            if n <= 0: continue
            for row in draw(TECH_SET[t], band, n):
                picks_all.append((row, t))
        while len(picks_all) < q and pool_techs:
            got = draw(TECH_SET[pool_techs[-1]], band, 1)
            if not got: break
            picks_all.append((got[0], pool_techs[-1]))
        random.shuffle(picks_all)
        for row, t in picks_all:
            schedule.append(make_row(row, t, 'interleave'))
        if len(picks_all) < q:
            skipped_slots.append((d, f'interleave short by {q - len(picks_all)}'))

print(f"\ntotal schedule rows: {len(schedule)}", file=sys.stderr)
_p730 = taught_at_730 // len(TECHNIQUES) + 1
print(f"blocked days through 730: {taught_at_730}, passes: {taught_at_730/len(TECHNIQUES):.2f}, "
      f"final band reached: {band_for_pass(_p730)} ({LO+band_for_pass(_p730)*BAND}-{LO+band_for_pass(_p730)*BAND+99})", file=sys.stderr)
print(f"short/skipped slots: {len(skipped_slots)}", file=sys.stderr)
for s in skipped_slots[:30]:
    print("  ", s, file=sys.stderr)

data = {"v": 2, "total": len(schedule), "techniques": TECHNIQUES, "puzzles": schedule}
with open(OUT_JSON, 'w') as f:
    json.dump(data, f, separators=(',', ':'))
print("size:", os.path.getsize(OUT_JSON), "bytes", file=sys.stderr)
