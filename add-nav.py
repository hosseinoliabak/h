#!/usr/bin/env python3
"""Strip all manual nav blocks from qmd files."""

import os
import re

BASE = "/home/parallels/website"
NAV_MARKER = '\n\n```{=html}\n<div style="display:flex;'

for root, dirs, filenames in os.walk(BASE):
    dirs[:] = [d for d in dirs if d not in ("_site", ".quarto", "node_modules", "_templates")]
    for fn in filenames:
        if not fn.endswith(".qmd"):
            continue
        path = os.path.join(root, fn)
        with open(path) as f:
            content = f.read()
        idx = content.find(NAV_MARKER)
        if idx == -1:
            continue
        content = content[:idx].rstrip("\n -") + "\n"
        with open(path, "w") as f:
            f.write(content)
        print(f"Cleaned: {path}")

print("Done.")
