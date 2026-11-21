#!/usr/bin/env python3
"""공용 내비게이션 동기화 — assets/nav.js 의 NAV/ICONS 를 모든 페이지에 정적 HTML로 써 넣습니다.

사용: python3 scripts/sync_nav.py
내비 항목을 고칠 때는 assets/nav.js 의 NAV 배열만 수정하고 이 스크립트를 실행합니다.
JS(assets/nav.js)와 완전히 동일한 마크업을 생성해야 하므로 렌더 함수를 그대로 미러링합니다.
"""
from __future__ import annotations

import glob
import hashlib
import json
import posixpath
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NAV_JS = ROOT / "assets" / "nav.js"

# 렌더 로직을 바꾸면 올린다 (NAV_VER 해시에 포함되어 캐시가 자동으로 깨진다)
RENDER_REV = "v2"

TAB_START, TAB_END = "<!--nav:tabs-->", "<!--/nav:tabs-->"
DRAW_START, DRAW_END = "<!--nav:drawer-->", "<!--/nav:drawer-->"
BOT_START, BOT_END = "<!--nav:bottom-->", "<!--/nav:bottom-->"

SVG_OPEN = ('<svg width="22" height="22" viewBox="0 0 24 24" fill="none" '
            'stroke="currentColor" stroke-width="2" stroke-linecap="round" '
            'stroke-linejoin="round" aria-hidden="true">')
SVG_CLOSE = '</svg>'

H_MAIN = "메인"
H_IND = "지표·캘린더"
H_COM = "커뮤니티·콘텐츠"

PAGES = [
    "index.html", "m.html", "market.html", "macro-news.html", "signal.html",
    "charts.html", "kr-exchange/index.html", "buyback.html", "airdrop.html",
    "winners/index.html", "donate.html", "events.html", "fng.html",
    "calendar.html", "unlocks.html",
]
# admin/index.html 은 의도적으로 제외한다.
# 관리자 화면은 .tab/.tabs 클래스를 자기 콘텐츠 탭 UI 로 쓰기 때문에
# strip_nav_css() 의 내비 CSS 제거 대상이 되면 화면이 깨진다.

# CoinGecko 코인 이미지를 JS 로 렌더하는 페이지 (라우트 기준)
COINGECKO_ROUTES = {"/", "/m", "/market", "/kr-exchange"}


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
    return nav, icons, tg, m.group(1), mg.group(1)


NAV, ICONS, TG, _NAV_RAW, _ICONS_RAW = _load_source()

# NAV/ICONS 원문 + TG + 렌더 리비전의 sha1 앞 8자 → assets/nav.js 의 NAV_VER
NAV_VER = hashlib.sha1(
    (_NAV_RAW + _ICONS_RAW + TG["label"] + TG["href"] + RENDER_REV).encode("utf-8")
).hexdigest()[:8]

ERRORS: list[str] = []


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


def ov_attr(it) -> str:
    return (' data-ov="%s"' % esc(it["ov"])) if it.get("ov") else ""


def tab_link(it, on):
    if on:
        return ('<a class="tab on" href="%s" aria-current="page"%s>%s</a>'
                % (esc(it["href"]), ov_attr(it), esc(it["label"])))
    return '<a class="tab" href="%s"%s>%s</a>' % (esc(it["href"]), ov_attr(it), esc(it["label"]))


def plain_link(it, on):
    if on:
        return '<a class="on" href="%s" aria-current="page">%s</a>' % (esc(it["href"]), esc(it["label"]))
    return '<a href="%s">%s</a>' % (esc(it["href"]), esc(it["label"]))


def panel_main_link(it, on):
    if on:
        return ('<a class="on" href="%s" aria-current="page"%s>%s</a>'
                % (esc(it["href"]), ov_attr(it), esc(it["label"])))
    return '<a href="%s"%s>%s</a>' % (esc(it["href"]), ov_attr(it), esc(it["label"]))


