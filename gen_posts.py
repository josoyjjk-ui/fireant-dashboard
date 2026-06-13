#!/usr/bin/env python3
"""ANTINFO 인사이트/시황 정적 페이지 생성기.

posts/_src/*.md (frontmatter + 간단 마크다운) → 글당 정적 HTML(posts/<slug>.html)
+ 목록 페이지(posts/index.html) 생성. 검색 색인용 SEO 메타·OG·Article JSON-LD 포함.

사용: python3 gen_posts.py
소스 형식(posts/_src/2026-06-13-kimchi-premium.md):
---
title: 제목
date: 2026-06-13
type: 용어해설            # 용어해설 | 시황 | 인사이트
summary: 한 줄 요약(목록·검색 설명)
tags: 김치프리미엄, 김프
---
## 소제목
본문 문단...
- 리스트
[링크](https://...)
"""
from __future__ import annotations
import html
import re
from pathlib import Path

ROOT = Path("/Users/fireant/fireant-dashboard")
SRC = ROOT / "posts" / "_src"
OUT = ROOT / "posts"
BASE = "https://antinfo.io"

CSS = """*{margin:0;padding:0;box-sizing:border-box;font-family:'Pretendard Variable','Pretendard','Apple SD Gothic Neo',sans-serif;}
:root{--bg:#0a0c10;--card:#13161c;--line:#232936;--txt:#e7edf3;--dim:#8a94a3;--up:#ff5d6c;--down:#4d9bff;--accent:#ff3b30;--accent2:#ffb547;}
html{background:var(--bg);scrollbar-gutter:stable;}body{background:var(--bg);color:var(--txt);}html,body{overflow-x:hidden;}
a{color:inherit;}img{max-width:100%;}
.nav{display:flex;align-items:center;justify-content:space-between;padding:15px max(24px,calc((100% - 1240px)/2 + 24px));border-bottom:1px solid var(--line);background:#0c0e13;position:sticky;top:0;z-index:10;}
.logo{font-size:21px;font-weight:900;color:var(--accent);text-decoration:none;}.logo span{color:#fff;}
.brand2{display:flex;align-items:center;gap:12px;min-width:0;}
.btext{display:flex;flex-direction:column;gap:1px;min-width:0;}
.bname{color:#fff;font-size:17px;font-weight:900;line-height:1.15;letter-spacing:-0.3px;}
.lede2{font-size:13px;color:var(--dim);font-weight:700;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.tabs{display:flex;gap:5px;flex-wrap:wrap;}.tab{padding:8px 15px;border-radius:9px;font-size:14px;font-weight:700;color:var(--dim);text-decoration:none;}.tab.on{background:var(--accent);color:#0a0c10;}
.btn{padding:8px 14px;border-radius:9px;font-size:13px;font-weight:700;background:var(--accent);color:#0a0c10;text-decoration:none;}
.ham{display:none;font-size:25px;background:none;border:none;color:var(--txt);font-weight:800;line-height:1;cursor:pointer;padding:0 4px 0 0;}
.drawer{position:fixed;top:0;left:0;bottom:0;width:250px;max-width:82vw;background:#12161d;border-right:1px solid var(--line);transform:translateX(-100%);transition:transform .25s ease;z-index:60;padding:18px 14px;display:flex;flex-direction:column;gap:3px;overflow-y:auto;}
.drawer .dh{display:flex;align-items:center;justify-content:space-between;padding:6px 8px 14px;}
.drawer .dh .dlogo{font-size:20px;font-weight:900;color:#ff3b30;}
.drawer .x{font-size:20px;color:var(--dim);background:none;border:none;cursor:pointer;}
.drawer a{display:flex;align-items:center;gap:14px;padding:15px 12px;border-radius:14px;text-decoration:none;color:var(--txt);font-size:17px;font-weight:800;}
.drawer a .ic{font-size:22px;width:26px;text-align:center;}
.drawer a.on{background:rgba(255,59,48,.14);color:#ff3b30;}
.drawer .ddiv{height:1px;background:var(--line);margin:9px 6px;}
.drawer a.sub{font-size:15px;font-weight:700;color:var(--dim);}
.backdrop{position:fixed;inset:0;background:rgba(0,0,0,.55);opacity:0;pointer-events:none;transition:opacity .25s;z-index:55;}
body.navopen .drawer{transform:none;}
body.navopen .backdrop{opacity:1;pointer-events:auto;}
.main{padding:26px 24px;max-width:760px;margin:0 auto;}
.idxmain{padding:26px 24px;max-width:1000px;margin:0 auto;}
.crumb{font-size:13px;color:var(--dim);font-weight:700;margin-bottom:14px;}.crumb a{color:var(--dim);text-decoration:none;}
.ptype{display:inline-block;font-size:11px;font-weight:900;color:var(--accent2);background:#2a1c0a;padding:4px 11px;border-radius:20px;margin-bottom:12px;}
h1.title{font-size:28px;font-weight:900;line-height:1.3;letter-spacing:-0.4px;margin-bottom:10px;}
.meta{font-size:13px;color:var(--dim);font-weight:700;margin-bottom:6px;}
.summary{font-size:15px;color:#cdd6e0;line-height:1.6;margin:14px 0 22px;padding:14px 16px;background:#0f1216;border-left:3px solid var(--accent);border-radius:10px;}
.body{font-size:15.5px;line-height:1.85;color:#dfe6ee;}
.body h2{font-size:20px;font-weight:900;color:#fff;margin:28px 0 10px;}
.body h3{font-size:17px;font-weight:800;color:#fff;margin:22px 0 8px;}
.body p{margin:12px 0;}
.body ul{margin:12px 0 12px 4px;list-style:none;}
.body li{position:relative;padding-left:18px;margin:7px 0;}
.body li::before{content:"·";position:absolute;left:4px;color:var(--accent);font-weight:900;}
.body a{color:var(--accent2);font-weight:700;text-decoration:none;border-bottom:1px solid rgba(255,181,71,.35);}
.body strong{color:#fff;font-weight:800;}
.tags{margin:24px 0 6px;display:flex;flex-wrap:wrap;gap:7px;}
.tagc{font-size:12px;font-weight:700;color:var(--dim);background:#13161c;border:1px solid var(--line);border-radius:20px;padding:5px 11px;}
.cta{margin:26px 0 8px;display:flex;flex-wrap:wrap;gap:10px;}
.cta a{flex:1;min-width:200px;text-align:center;padding:13px 16px;border-radius:11px;font-weight:900;font-size:14px;text-decoration:none;}
.cta .tg{background:linear-gradient(135deg,var(--accent),#ff5d6c);color:#fff;}
.cta .home{background:var(--card);border:1px solid var(--line);color:var(--txt);}
.disc{font-size:12px;color:var(--dim);line-height:1.6;margin-top:24px;padding-top:16px;border-top:1px solid var(--line);}
.foot{padding:24px;color:var(--dim);font-size:11px;border-top:1px solid var(--line);text-align:center;margin-top:42px;line-height:1.8;}
.foot a{color:var(--accent2);text-decoration:none;}
.idxhead{font-size:30px;font-weight:900;letter-spacing:-0.5px;margin-bottom:6px;}
.idxsub{font-size:14px;color:var(--dim);font-weight:700;margin-bottom:24px;line-height:1.6;}
.plist{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;}
.pcard{display:block;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px;text-decoration:none;transition:border-color .15s,transform .15s;}
.pcard:hover{border-color:var(--accent);transform:translateY(-2px);}
.pcard .pt{font-size:11px;font-weight:900;color:var(--accent2);}
.pcard .ph{font-size:18px;font-weight:900;color:#fff;margin:7px 0;line-height:1.35;}
.pcard .ps{font-size:13.5px;color:var(--dim);line-height:1.55;}
.pcard .pd{font-size:12px;color:var(--dim);font-weight:700;margin-top:10px;}
.empty{color:var(--dim);font-size:15px;padding:40px 0;text-align:center;}
@media(max-width:1100px){.lede2{display:none;}}
@media(max-width:760px){.plist{grid-template-columns:1fr;}h1.title{font-size:23px;}.idxhead{font-size:24px;}.main,.idxmain{padding:18px 15px;}
.nav{flex-wrap:wrap;gap:8px;padding:13px 15px;}.tabs{order:3;width:100%;overflow-x:auto;flex-wrap:nowrap;}.tabs::-webkit-scrollbar{display:none;}.tab{flex:0 0 auto;}
#authSlot a,#authSlot button{font-size:12px;padding:7px 10px;white-space:nowrap;}}"""

