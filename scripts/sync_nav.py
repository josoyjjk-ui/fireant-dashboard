#!/usr/bin/env python3
"""공용 내비게이션 동기화 — assets/nav.js 의 NAV/ICONS 를 모든 페이지에 정적 HTML로 써 넣습니다.

사용: python3 scripts/sync_nav.py
내비 항목을 고칠 때는 assets/nav.js 의 NAV 배열만 수정하고 이 스크립트를 실행합니다.
JS(assets/nav.js)와 완전히 동일한 마크업을 생성해야 하므로 렌더 함수를 그대로 미러링합니다.
"""
from __future__ import annotations

import glob
import json
import posixpath
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NAV_JS = ROOT / "assets" / "nav.js"

NAV_VERSION = "20261122"

TAB_START, TAB_END = "<!--nav:tabs-->", "<!--/nav:tabs-->"
DRAW_START, DRAW_END = "<!--nav:drawer-->", "<!--/nav:drawer-->"
BOT_START, BOT_END = "<!--nav:bottom-->", "<!--/nav:bottom-->"

SVG_OPEN = ('<svg width="20" height="20" viewBox="0 0 24 24" fill="none" '
            'stroke="currentColor" stroke-width="2" stroke-linecap="round" '
            'stroke-linejoin="round" aria-hidden="true">')
SVG_CLOSE = '</svg>'

PAGES = [
    "index.html", "m.html", "market.html", "macro-news.html", "signal.html",
    "charts.html", "kr-exchange/index.html", "revenue-meta.html", "airdrop.html",
    "winners/index.html", "donate.html", "events.html", "fng.html",
    "calendar.html", "unlocks.html",
]


# ── 공용 소스 파싱 ────────────────────────────────────────────────
def _load_source():
    src = NAV_JS.read_text(encoding="utf-8")
    m = re.search(r"/\*NAV-START\*/(.*?)/\*NAV-END\*/", src, re.S)
    if not m:
        raise SystemExit("assets/nav.js 에서 NAV 블록을 찾지 못했습니다")
    nav = json.loads(m.group(1))
    mg = re.search(r"/\*ICONS-START\*/(.*?)/\*ICONS-END\*/", src, re.S)
    if not mg:
        raise SystemExit("assets/nav.js 에서 ICONS 블록을 찾지 못했습니다")
    icons = json.loads(mg.group(1))
    mt = re.search(r"var TG = \{\s*label:\s*[\"']([^\"']*)[\"'],\s*href:\s*[\"']([^\"']*)[\"']", src)
    tg = {"label": mt.group(1), "href": mt.group(2)} if mt else {"label": "텔레그램 채널", "href": "https://t.me/fireant_crypto"}
    return nav, icons, tg


NAV, ICONS, TG = _load_source()


# ── 렌더 (nav.js 와 동일) ────────────────────────────────────────
_ESC = {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}


def esc(s) -> str:
    s = "" if s is None else str(s)
    return "".join(_ESC.get(c, c) for c in s)


def norm(p) -> str:
    s = ("" if p is None else str(p)).lower()
    q = s.find("?")
    if q > -1:
        s = s[:q]
    h = s.find("#")
    if h > -1:
        s = s[:h]
    if s[-5:] == ".html":
        s = s[:-5]
    if s[-6:] == "/index":
        s = s[:-6]
    if len(s) > 1 and s[-1] == "/":
        s = s[:-1]
    if s == "":
        s = "/"
    return s


def active_index(P):
    for i, it in enumerate(NAV):
        ms = it.get("match") or [norm(it["href"])]
        for m in ms:
            if m == "/":
                if P == "/":
                    return i
            elif P == m or P.startswith(m + "/"):
                return i
    return -1


def tab_link(it, on):
    if on:
        return '<a class="tab on" href="%s" aria-current="page">%s</a>' % (esc(it["href"]), esc(it["label"]))
    return '<a class="tab" href="%s">%s</a>' % (esc(it["href"]), esc(it["label"]))


def plain_link(it, on):
    if on:
        return '<a class="on" href="%s" aria-current="page">%s</a>' % (esc(it["href"]), esc(it["label"]))
    return '<a href="%s">%s</a>' % (esc(it["href"]), esc(it["label"]))


def bottom_link(it, on):
    icon = ICONS.get(it["href"], "")
    inner = '<span class="ic">%s%s%s</span>%s' % (SVG_OPEN, icon, SVG_CLOSE, esc(it["label"]))
    if on:
        return '<a class="on" href="%s" aria-current="page">%s</a>' % (esc(it["href"]), inner)
    return '<a href="%s">%s</a>' % (esc(it["href"]), inner)