def bottom_link(it, on):
    icon = ICONS.get(it["href"], "")
    inner = '<span class="ic">%s%s%s</span>%s' % (
        SVG_OPEN, icon, SVG_CLOSE, esc(it.get("short") or it["label"]))
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
    cls = " on" if more_on else ""
    btn_label = NAV[act]["label"] if more_on else "더보기"
    out.append('<div class="tab-more%s">' % cls)
    out.append('<button class="tab tab-more-btn%s" type="button" aria-expanded="false" '
               'aria-controls="nav-more"><span class="tm-l">%s</span></button>'
               % (cls, esc(btn_label)))
    out.append('<div class="more-panel" id="nav-more">')
    out.append('<div class="mp-g mp-main"><div class="mp-h">%s</div>' % esc(H_MAIN))
    for i, it in enumerate(NAV):
        if it.get("group") != "main":
            continue
        out.append(panel_main_link(it, i == act))
    out.append("</div>")
    out.append('<div class="mp-g"><div class="mp-h">%s</div>' % esc(H_IND))
    for i, it in enumerate(NAV):
        if it.get("group") != "more" or it.get("sub") != "ind":
            continue
        out.append(plain_link(it, i == act))
    out.append("</div>")
    out.append('<div class="mp-g"><div class="mp-h">%s</div>' % esc(H_COM))
    for i, it in enumerate(NAV):
        if it.get("group") != "more" or it.get("sub") != "com":
            continue
        out.append(plain_link(it, i == act))
    out.append("</div></div></div>")
    out.append(TAB_END)
    return "".join(out)


def drawer_html(P):
    act = active_index(P)
    out = [DRAW_START]
    out.append('<div class="dg-h">%s</div>' % esc(H_MAIN))
    for i, it in enumerate(NAV):
        if it.get("group") != "main":
            continue
        out.append(plain_link(it, i == act))
    out.append('<div class="dg-h">%s</div>' % esc(H_IND))
    for i, it in enumerate(NAV):
        if it.get("group") != "more" or it.get("sub") != "ind":
            continue
        out.append(plain_link(it, i == act))
    out.append('<div class="dg-h">%s</div>' % esc(H_COM))
    for i, it in enumerate(NAV):
        if it.get("group") != "more" or it.get("sub") != "com":
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
    out.append('<button class="bn-menu" type="button" aria-controls="drawer" aria-expanded="false">'
               '<span class="ic">%s%s%s</span>메뉴</button>'
               % (SVG_OPEN, ICONS.get("menu", ""), SVG_CLOSE))
    out.append(BOT_END)
    return "".join(out)


# ── 페이지 변환 도우미 ───────────────────────────────────────────
def _replace_marker_block(html, start, end, new):
    i = html.find(start)
    if i < 0:
        return None
    j = html.find(end, i)
    if j < 0:
        return None
    return html[:i] + new + html[j + len(end):]


# ── 8) 중복 내비 CSS 제거 ────────────────────────────────────────
NAV_SEL_RE = re.compile(
    r'(?<![\w-])(?:\.tab-more-btn|\.tab-more|\.more-panel|\.navopen|\.backdrop'
    r'|\.brand2|\.btext|\.bname|\.lede2|\.dlogo|\.drawer|\.ddiv|\.tabs'
    r'|\.ham|\.tab|\.nav|\.dh)(?![\w-])'
)
AUTH_SEL_RE = re.compile(r'(?<![\w-])#authSlot(?![\w-])')

_STATS = {"css_removed": 0}


def _split_top_commas(s: str):
    parts, start, depth, quote, i = [], 0, 0, None, 0
    while i < len(s):
        c = s[i]
        if quote:
            if c == "\\":
                i += 2
                continue
            if c == quote:
                quote = None
        elif c in "\"'":
            quote = c
        elif c in "([":
            depth += 1
        elif c in ")]":
            depth -= 1
        elif c == "," and depth == 0:
            parts.append(s[start:i])
            start = i + 1
        i += 1
    parts.append(s[start:])
    return parts


def _is_nav_sel(sel: str, drop_auth: bool) -> bool:
    code = re.sub(r"/\*.*?\*/", "", sel, flags=re.S)
    if NAV_SEL_RE.search(code):
        return True
    if drop_auth and AUTH_SEL_RE.search(code):
        return True
    return False


