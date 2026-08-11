"""Simulate a reader who completed the previous 27-lesson build, then check that
inserting four lessons into the middle of Part One does not strand their progress."""
import json
from playwright.sync_api import sync_playwright

D = json.load(open("/home/parallels/website/_site/tools/chess-assets/course-lessons.json"))
NEW = {"planning-read-not-invent", "planning-follow-the-board",
       "planning-three-thinkers", "planning-talk-to-the-board"}
old = [l["id"] for l in D["lessons"] if l["id"] not in NEW]          # the 27 they finished
seed = json.dumps({"done": {i: "2026-08-10" for i in old}, "cur": None})
ok = True
def check(c, m):
    global ok
    ok = ok and c
    print(("  ok   " if c else "  FAIL ") + m)

with sync_playwright() as pw:
    b = pw.chromium.launch(); p = b.new_page(viewport={"width": 1400, "height": 1000})
    p.goto("http://localhost:8899/tools/reassess-your-chess.html", wait_until="networkidle")
    p.evaluate(f"localStorage.setItem('reassess-chess-v1', {json.dumps(seed)})")
    p.reload(wait_until="networkidle"); p.wait_for_selector(".ryc-row")

    check(p.locator(".ryc-row .rw-mark.done").count() == len(old),
          f"all {len(old)} finished lessons still green")
    stranded = p.locator(".ryc-row.locked .rw-mark.done").count()
    check(stranded == 0, f"no lesson is both finished and locked ({stranded} found)")
    exp_locked = len(NEW) - 1          # the first inserted lesson is reachable, the rest are not
    got = p.locator(".ryc-row.locked").count()
    check(got == exp_locked, f"only the {exp_locked} unreached new lessons are locked (got {got})")
    check(p.locator("#rycProgLabel").inner_text().startswith(f"{len(old)} of {len(D['lessons'])}"),
          f"progress reads {len(old)} of {len(D['lessons'])}")

    p.locator("#rycContinue").click(); p.wait_for_selector("#rycLesson", state="visible")
    t = p.locator("#rycTitle").inner_text()
    check(t == "Planning is reading, not inventing", f"Continue opens the first new lesson: {t!r}")

    # the capstone sits after the new lessons and must still be reachable
    p.locator("#rycBack").click(); p.wait_for_selector("#rycSyllabus", state="visible")
    rows = p.locator(".ryc-row")
    idx = [i for i in range(rows.count())
           if "Nisipeanu" in rows.nth(i).inner_text()][0]
    check("locked" not in (rows.nth(idx).get_attribute("class") or ""),
          "the already-completed capstone stays open despite the insertion before it")
    b.close()
print("\nPASS" if ok else "\nFAIL")
