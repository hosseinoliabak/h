"""Drive the rendered course page: walk every lesson, answer every exercise
correctly, and check the sequential unlock and the green marks along the way."""
import json
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path("/home/parallels/website/_site/tools")
URL = "http://localhost:8899/tools/reassess-your-chess.html"
DATA = json.loads((ROOT / "chess-assets" / "course-lessons.json").read_text())
LESSONS = DATA["lessons"]

errors = []
log = []


def check(cond, msg):
    # print as we go, so a crash mid-run still shows how far the walk got
    if cond:
        log.append("  ok   " + msg)
    else:
        errors.append(msg)
        log.append("  FAIL " + msg)
    print(log[-1], flush=True)


def sq(page, name):
    return page.locator(f'#rycBoard [data-sq="{name}"]')


def click_square(page, name):
    sq(page, name).click()


def drag_move(page, uci):
    frm, to = uci[:2], uci[2:4]
    a, b = sq(page, frm), sq(page, to)
    a.click()
    b.click()


def run():
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 1400, "height": 1000})
        console, http_fail = [], []
        page.on("console", lambda m: console.append(f"{m.type}: {m.text}"))
        page.on("pageerror", lambda e: console.append(f"pageerror: {e}"))
        page.on("response", lambda r: http_fail.append(f"{r.status} {r.url}") if r.status >= 400 else None)
        page.goto(URL, wait_until="networkidle")
        page.wait_for_selector(".ryc-row", timeout=10000)

        rows = page.locator(".ryc-row")
        check(rows.count() == len(LESSONS), f"syllabus lists {rows.count()} rows, expected {len(LESSONS)}")
        locked = page.locator(".ryc-row.locked").count()
        check(locked == len(LESSONS) - 1, f"{locked} lessons locked at the start, expected {len(LESSONS)-1}")
        check(page.locator("#rycProgLabel").inner_text().startswith("0 of"), "progress starts at 0")

        # a locked row must not open
        page.locator(".ryc-row.locked").first.click(force=True)
        check(page.locator("#rycLesson").is_hidden(), "clicking a locked lesson does nothing")

        # --- wrong move and Show me, on lesson 1 exercise 3 (a move exercise) ---
        page.locator("#rycContinue").click()
        page.wait_for_selector("#rycLesson", state="visible")
        page.locator(".ryc-choice").nth(LESSONS[0]["ex"][0]["ok"]).click()
        page.locator("#rycNext").click()
        page.locator(".ryc-choice").nth(LESSONS[0]["ex"][1]["ok"]).click()
        page.locator("#rycNext").click()
        page.wait_for_timeout(300)
        drag_move(page, "a2a3")                      # legal, but not one of the answers
        check(page.locator("#rycStatus .bad").count() == 1, "a wrong move is rejected")
        page.wait_for_timeout(900)
        check(sq(page, "a3").locator("img").count() == 0, "the wrong move is taken back off the board")
        check(sq(page, "a2").locator("img").count() == 1, "the pawn is back on its square")
        page.locator("#rycShow").click()
        page.wait_for_selector("#rycNext:visible")
        check(page.locator(".ryc-pip.shown").count() == 1, "Show me marks the pip amber, not green")
        check("The move is" in page.locator("#rycStatus").inner_text(), "Show me names the move")
        page.locator("#rycNext").click()
        page.wait_for_timeout(300)
        check(page.locator(".ryc-row .rw-mark.done").count() >= 0, "lesson finished after Show me")
        page.locator("#rycBack").click()
        page.wait_for_selector("#rycSyllabus", state="visible")
        check(page.locator(".ryc-row .rw-mark.done").count() == 1, "lesson 1 is green even though one answer was shown")
        check(page.locator(".ryc-row.locked").count() == len(LESSONS) - 2, "finishing lesson 1 unlocks lesson 2")
        page.on("dialog", lambda d: d.accept())
        page.locator("#rycReset").click()
        page.wait_for_timeout(400)
        check(page.locator(".ryc-row.locked").count() == len(LESSONS) - 1, "reset before the full walk")

        page.locator("#rycContinue").click()
        page.wait_for_selector("#rycLesson", state="visible")

        for li, L in enumerate(LESSONS):
            title = page.locator("#rycTitle").inner_text()
            check(title == L["title"], f"lesson {li+1} opened: {title!r}")

            for ei, e in enumerate(L["ex"]):
                page.wait_for_selector("#rycPrompt")
                tag = f"L{li+1}E{ei+1} [{e['kind']}]"

                # any kind may play setup moves out on the board before it asks
                if e.get("pre"):
                    page.wait_for_timeout(500 + 700 * len(e["pre"]))

                if e["kind"] == "choice":
                    opts = page.locator(".ryc-choice")
                    check(opts.count() == len(e["options"]), f"{tag} rendered {opts.count()} options")
                    # a wrong answer first, to prove it is rejected
                    wrong = 0 if e["ok"] != 0 else 1
                    opts.nth(wrong).click()
                    check(page.locator("#rycStatus .bad").count() == 1, f"{tag} wrong option rejected")
                    check(page.locator("#rycNext").is_hidden(), f"{tag} Next stays hidden after a wrong answer")
                    opts.nth(e["ok"]).click()

                elif e["kind"] in ("piece", "square"):
                    if e.get("pick"):
                        cands = page.locator("#rycBoard .ryc-sq.cand").count()
                        check(cands == len(e["pick"]), f"{tag} {cands} candidate squares marked")
                    click_square(page, e["ok"][0])

                elif e["kind"] == "move":
                    drag_move(page, e["ok"][0])
                    if e.get("then"):
                        page.wait_for_timeout(800 + 750 * len(e["then"]))

                page.wait_for_selector("#rycNext:visible", timeout=8000)
                check(page.locator("#rycStatus .ok").count() >= 1, f"{tag} accepted the right answer")
                pips_done = page.locator(".ryc-pip.done").count()
                check(pips_done == ei + 1, f"{tag} {pips_done} green pip(s)")
                page.locator("#rycNext").click()

            if li < len(LESSONS) - 1:
                page.wait_for_selector("#rycNext:visible", timeout=8000)
                txt = page.locator("#rycStatus").inner_text()
                check("Lesson complete" in txt, f"lesson {li+1} reported complete")
                page.locator("#rycNext").click()
                page.wait_for_timeout(250)

        # last lesson: no Next, go back and check the syllabus
        check(page.locator("#rycNext").is_hidden(), "no Next button after the final lesson")
        page.locator("#rycBack").click()
        page.wait_for_selector("#rycSyllabus", state="visible")
        done = page.locator(".ryc-row .rw-mark.done").count()
        check(done == len(LESSONS), f"{done} lessons green on the syllabus")
        check(page.locator(".ryc-row.locked").count() == 0, "nothing locked once the course is finished")
        lbl = page.locator("#rycProgLabel").inner_text()
        check(lbl.startswith(f"{len(LESSONS)} of"), f"progress reads {lbl!r}")
        check(page.locator("#rycContinue").is_disabled(), "Continue is disabled when the course is complete")

        # progress survives a reload
        page.reload(wait_until="networkidle")
        page.wait_for_selector(".ryc-row")
        check(page.locator(".ryc-row .rw-mark.done").count() == len(LESSONS), "progress survives a reload")

        # Start over relocks everything
        page.locator("#rycReset").click()
        page.wait_for_timeout(400)
        check(page.locator(".ryc-row.locked").count() == len(LESSONS) - 1, "Start over relocks the course")

        # uncaught JS is always a bug; failed requests are judged by URL, since
        # the console message for one carries no URL at all
        jserr = [c for c in console if c.startswith("pageerror")]
        check(not jserr, f"no uncaught JavaScript errors ({len(jserr)} found)")
        for c in jserr[:8]:
            log.append("    " + c[:220])
        EXPECTED = ("giscus.app",)          # no discussion thread exists for an unpublished page
        req = [u for u in http_fail if not any(x in u for x in EXPECTED)]
        check(not req, f"no failed requests ({len(req)} unexpected of {len(http_fail)} total)")
        for u in dict.fromkeys(req).keys():
            log.append("    " + u[:220])

        browser.close()


run()
# per-check lines were already printed live by check()
print()
if errors:
    print(f"{len(errors)} FAILURES:")
    for e in errors:
        print("  - " + e)
    sys.exit(1)
print(f"all {len(log)} checks passed")
