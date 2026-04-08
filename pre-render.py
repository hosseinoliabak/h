#!/usr/bin/env python3
"""
Pre-render script: extracts SVGs from {=html} blocks in .qmd files,
converts them to PNG via rsvg-convert, and injects a {=latex} block
so PDFs include the figures.
"""

import re
import subprocess
import hashlib
from pathlib import Path

WEBSITE_ROOT = Path(__file__).parent
QMD_GLOB = "**/*.qmd"
IMG_DIR_NAME = "_svg_images"
RSVG = "rsvg-convert"
PNG_DPI = 600

FENCE = "`" * 3
HTML_OPEN = FENCE + "{=html}"
HTML_CLOSE = FENCE
LATEX_OPEN = FENCE + "{=latex}"
LATEX_CLOSE = FENCE

# Build regex from variables to avoid backtick escaping issues
HTML_BLOCK_PATTERN = (
    re.escape(HTML_OPEN) + r"\n"
    r"(<div[^>]*>\s*"
    r"(<svg[\s\S]*?</svg>)"
    r"\s*</div>)\n"
    + re.escape(HTML_CLOSE)
)
HTML_BLOCK_RE = re.compile(HTML_BLOCK_PATTERN, re.MULTILINE)

LATEX_FOLLOW_PATTERN = r"\s*" + re.escape(LATEX_OPEN)
LATEX_FOLLOW_RE = re.compile(LATEX_FOLLOW_PATTERN)


# Strips <foreignObject> elements (unsupported by rsvg-convert)
# and the drawio "Text is not SVG" fallback warning
FOREIGN_OBJECT_RE = re.compile(r'<foreignObject[\s\S]*?</foreignObject>', re.MULTILINE)
DRAWIO_WARNING_RE = re.compile(r'<switch><g requiredFeatures[\s\S]*?</switch>', re.MULTILINE)


def clean_svg(svg_content: str) -> str:
    svg_content = FOREIGN_OBJECT_RE.sub('', svg_content)
    svg_content = DRAWIO_WARNING_RE.sub('', svg_content)
    return svg_content


def get_svg_width_px(svg_content: str) -> int | None:
    """Extract width in pixels from SVG width or viewBox attribute."""
    m = re.search(r'<svg[^>]+\bwidth=["\']([0-9.]+)px?["\']', svg_content)
    if m:
        return int(float(m.group(1)))
    # fallback: use viewBox width
    m = re.search(r'viewBox=["\'][\d.-]+ [\d.-]+ ([0-9.]+)', svg_content)
    if m:
        return int(float(m.group(1)))
    return None


def svg_to_png(svg_content: str, out_path: Path) -> bool:
    cleaned = clean_svg(svg_content)
    width_px = get_svg_width_px(cleaned)
    cmd = [RSVG, "--dpi-x", str(PNG_DPI), "--dpi-y", str(PNG_DPI)]
    if width_px:
        # render at 3x native width for crisp quality
        cmd += ["--width", str(width_px * 3)]
    cmd += ["-o", str(out_path), "-"]
    try:
        result = subprocess.run(cmd, input=cleaned.encode(), capture_output=True)
        return result.returncode == 0
    except FileNotFoundError:
        print(f"  [ERROR] {RSVG} not found. Install librsvg2-bin.")
        return False


def process_qmd(qmd_path: Path):
    content = qmd_path.read_text(encoding="utf-8")
    img_dir = qmd_path.parent / IMG_DIR_NAME
    new_parts = []
    last_end = 0
    changed = False

    for match in HTML_BLOCK_RE.finditer(content):
        svg_content = match.group(2)
        full_match = match.group(0)

        # Generate stable PNG filename from SVG hash
        svg_hash = hashlib.md5(svg_content.encode()).hexdigest()[:10]
        png_filename = f"{qmd_path.stem}-{svg_hash}.png"
        png_path = img_dir / png_filename
        rel_png = f"{IMG_DIR_NAME}/{png_filename}"

        img_dir.mkdir(exist_ok=True)

        if not png_path.exists():
            print(f"  Converting SVG -> {png_path.name}")
            if not svg_to_png(svg_content, png_path):
                new_parts.append(content[last_end:match.end()])
                last_end = match.end()
                continue

        # Check if a {=latex} block already follows
        after = content[match.end():match.end() + 200]
        if LATEX_FOLLOW_RE.match(after):
            new_parts.append(content[last_end:match.end()])
            last_end = match.end()
            continue

        latex_block = (
            "\n"
            + LATEX_OPEN + "\n"
            + "\\begin{center}\n"
            + f"\\includegraphics[width=0.9\\linewidth, keepaspectratio]{{{rel_png}}}\n"
            + "\\end{center}\n"
            + LATEX_CLOSE
        )

        new_parts.append(content[last_end:match.end()])
        new_parts.append(latex_block)
        last_end = match.end()
        changed = True

    new_parts.append(content[last_end:])
    new_content = "".join(new_parts)

    if changed:
        qmd_path.write_text(new_content, encoding="utf-8")
        print(f"  Updated: {qmd_path.relative_to(WEBSITE_ROOT)}")


def main():
    qmd_files = list(WEBSITE_ROOT.glob(QMD_GLOB))
    print(f"Pre-render: scanning {len(qmd_files)} .qmd files for SVGs...")
    for qmd in qmd_files:
        process_qmd(qmd)
    print("Pre-render: done.")


if __name__ == "__main__":
    main()
