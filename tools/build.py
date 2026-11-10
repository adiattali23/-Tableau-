#!/usr/bin/env python3
"""Build the ORÉ site pages.

Every page in src/pages/*.html starts with a small header block:

    <!--
    title: החנות | ORÉ
    description: ...
    page: shop
    -->

followed by the page's <main> content. This script wraps each page with the
shared parts in src/partials/ (head, announcement bar, header, footer, cart
drawer, search) and writes the finished page to the project root, e.g. shop.html.

Run from the project root:   python3 tools/build.py
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src"


def partial(name):
    return (SRC / "partials" / f"{name}.html").read_text(encoding="utf-8").rstrip() + "\n"


def parse(page_text):
    m = re.match(r"\s*<!--(.*?)-->\s*", page_text, re.S)
    meta = {}
    if m:
        for line in m.group(1).strip().splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip()
        page_text = page_text[m.end():]
    return meta, page_text


def build():
    shell = partial("shell")
    for src in sorted((SRC / "pages").glob("*.html")):
        meta, body = parse(src.read_text(encoding="utf-8"))
        html = shell
        html = html.replace("{{title}}", meta.get("title", "ORÉ"))
        html = html.replace("{{description}}", meta.get("description", ""))
        html = html.replace("{{page}}", meta.get("page", src.stem))
        html = html.replace("{{announce}}", partial("announce"))
        html = html.replace("{{header}}", partial("header"))
        html = html.replace("{{footer}}", partial("footer"))
        html = html.replace("{{overlays}}", partial("overlays"))
        html = html.replace("{{main}}", body.rstrip() + "\n")
        # mark the current menu item
        current = meta.get("nav")
        if current:
            html = html.replace(f'data-nav="{current}"', f'data-nav="{current}" aria-current="page"', 1)
        out = ROOT / src.name
        out.write_text(html, encoding="utf-8")
        print("built", out.name)


if __name__ == "__main__":
    build()