_GLOGIN = ('<span id="authSlot" data-mobile="0" style="display:inline-flex;align-items:center;gap:8px;margin-right:8px;">'
           '<button id="loginBtn" style="display:inline-flex;align-items:center;gap:7px;padding:8px 14px;border-radius:9px;border:1px solid #232936;background:#fff;color:#1f2937;font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap;">'
           '<svg width="15" height="15" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35 24 35c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 5 29.5 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21c10.5 0 20-7.6 20-21 0-1.2-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 5 29.5 3 24 3 16 3 9.1 7.6 6.3 14.7z"/><path fill="#4CAF50" d="M24 45c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 36 26.7 37 24 37c-5.3 0-9.7-2.6-11.3-7l-6.5 5C9 40.3 16 45 24 45z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.3 5.3C41.8 36.2 44 30.6 44 24c0-1.2-.1-2.3-.4-3.5z"/></svg>Google 로그인</button></span>'
           '<script>(function(){try{var h=localStorage.getItem("antinfo_navauth");if(h){var s=document.getElementById("authSlot");if(s)s.innerHTML=h;}}catch(e){}})();</script>')

NAV = ('<div class="nav">'
       '<button class="ham" type="button" aria-label="메뉴">☰</button>'
       '<a class="brand2" href="/" style="text-decoration:none;color:inherit;cursor:pointer">'
       '<span class="logo" style="display:inline-flex;align-items:center"><img src="/assets/antinfo-logo.png" alt="ANTINFO" style="height:34px;display:block"></span>'
       '<div class="btext"><span class="bname">개미투자정보</span><span class="lede2">개미투자자들이 필요한 모든 정보</span></div></a>'
       '<div class="tabs">'
       '<a class="tab" href="/">대시보드</a>'
       '<a class="tab" href="/market">마켓</a>'
       '<a class="tab" href="/macro-news">매크로뉴스</a>'
       '<a class="tab" href="/charts">주요자산차트</a>'
       '<a class="tab" href="/events">이벤트모음</a>'
       '<a class="tab" href="/signals">시장지표</a>'
       '<a class="tab on" href="/posts/">인사이트</a>'
       '</div>'
       + _GLOGIN +
       '<a class="btn" href="https://t.me/fireant_crypto" target="_blank" rel="noopener">텔레그램</a></div>')