def _find_match_brace(css: str, i: int) -> int:
    """i 는 '{' 위치. 짝이 맞는 '}' 위치를 반환(없으면 -1). 주석/문자열 무시."""
    depth, j, n = 0, i, len(css)
    while j < n:
        if css.startswith("/*", j):
            k = css.find("*/", j + 2)
            if k < 0:
                return -1
            j = k + 2
            continue
        c = css[j]
        if c in "\"'":
            q, j = c, j + 1
            while j < n:
                if css[j] == "\\":
                    j += 2
                    continue
                if css[j] == q:
                    break
                j += 1
            j += 1
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return j
        j += 1
    return -1


def _process_css(css: str, drop_auth: bool) -> str:
    out, i, n = [], 0, len(css)
    while i < n:
        j = i
        while j < n and css[j].isspace():
            j += 1
        ws, i = css[i:j], j
        if i >= n:
            out.append(ws)
            break
        if css.startswith("/*", i):
            k = css.find("*/", i + 2)
            out.append(ws)
            if k < 0:
                out.append(css[i:])
                break
            out.append(css[i:k + 2])
            i = k + 2
            continue
        if css[i] == "}":
            out.append(ws + "}")
            i += 1
            continue
        # prelude → '{'
        k = i
        while k < n and css[k] not in "{}":
            if css.startswith("/*", k):
                e = css.find("*/", k + 2)
                k = n if e < 0 else e + 2
                continue
            if css[k] in "\"'":
                q, k = css[k], k + 1
                while k < n:
                    if css[k] == "\\":
                        k += 2
                        continue
                    if css[k] == q:
                        break
                    k += 1
                k += 1
                continue
            k += 1
        if k >= n:
            out.append(ws + css[i:])
            break
        if css[k] == "}":
            out.append(ws + css[i:k + 1])
            i = k + 1
            continue
        prelude = css[i:k]
        close = _find_match_brace(css, k)
        if close < 0:
            out.append(ws + css[i:])
            break
        body = css[k + 1:close]
        stripped = prelude.strip()
        if stripped.startswith("@"):
            low = stripped.lstrip("@").lower()
            if low.startswith("media") or low.startswith("supports"):
                new_body = _process_css(body, drop_auth)
                plain_body = re.sub(r"/\*.*?\*/", "", new_body, flags=re.S)
                if re.fullmatch(r"\s*", plain_body):
                    _STATS["css_removed"] += 1   # 빈 @media/@supports 블록 제거
                else:
                    out.append("%s%s{%s}" % (ws, prelude, new_body))
            else:
                out.append("%s%s{%s}" % (ws, prelude, body))
        else:
            kept, removed_any = [], False
            for sel in _split_top_commas(prelude):
                if _is_nav_sel(sel, drop_auth):
                    removed_any = True
                else:
                    kept.append(sel)
            if not kept:
                _STATS["css_removed"] += 1
                # 규칙째 사라지므로 앞쪽 공백/줄바꿈도 함께 없애 빈 줄이 남지 않게 한다
            else:
                joined = ",".join(kept)
                if prelude and not prelude[0].isspace():
                    joined = joined.lstrip()
                out.append("%s%s{%s}" % (ws, joined, body))
        i = close + 1
    return "".join(out)


def strip_nav_css(html: str, path: str) -> str:
    """페이지의 인라인 <style> 블록에서 내비 관련 셀렉터만 걷어냅니다."""
    drop_auth = norm(path) not in ("/m", "/m.html")
    svg_spans = [(m.start(), m.end()) for m in re.finditer(r"<svg\b.*?</svg>", html, re.S | re.I)]

    def inside_svg(pos: int) -> bool:
        for a, b in svg_spans:
            if a <= pos < b:
                return True
        return False

    def repl(m):
        if inside_svg(m.start()):
            return m.group(0)
        return m.group(1) + _process_css(m.group(2), drop_auth) + m.group(3)

    return re.sub(r"(<style\b[^>]*>)(.*?)(</style>)", repl, html, flags=re.S | re.I)


# ── 3) 로컬 assets 캐시버스팅 ────────────────────────────────────
_MD5_CACHE: dict[str, str] = {}


