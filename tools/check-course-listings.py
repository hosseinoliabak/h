#!/usr/bin/env python3
"""Quarto pre-render guard: every course subdirectory must appear in its
section overview page.

A "section" is a top-level directory whose index.qmd exists (machine-learning,
math, networking, deep-learning, ...). A "course" is a child directory of a
section that contains at least one .qmd file. Each course must be referenced
in the section's index.qmd with a {{< course-listing <dirname> >}} shortcode.

To intentionally exclude a course from the overview, add this HTML comment
anywhere in the section index.qmd:

    <!-- no-course-listing: dirname -->

Exits non-zero (aborting the render) when a course is missing, so the
overview page can never silently fall out of date.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKIP_DIRS = {"_site", "_extensions", "_templates", "_firebase", "materials",
             "media", "images", "data", "draft", "tmp", "tools",
             "__pycache__", ".venv", ".git", ".claude", ".kiro", ".github"}

failures = []

for section in sorted(ROOT.iterdir()):
    if not section.is_dir() or section.name in SKIP_DIRS or section.name.startswith("."):
        continue
    index = section / "index.qmd"
    if not index.exists():
        continue
    text = index.read_text(encoding="utf-8")
    listed = set(re.findall(r"{{<\s*course-listing\s+(\S+)\s*>}}", text))
    ignored = set(re.findall(r"<!--\s*no-course-listing:\s*(\S+)\s*-->", text))
    for course in sorted(section.iterdir()):
        if not course.is_dir() or course.name.startswith((".", "_")):
            continue
        if not any(course.glob("*.qmd")):
            continue
        if course.name not in listed and course.name not in ignored:
            failures.append(
                f"{section.name}/index.qmd is missing "
                f"{{{{< course-listing {course.name} >}}}} for {section.name}/{course.name}/"
            )

if failures:
    print("Overview pages out of date:", file=sys.stderr)
    for f in failures:
        print(f"  - {f}", file=sys.stderr)
    print("Add the shortcode (and a heading linking to the course index page), "
          "or mark it ignored with <!-- no-course-listing: dirname -->.",
          file=sys.stderr)
    sys.exit(1)