DRAWER = ('<aside class="drawer">'
          '<div class="dh"><span class="dlogo"><img src="/assets/antinfo-logo.png" alt="" style="height:22px;vertical-align:middle;margin-right:7px;">개미투자정보</span><button class="x" type="button">✕</button></div>'
          '<a href="/"><span class="ic">🏠</span>홈</a>'
          '<a href="/macro-news"><span class="ic">📰</span>뉴스</a>'
          '<a href="/market"><span class="ic">📊</span>마켓</a>'
          '<a href="/signals"><span class="ic">🐋</span>시장지표</a>'
          '<a href="/charts"><span class="ic">🕯️</span>주요자산차트</a>'
          '<a class="on" href="/posts/"><span class="ic">📝</span>인사이트</a>'
          '<div class="ddiv"></div>'
          '<a class="sub" href="/events"><span class="ic">🎉</span>이벤트·당첨</a>'
          '<a class="sub" href="https://t.me/fireant_crypto" target="_blank" rel="noopener"><span class="ic">✈️</span>텔레그램 채널</a>'
          '</aside><div class="backdrop"></div>')

SCRIPTS = ('<script src="/assets/vendor/supabase.js"></script>'
           '<script src="/assets/auth.js?v=3"></script>'
           '<script>document.addEventListener("click",function(e){var b=document.body;if(e.target.closest(".ham"))b.classList.add("navopen");else if(e.target.closest(".drawer .x")||e.target.classList.contains("backdrop"))b.classList.remove("navopen");});</script>')