def _md5_8(p: Path) -> str:
    key = str(p)
    if key not in _MD5_CACHE:
        _MD5_CACHE[key] = hashlib.md5(p.read_bytes()).hexdigest()[:8]
    return _MD5_CACHE[key]


def _page_dir(path: str) -> str:
    p = path.split("?")[0].split("#")[0]
    d = p if p.endswith("/") else (posixpath.dirname(p) or "/")
    return d.lstrip("/")


def _normalise_asset_url(value: str, page_dir: str, label: str):
    path_only = value.split("?")[0].split("#")[0]
    if not path_only:
        return None
    if re.match(r"^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|//)", path_only):
        return None
    if path_only.startswith("/"):
        rel = path_only.lstrip("/")
    else:
        rel = posixpath.normpath(posixpath.join(page_dir, path_only))
    if rel.startswith("..") or not rel.startswith("assets/"):
        return None
    target = ROOT / rel
    if not target.is_file():
        print("WARN  %s: %s 파일을 찾지 못해 참조를 그대로 둡니다" % (label, path_only))
        return None
    return "/" + rel + "?v=" + _md5_8(target)


def cache_bust_assets(html: str, path: str) -> str:
    pdir = _page_dir(path)

    def fix_script(m):
        tag = m.group(0)
        sm = re.search(r'\bsrc="([^"]*)"', tag)
        if not sm:
            return tag
        new = _normalise_asset_url(sm.group(1), pdir, path)
        if new is None:
            return tag
        return tag[:sm.start(1)] + new + tag[sm.end(1):]

    def fix_link(m):
        tag = m.group(0)
        hm = re.search(r'\bhref="([^"]*)"', tag)
        if not hm:
            return tag
        new = _normalise_asset_url(hm.group(1), pdir, path)
        if new is None:
            return tag
        return tag[:hm.start(1)] + new + tag[hm.end(1):]

    html = re.sub(r'<script\b[^>]*\bsrc="[^"]*"[^>]*>', fix_script, html, flags=re.I)
    html = re.sub(r'<link\b[^>]*\brel="stylesheet"[^>]*>', fix_link, html, flags=re.I)
    return html


# ── 4) supabase defer ────────────────────────────────────────────
SUPABASE_RE = re.compile(r'<script\b[^>]*\bsrc="[^"]*vendor/supabase\.js[^"]*"[^>]*>', re.I)


def fix_supabase_defer(html: str, path: str) -> str:
    is_winners = norm(path) == "/winners"

    def repl(m):
        tag = m.group(0)
        if is_winners:
            return re.sub(r'\s+defer(?=[\s>])', "", tag, count=1)
        if re.search(r'(?<![\w-])defer(?![\w-])', tag):
            return tag
        idx = tag.rfind(">")
        if idx < 0:
            return tag
        return tag[:idx] + " defer" + tag[idx:]

    return SUPABASE_RE.sub(repl, html)


# ── 5) preconnect ────────────────────────────────────────────────
def _host_is_linked(html: str, host: str) -> bool:
    pat = re.compile(
        r'<script\b[^>]*\bsrc="[^"]*' + re.escape(host) + r'[^"]*"[^>]*>'
        r'|<link\b[^>]*\bhref="[^"]*' + re.escape(host) + r'[^"]*"[^>]*>', re.I)
    return bool(pat.search(html))


def ensure_preconnect(html: str, host: str, crossorigin: bool) -> str:
    head_i = html.lower().find("<head")
    head_e = html.lower().find("</head>", head_i)
    if head_i < 0 or head_e < 0:
        return html
    head = html[head_i:head_e + 7]

    pre = re.compile(r'<link\b[^>]*\brel="preconnect"[^>]*\bhref="' + re.escape(host) + r'"[^>]*>', re.I)
    head = pre.sub("", head)

    tag = '<link rel="preconnect" href="%s"%s>' % (host, " crossorigin" if crossorigin else "")
    using = re.compile(
        r'<script\b[^>]*\bsrc="[^"]*' + re.escape(host) + r'[^"]*"[^>]*>'
        r'|<link\b[^>]*\bhref="[^"]*' + re.escape(host) + r'[^"]*"[^>]*>', re.I)
    m = using.search(head)
    off = m.start() if m else head.lower().rfind("</head>")
    head = head[:off] + tag + head[off:]
    return html[:head_i] + head + html[head_e + 7:]


