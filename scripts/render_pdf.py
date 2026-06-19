#!/usr/bin/env python3
"""Convert any smOS HTML report to PDF via headless Chromium (Playwright).

Usage:
    python scripts/render_pdf.py <input.html> [--output <out.pdf>] [--format A4|Letter]

If --output is omitted, the PDF is written next to the HTML with the same
basename. Used by every report-producing skill so deliverables ship in both
HTML (interactive) and PDF (shareable) form.

Install once:
    pip install playwright && python -m playwright install chromium
"""

import argparse
import sys
from pathlib import Path


def html_to_pdf(html_path: Path, pdf_path: Path, page_format: str = "Letter") -> Path:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print(
            "ERROR: playwright not installed. Run:\n"
            "  pip install playwright && python -m playwright install chromium",
            file=sys.stderr,
        )
        sys.exit(1)

    html_path = html_path.resolve()
    pdf_path = pdf_path.resolve()
    pdf_path.parent.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page()
        page.goto(html_path.as_uri(), wait_until="networkidle")
        page.emulate_media(media="print")
        page.pdf(
            path=str(pdf_path),
            format=page_format,
            print_background=True,
            margin={"top": "0", "right": "0", "bottom": "0", "left": "0"},
            prefer_css_page_size=True,
        )
        browser.close()
    return pdf_path


def main():
    p = argparse.ArgumentParser(description="Convert an HTML report to PDF")
    p.add_argument("input", help="Path to input HTML file")
    p.add_argument("--output", help="Output PDF path (default: alongside HTML)")
    p.add_argument("--format", default="Letter", choices=["Letter", "A4", "Legal"])
    args = p.parse_args()

    html_path = Path(args.input)
    if not html_path.exists():
        print(f"ERROR: HTML not found: {html_path}", file=sys.stderr)
        sys.exit(1)

    pdf_path = Path(args.output) if args.output else html_path.with_suffix(".pdf")
    out = html_to_pdf(html_path, pdf_path, page_format=args.format)
    print(f"PDF written to: {out}")


if __name__ == "__main__":
    main()