FOOT = ('<div class="foot">🐜 ANTINFO · 개미들이 필요한 모든 투자정보<br>'
        '운영자 Social Media · <a href="https://x.com/fireant_korea" target="_blank" rel="noopener">X</a> · '
        '<a href="https://t.me/fireant_crypto" target="_blank" rel="noopener">Telegram</a> · '
        '<a href="https://www.youtube.com/@FIREANTCRYPTO" target="_blank" rel="noopener">YouTube</a><br>'
        '본 콘텐츠는 정보 제공 목적이며 투자 권유가 아닙니다. 투자 판단과 책임은 본인에게 있습니다.</div>')

DISC = ('<div class="disc">※ 본 글은 정보 제공·교육 목적으로 작성되었으며 투자 권유가 아닙니다. '
        '데이터는 각 거래소·공개 API 기준이며 지연·오차가 있을 수 있습니다. 최종 투자 판단과 책임은 투자자 본인에게 있습니다.</div>')


def parse_front(text: str):
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", text, re.S)
    if not m:
        raise ValueError("frontmatter 없음")
    meta = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()
    return meta, m.group(2).strip()


def md_inline(s: str) -> str:
    s = html.escape(s)
    s = re.sub(r"\[([^\]]+)\]\((https?://[^\s)]+)\)",
               r'<a href="\2" target="_blank" rel="noopener">\1</a>', s)
    s = re.sub(r"\[([^\]]+)\]\((/[^\s)]*)\)", r'<a href="\2">\1</a>', s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
    return s


def md_body(text: str) -> str:
    out, lines, i = [], text.splitlines(), 0
    while i < len(lines):
        ln = lines[i].rstrip()
        if not ln.strip():
            i += 1; continue
        if ln.startswith("### "):
            out.append(f"<h3>{md_inline(ln[4:])}</h3>")
        elif ln.startswith("## "):
            out.append(f"<h2>{md_inline(ln[3:])}</h2>")
        elif ln.startswith("- "):
            items = []
            while i < len(lines) and lines[i].rstrip().startswith("- "):
                items.append(f"<li>{md_inline(lines[i].rstrip()[2:])}</li>")
                i += 1
            out.append("<ul>" + "".join(items) + "</ul>")
            continue
        else:
            out.append(f"<p>{md_inline(ln)}</p>")
        i += 1
    return "\n".join(out)


def page(meta, slug, body_html):
    title = meta["title"]; summary = meta.get("summary", "")
    url = f"{BASE}/posts/{slug}"
    tags = [t.strip() for t in meta.get("tags", "").split(",") if t.strip()]
    tags_html = "".join(f'<span class="tagc">#{html.escape(t)}</span>' for t in tags)
    jsonld = ('{"@context":"https://schema.org","@type":"Article",'
              f'"headline":{html_json(title)},"datePublished":"{meta["date"]}",'
              f'"dateModified":"{meta["date"]}","description":{html_json(summary)},'
              '"author":{"@type":"Person","name":"불개미 (ANTINFO)"},'
              '"publisher":{"@type":"Organization","name":"ANTINFO",'
              '"logo":{"@type":"ImageObject","url":"https://antinfo.io/assets/antinfo-logo.png"}},'
              f'"mainEntityOfPage":{html_json(url)}}}')
    return f"""<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)} | ANTINFO 인사이트</title>
<meta name="description" content="{html.escape(summary)}">
<link rel="canonical" href="{url}">
<link rel="icon" type="image/png" href="/assets/favicon-32.png">
<meta property="og:type" content="article"><meta property="og:title" content="{html.escape(title)}">
<meta property="og:description" content="{html.escape(summary)}"><meta property="og:url" content="{url}">
<meta property="og:image" content="https://antinfo.io/assets/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css">
<script type="application/ld+json">{jsonld}</script>
<style>{CSS}</style></head><body>
{DRAWER}
{NAV}
<article class="main">
<div class="crumb"><a href="/">홈</a> › <a href="/posts/">인사이트</a> › {html.escape(meta.get("type","글"))}</div>
<span class="ptype">{html.escape(meta.get("type","인사이트"))}</span>
<h1 class="title">{html.escape(title)}</h1>
<div class="meta">{meta["date"]} · ANTINFO</div>
<div class="summary">{html.escape(summary)}</div>
<div class="body">
{body_html}
</div>
<div class="tags">{tags_html}</div>
<div class="cta">
<a class="tg" href="https://t.me/fireant_crypto" target="_blank" rel="noopener">📡 불개미 실시간 의견 텔레그램으로 받기 →</a>
<a class="home" href="/">📊 실시간 대시보드 보기</a>
</div>
{DISC}
</article>
{FOOT}
{SCRIPTS}
</body></html>"""


def html_json(s: str) -> str:
    import json
    return json.dumps(s, ensure_ascii=False)


def index_page(posts):
    if posts:
        cards = "".join(
            f'<a class="pcard" href="/posts/{p["slug"]}">'
            f'<span class="pt">{html.escape(p.get("type","인사이트"))}</span>'
            f'<div class="ph">{html.escape(p["title"])}</div>'
            f'<div class="ps">{html.escape(p.get("summary",""))}</div>'
            f'<div class="pd">{p["date"]}</div></a>'
            for p in posts)
        body = f'<div class="plist">{cards}</div>'
    else:
        body = '<div class="empty">곧 첫 글이 올라옵니다.</div>'
    url = f"{BASE}/posts/"
    return f"""<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ANTINFO 인사이트 — 시황·용어해설·크립토 분석</title>
<meta name="description" content="불개미의 시황 코멘트와 김치프리미엄·코인베이스 프리미엄·공포탐욕지수 등 한국 투자자를 위한 크립토 용어해설·인사이트 아카이브.">
<link rel="canonical" href="{url}">
<link rel="icon" type="image/png" href="/assets/favicon-32.png">
<meta property="og:type" content="website"><meta property="og:title" content="ANTINFO 인사이트">
<meta property="og:description" content="불개미의 시황과 크립토 용어해설·인사이트 모음.">
<meta property="og:url" content="{url}"><meta property="og:image" content="https://antinfo.io/assets/og-image.png">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css">
<style>{CSS}</style></head><body>
{DRAWER}
{NAV}
<div class="idxmain">
<div class="crumb"><a href="/">홈</a> › 인사이트</div>
<h1 class="idxhead">🐜 ANTINFO 인사이트</h1>
<div class="idxsub">불개미의 시황 코멘트와 한국 투자자를 위한 크립토 용어해설·분석. 김치프리미엄, 코인베이스 프리미엄, 공포탐욕지수까지 — 데이터를 읽는 법을 정리합니다.</div>
{body}
</div>
{FOOT}
{SCRIPTS}
</body></html>"""


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    posts = []
    for f in sorted(SRC.glob("*.md")):
        meta, body = parse_front(f.read_text(encoding="utf-8"))
        slug = meta.get("slug") or re.sub(r"^\d{4}-\d{2}-\d{2}-", "", f.stem)
        meta["slug"] = slug
        (OUT / f"{slug}.html").write_text(page(meta, slug, md_body(body)), encoding="utf-8")
        posts.append(meta)
    posts.sort(key=lambda p: p["date"], reverse=True)
    (OUT / "index.html").write_text(index_page(posts), encoding="utf-8")
    print(f"생성 완료: {len(posts)}개 글 + index.html")
    for p in posts:
        print(f"  /posts/{p['slug']}  ({p['date']}) {p['title']}")


if __name__ == "__main__":
    main()