# ── 6) 정규 마크업 ───────────────────────────────────────────────
HAM_RE = re.compile(r'<button class="ham"[^>]*>[^<]*</button>', re.I)
DRAWER_OPEN_RE = re.compile(r'<aside class="drawer"[^>]*>', re.I)
BRAND2_RE = re.compile(r'<a class="brand2"[^>]*>.*?</a>', re.I | re.S)
TABS_OPEN_RE = re.compile(r'<div class="tabs"[^>]*>', re.I)
BOTTOM_NAV_RE = re.compile(r'<nav class="nav[^"]*"[^>]*aria-label="하단 메뉴"[^>]*>', re.I)
TG_BTN_RE = re.compile(r'<a class="btn[^"]*" href="https://t\.me/fireant_crypto"[^>]*>.*?</a>', re.I | re.S)
IMG_RE = re.compile(r'<img\b[^>]*>', re.I)

DH_HTML = ('<div class="dh"><span class="dlogo"><img src="/assets/antinfo-logo-64.png" '
           'width="24" height="24" alt="">개미투자정보</span>'
           '<button class="x" type="button" aria-label="닫기">✕</button></div>')
BRAND2_HTML = ('<a class="brand2" href="/"><span class="logo"><img src="/assets/antinfo-logo-64.png" '
               'srcset="/assets/antinfo-logo-64.png 1x, /assets/antinfo-logo-128.png 2x" '
               'width="28" height="28" alt="개미투자정보 ANTINFO"></span>'
               '<span class="btext"><span class="bname">개미투자정보</span>'
               '<span class="lede2">개미투자자들이 필요한 모든 정보</span></span></a>')
TG_BTN_HTML = ('<a class="btn nav-tg" href="https://t.me/fireant_crypto" target="_blank" '
               'rel="noopener" aria-label="텔레그램"><svg width="18" height="18" viewBox="0 0 24 24" '
               'fill="currentColor" aria-hidden="true"><path d="M21.4 4.3 2.9 11.5c-1.3.5-1.2 1.2-.2 1.5'
               'l4.7 1.5 1.8 5.5c.2.6.4.8.8.8s.6-.2.9-.5l2.3-2.2 4.7 3.5c.9.5 1.5.2 1.7-.8l3.1-14.5'
               'c.3-1.3-.5-1.8-1.3-1.5zM9 14.3l8.6-5.4c.4-.3.8-.1.5.2l-7.3 6.6-.3 3.2z"/></svg>'
               '<span class="tg-l">텔레그램</span></a>')


def _fix_logo_img(tag: str) -> str:
    sm = re.search(r'\bsrc="([^"]*)"', tag)
    if not sm:
        return tag
    if sm.group(1) not in ("/assets/antinfo-logo.png", "assets/antinfo-logo.png"):
        return tag
    new_val = "/assets/antinfo-logo-64.png"
    new = tag[:sm.start(1)] + new_val + tag[sm.end(1):]
    if not re.search(r'\bsrcset="', new, re.I):
        pos = sm.end(0) + (len(new_val) - len(sm.group(1)))
        new = new[:pos] + ' srcset="/assets/antinfo-logo-64.png 1x, /assets/antinfo-logo-128.png 2x"' + new[pos:]
    return new


