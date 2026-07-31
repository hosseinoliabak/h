import csv, random, subprocess, sys, json

random.seed(42)

# Ramp design: 730 days, quota 10..1 stepping down every 73 days -> 73*55 = 4015 puzzles
TOTAL = 4015
LO, HI = 1200, 2800
BUCKET = 25
nbuckets = (HI - LO) // BUCKET          # 64 buckets
KEEP = 90                                # reservoir per bucket

reservoirs = [[] for _ in range(nbuckets)]
counts = [0] * nbuckets
scanned = kept_candidates = 0

proc = subprocess.Popen(['zstdcat', 'lichess_puzzles.csv.zst'], stdout=subprocess.PIPE, text=True)
reader = csv.reader(proc.stdout)
header = next(reader)

for row in reader:
    scanned += 1
    try:
        rating = int(row[3]); dev = int(row[4]); pop = int(row[5]); plays = int(row[6])
    except ValueError:
        continue
    if not (LO <= rating < HI):        continue
    if dev > 85 or pop < 90 or plays < 600: continue
    moves = row[2].split()
    if len(moves) < 4:                 continue   # at least 2 player moves: no one-movers
    b = (rating - LO) // BUCKET
    counts[b] += 1
    r = reservoirs[b]
    if len(r) < KEEP:
        r.append(row)
    else:
        j = random.randrange(counts[b])
        if j < KEEP:
            r[j] = row

proc.wait()
print(f"scanned={scanned}", file=sys.stderr)
print("bucket fill:", [len(r) for r in reservoirs], file=sys.stderr)

# Assemble: distribute TOTAL slots evenly across buckets (uniform-in-rating ramp)
per = TOTAL // nbuckets                 # 62
extra = TOTAL - per * nbuckets          # 47 leftovers spread over buckets
picked = []
for i, r in enumerate(reservoirs):
    want = per + (1 if i < extra else 0)
    take = random.sample(r, min(want, len(r)))
    picked.extend(take)

# If some buckets were short, top up from neighbors' leftovers
if len(picked) < TOTAL:
    chosen_ids = {row[0] for row in picked}
    spare = [row for r in reservoirs for row in r if row[0] not in chosen_ids]
    random.shuffle(spare)
    picked.extend(spare[:TOTAL - len(picked)])

picked.sort(key=lambda row: int(row[3]))
picked = picked[:TOTAL]

out = []
for row in picked:
    themes = [t for t in row[7].split() if t not in ('long', 'short', 'veryLong', 'oneMove')][:2]
    out.append([row[0], row[1], row[2], int(row[3]), ' '.join(themes)])

data = {"v": 1, "total": len(out), "puzzles": out}
with open('daily-puzzles.json', 'w') as f:
    json.dump(data, f, separators=(',', ':'))
print("picked:", len(out), "ratings:", out[0][3], "->", out[-1][3], file=sys.stderr)
import os
print("size:", os.path.getsize('daily-puzzles.json'), "bytes", file=sys.stderr)