def tabs_html(P):
    act = active_index(P)
    out = [TAB_START]
    for i, it in enumerate(NAV):
        if it.get("group") != "main":
            continue
        out.append(tab_link(it, i == act))
    more_on = act >= 0 and NAV[act].get("group") == "more"
    out.append('<div class="tab-more"><button class="tab tab-more-btn%s" type="button" '
               'aria-haspopup="true" aria-expanded="false">더보기</button><div class="more-panel">'
               % (" on" if more_on else ""))
    for i, it in enumerate(NAV):
        if it.get("group") != "more":
            continue
        out.append(plain_link(it, i == act))
    out.append("</div></div>")
    out.append(TAB_END)
    return "".join(out)


def drawer_html(P):
    act = active_index(P)
    out = [DRAW_START]
    for i, it in enumerate(NAV):
        if it.get("group") != "main":
            continue
        out.append(plain_link(it, i == act))
    out.append('<div class="ddiv"></div>')
    for i, it in enumerate(NAV):
        if it.get("group") != "more":
            continue
        out.append(plain_link(it, i == act))
    out.append('<div class="ddiv"></div>')
    out.append('<a class="sub" href="%s" target="_blank" rel="noopener">%s</a>'
               % (esc(TG["href"]), esc(TG["label"])))
    out.append(DRAW_END)
    return "".join(out)


def bottom_html(P):
    act = active_index(P)
    out = [BOT_START]
    for i, it in enumerate(NAV):
        if not it.get("bottom"):
            continue
        out.append(bottom_link(it, i == act))
    out.append(BOT_END)
    return "".join(out)


# ── 페이지 변환 ──────────────────────────────────────────────────
def _replace_marker_block(html, start, end, new):
    i = html.find(start)
    if i < 0:
        return None
    j = html.find(end, i)
    if j < 0:
        return None
    return html[:i] + new + html[j + len(end):]


def _bump_asset(html, asset, tag_fmt, insert_before):
    if asset in html:
        return re.sub(re.escape(asset) + r"(\?v=[A-Za-z0-9._-]*)?",
                      asset + "?v=" + NAV_VERSION, html)
    idx = html.rfind(insert_before)
    if idx < 0:
        return html
    return html[:idx] + tag_fmt % NAV_VERSION + html[idx:]


def apply(html: str, path: str) -> str:
    P = norm(path)

    # a) 데스크톱 탭
    new = _replace_marker_block(html, TAB_START, TAB_END, tabs_html(P))
    if new is not None:
        html = new
    else:
        i = html.find('<div class="tabs">')
        if i >= 0:
            a = i + len('<div class="tabs">')
            b = html.find("</div>", a)
            if b >= 0:
                html = html[:a] + tabs_html(P) + html[b:]

    # b) 드로어
    new = _replace_marker_block(html, DRAW_START, DRAW_END, drawer_html(P))
    if new is not None:
        html = new
    else:
        i = html.find('<aside class="drawer">')
        if i >= 0:
            k = html.find('<div class="dh">', i)
            m = html.find("</div>", k) if k >= 0 else -1
            e = html.find("</aside>", m) if m >= 0 else -1
            if m >= 0 and e >= 0:
                html = html[:m + len("</div>")] + drawer_html(P) + "\n" + html[e:]

    # c) 모바일 하단 바
    new = _replace_marker_block(html, BOT_START, BOT_END, bottom_html(P))
    if new is not None:
        html = new
    else:
        tag = '<nav class="nav" aria-label="하단 메뉴">'
        i = html.find(tag)
        if i >= 0:
            a = i + len(tag)
            e = html.find("</nav>", a)
            if e >= 0:
                html = html[:a] + bottom_html(P) + html[e:]

    # d) head / body 자산 참조
    html = _bump_asset(html, "/assets/nav.css",
                       '<link rel="stylesheet" href="/assets/nav.css?v=%s">', "</head>")
    html = _bump_asset(html, "/assets/nav.js",
                       '<script src="/assets/nav.js?v=%s"></script>', "</body>")
    return html


def path_for(file: str) -> str:
    rel = file.replace("\\", "/").lstrip("/")
    parts = rel.split("/")
    name = parts[-1]
    stem = name[:-5] if name.endswith(".html") else name
    if len(parts) == 1:
        return "/" if name == "index.html" else "/" + stem
    if name == "index.html":
        return "/" + "/".join(parts[:-1]) + "/"
    return "/" + "/".join(parts[:-1]) + "/" + stem


def main():
    files = list(PAGES)
    for f in sorted(glob.glob(str(ROOT / "posts" / "*.html"))):
        p = posixpath.relpath(f, str(ROOT))
        files.append(p)

    changed = 0
    for rel in files:
        fp = ROOT / rel
        if not fp.exists():
            print("skip   %s (없음)" % rel)
            continue
        src = fp.read_text(encoding="utf-8")
        out = apply(src, path_for(rel))
        if out != src:
            fp.write_text(out, encoding="utf-8")
            changed += 1
            print("changed   %s" % rel)
        else:
            print("unchanged %s" % rel)
    print("— %d개 변경 / %d개 검사" % (changed, len(files)))


if __name__ == "__main__":
    main()