def normalise_markup(html: str, path: str) -> str:
    html = HAM_RE.sub('<button class="ham" type="button" aria-label="메뉴" '
                      'aria-expanded="false" aria-controls="drawer">☰</button>', html)

    html = DRAWER_OPEN_RE.sub(
        '<aside class="drawer" id="drawer" aria-label="전체 메뉴" data-nav-ver="%s" '
        'inert aria-hidden="true">' % NAV_VER, html, count=1)

    # c) 드로어 헤더: <div class="dh"> ~ (직전) <!--nav:drawer-->
    ai = html.find('<aside class="drawer"')
    di = html.find('<div class="dh">', ai if ai >= 0 else 0)
    dm = html.find(DRAW_START, ai if ai >= 0 else 0)
    if dm >= 0:
        if di >= 0 and di < dm:
            html = html[:di] + DH_HTML + html[dm:]
        elif di < 0:
            # dh 가 없으면 aside 열림 태그 바로 뒤에 넣는다
            aend = html.find(">", ai) + 1 if ai >= 0 else -1
            if aend > 0:
                html = html[:aend] + DH_HTML + html[aend:]

    # d) 탭 컨테이너 (div.nav 안의 첫 .tabs)
    nm = re.search(r'<div class="nav(?![\w-])[^>]*>', html)
    if nm:
        t = TABS_OPEN_RE.search(html, nm.end())
        if t:
            html = html[:t.start()] + '<div class="tabs" data-nav-ver="%s">' % NAV_VER + html[t.end():]

    # e) 브랜드
    html = BRAND2_RE.sub(lambda m: BRAND2_HTML, html, count=1)

    # f) <!--/nav:tabs--> 뒤 첫 텔레그램 버튼
    te = html.find(TAB_END)
    if te >= 0:
        m = TG_BTN_RE.search(html, te + len(TAB_END))
        if m:
            html = html[:m.start()] + TG_BTN_HTML + html[m.end():]

    # g) 로고 이미지
    html = IMG_RE.sub(lambda m: _fix_logo_img(m.group(0)), html)

    # h) 하단 바
    html = BOTTOM_NAV_RE.sub(
        '<nav class="nav bnav" aria-label="하단 메뉴" data-nav-ver="%s">' % NAV_VER, html, count=1)
    return html


# ── 9) 인라인 드로어 토글 스크립트 제거 ──────────────────────────
TOGGLE_STMT = ('document.addEventListener("click",function(e){var b=document.body;'
               'if(e.target.closest(".ham"))b.classList.add("navopen");'
               'else if(e.target.closest(".drawer .x")||e.target.classList.contains("backdrop"))'
               'b.classList.remove("navopen");});')
TOGGLE_ELEMENT = "<script>" + TOGGLE_STMT + "</script>"


def remove_inline_toggle(html: str) -> str:
    # 1) 문장만 담은 단독 <script> 요소(여러 줄 포함) → 줄째 제거
    html = re.sub(r"[ \t]*<script>\s*" + re.escape(TOGGLE_STMT) + r"\s*</script>[ \t]*\n?", "", html)
    html = html.replace(TOGGLE_ELEMENT, "")

    # 2) 더 큰 인라인 <script> 안의 같은 문장 → 문장만 제거
    def repl(m):
        body = m.group(2)
        if TOGGLE_STMT not in body:
            return m.group(0)
        body = body.replace(TOGGLE_STMT, "")
        if not body.strip():
            return ""            # 남은 게 공백뿐인 스크립트 → 요소째 제거
        return m.group(1) + body + m.group(3)

    html = re.sub(r"(<script\b[^>]*>)(.*?)(</script>)", repl, html, flags=re.S | re.I)
    # 3) 비게 된 <script></script> 요소 정리
    return re.sub(r"[ \t]*<script>\s*</script>[ \t]*\n?", "", html)


# ── 10) nav.css / nav.js 보장 ───────────────────────────────────
def ensure_nav_assets(html: str) -> str:
    """nav.css 는 head 의 마지막(모든 인라인 <style> 뒤), nav.js 는 body 의 마지막."""
    css = ROOT / "assets" / "nav.css"
    js = ROOT / "assets" / "nav.js"

    if css.is_file():
        html = re.sub(r'<link\b[^>]*\brel="stylesheet"[^>]*\bhref="[^"]*assets/nav\.css[^"]*"[^>]*>\s*',
                      "", html, flags=re.I)
        tag = '<link rel="stylesheet" href="/assets/nav.css?v=%s">' % _md5_8(css)
        i = html.lower().rfind("</head>")
        if i >= 0:
            html = html[:i] + tag + html[i:]

    if js.is_file():
        html = re.sub(r'<script\b[^>]*\bsrc="[^"]*assets/nav\.js[^"]*"[^>]*>\s*</script>\s*',
                      "", html, flags=re.I)
        tag = '<script src="/assets/nav.js?v=%s"></script>' % _md5_8(js)
        i = html.lower().rfind("</body>")
        if i >= 0:
            html = html[:i] + tag + html[i:]
    return html


# ── 진입점 ──────────────────────────────────────────────────────
def apply(html: str, path: str) -> str:
    P = norm(path)

    # 7) 마커 블록 — 누락 시 해당 파일은 건드리지 않고 에러 기록
    missing = []
    if re.search(r'<div class="nav(?![\w-])', html) and TAB_START not in html:
        missing.append(TAB_START)
    if '<aside class="drawer"' in html and DRAW_START not in html:
        missing.append(DRAW_START)
    if re.search(r'<nav class="nav[^"]*"[^>]*aria-label="하단 메뉴"', html) and BOT_START not in html:
        missing.append(BOT_START)
    if missing:
        print("ERROR %s: missing %s markers — add them by hand" % (path, ", ".join(missing)))
        ERRORS.append(path)
        return html

    for start, end, new in (
        (TAB_START, TAB_END, tabs_html(P)),
        (DRAW_START, DRAW_END, drawer_html(P)),
        (BOT_START, BOT_END, bottom_html(P)),
    ):
        if start in html:
            html = _replace_marker_block(html, start, end, new) or html

    html = normalise_markup(html, path)
    html = remove_inline_toggle(html)
    html = strip_nav_css(html, path)

    # 5) preconnect
    if _host_is_linked(html, "https://cdn.jsdelivr.net"):
        html = ensure_preconnect(html, "https://cdn.jsdelivr.net", True)
    if _host_is_linked(html, "https://unpkg.com"):
        html = ensure_preconnect(html, "https://unpkg.com", True)
    if P in COINGECKO_ROUTES:
        html = ensure_preconnect(html, "https://coin-images.coingecko.com", False)

    # 3) 로컬 assets 캐시버스팅 → 4) supabase defer → 10) nav 자산 보장
    html = cache_bust_assets(html, path)
    html = fix_supabase_defer(html, path)
    html = ensure_nav_assets(html)
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


def _write_nav_version():
    src = NAV_JS.read_text(encoding="utf-8")
    new, n = re.subn(r"var NAV_VER = '[^']*';", "var NAV_VER = '%s';" % NAV_VER, src, count=1)
    if n and new != src:
        NAV_JS.write_text(new, encoding="utf-8")
        print("nav.js   NAV_VER → %s" % NAV_VER)
    return NAV_VER


def main():
    _write_nav_version()

    files = list(PAGES)
    for f in sorted(glob.glob(str(ROOT / "posts" / "*.html"))):
        files.append(posixpath.relpath(f, str(ROOT)))

    changed = 0
    rows = []
    for rel in files:
        fp = ROOT / rel
        if not fp.exists():
            print("skip   %s (없음)" % rel)
            continue
        src = fp.read_text(encoding="utf-8")
        before_len = len(src.encode("utf-8"))
        css_before = _STATS["css_removed"]
        try:
            out = apply(src, path_for(rel))
        except Exception as exc:  # pragma: no cover - 방어적
            print("ERROR %s: %s" % (rel, exc))
            ERRORS.append(rel)
            continue
        css_removed = _STATS["css_removed"] - css_before
        if out != src:
            fp.write_text(out, encoding="utf-8")
            changed += 1
            status = "changed  "
        else:
            status = "unchanged"
        after_len = len(out.encode("utf-8"))
        rows.append((rel, before_len, after_len, css_removed, status))

    print()
    print("%-32s %10s %10s %8s" % ("page", "before", "after", "css-rules"))
    for rel, b, a, c, _st in rows:
        print("%-32s %10d %10d %8d" % (rel, b, a, c))
    print()
    print("— %d개 변경 / %d개 검사" % (changed, len(files)))
    if ERRORS:
        print("— 오류 %d건: %s" % (len(ERRORS), ", ".join(ERRORS)))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())