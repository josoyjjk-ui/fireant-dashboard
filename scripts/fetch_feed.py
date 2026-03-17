#!/usr/bin/env python3
"""
fetch_feed.py — RSS 피드 파서 for 불개미 CRYPTO 대시보드
유튜브, 네이버 블로그, 텔레그램 최신 5개 항목 → feed.json 생성
"""
import json
import re
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from xml.etree import ElementTree as ET

KST = timezone(timedelta(hours=9))

FEEDS = {
    "youtube": "https://www.youtube.com/feeds/videos.xml?channel_id=UCIf165OxaJWen5QbbETQcEw",
    "naver":   "https://rss.blog.naver.com/fireant_korea",
    "telegram": [
        "https://rsshub.app/telegram/channel/fireantcrypto",
        "https://rss.app/feeds/_PLACEHOLDER_NOOP",  # fallback placeholder (skip)
    ],
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; FireantFeedBot/1.0)"
}

NS = {
    "atom":  "http://www.w3.org/2005/Atom",
    "media": "http://search.yahoo.com/mrss/",
    "yt":    "http://www.youtube.com/xml/schemas/2015",
}


def fetch_xml(url: str) -> ET.Element | None:
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read()
        return ET.fromstring(data)
    except Exception as e:
        print(f"  ⚠️  fetch error [{url}]: {e}", file=sys.stderr)
        return None


def parse_date(s: str) -> str:
    """다양한 날짜 포맷 → ISO8601(KST)"""
    if not s:
        return ""
    # RFC2822 e.g. "Mon, 10 Mar 2026 12:00:00 +0900"
    import email.utils
    try:
        ts = email.utils.parsedate_to_datetime(s)
        return ts.astimezone(KST).isoformat()
    except Exception:
        pass
    # ISO8601
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S"):
        try:
            dt = datetime.strptime(s[:19], fmt[:len(fmt)])
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(KST).isoformat()
        except Exception:
            pass
    return s


# ─── YouTube (Atom feed) ───────────────────────────────────────────────────
def parse_youtube(root: ET.Element) -> list[dict]:
    items = []
    for entry in root.findall("atom:entry", NS)[:5]:
        vid_id = entry.findtext("yt:videoId", namespaces=NS) or ""
        title = entry.findtext("atom:title", namespaces=NS) or ""
        published = entry.findtext("atom:published", namespaces=NS) or ""
        url = f"https://www.youtube.com/watch?v={vid_id}" if vid_id else ""
        thumb = f"https://i.ytimg.com/vi/{vid_id}/mqdefault.jpg" if vid_id else ""
        items.append({
            "title": title.strip(),
            "url": url,
            "thumbnail": thumb,
            "published": parse_date(published),
        })
    return items


# ─── Naver Blog (RSS 2.0) ──────────────────────────────────────────────────
def parse_rss(root: ET.Element, base_url: str = "") -> list[dict]:
    """Generic RSS 2.0 parser (Naver blog, RSSHub telegram)"""
    channel = root.find("channel")
    if channel is None:
        return []
    items = []
    for item in channel.findall("item")[:5]:
        title = item.findtext("title") or ""
        link  = item.findtext("link")  or ""
        pub   = item.findtext("pubDate") or item.findtext("published") or ""
        # clean HTML from title
        title = re.sub(r"<[^>]+>", "", title).strip()
        items.append({
            "title": title,
            "url":   link.strip(),
            "published": parse_date(pub),
        })
    return items


# ─── Telegram fallback: public page scrape ────────────────────────────────
def scrape_telegram(channel: str = "fireantcrypto", limit: int = 5) -> list[dict]:
    """
    t.me/s/<channel> 퍼블릭 미러에서 최신 포스트 스크레이핑.
    JavaScript 렌더링 없이 정적 HTML만 파싱.
    """
    url = f"https://t.me/s/{channel}"
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"  ⚠️  telegram scrape error: {e}", file=sys.stderr)
        return []

    items = []
    # 포스트 블록: <div class="tgme_widget_message_wrap ...">
    blocks = re.findall(
        r'data-post="([^"]+)".*?<div class="tgme_widget_message_text[^"]*"[^>]*>(.*?)</div>.*?<time[^>]+datetime="([^"]+)"',
        html, re.DOTALL
    )
    for post_id, content, dt in blocks[-limit:]:
        # content = HTML → plain text
        text = re.sub(r"<br\s*/?>", " ", content)
        text = re.sub(r"<[^>]+>", "", text).strip()
        text = text[:120] + ("…" if len(text) > 120 else "")
        post_url = f"https://t.me/{post_id}"
        items.append({
            "title": text or f"포스트 #{post_id.split('/')[-1]}",
            "url": post_url,
            "published": parse_date(dt),
        })

    return list(reversed(items[-limit:]))


# ─── Main ──────────────────────────────────────────────────────────────────
def main():
    result: dict = {
        "updated": datetime.now(KST).isoformat(),
        "youtube":  [],
        "telegram": [],
        "naver":    [],
    }

    # YouTube
    print("📺 Fetching YouTube feed…")
    yt_root = fetch_xml(FEEDS["youtube"])
    if yt_root is not None:
        result["youtube"] = parse_youtube(yt_root)
        print(f"   ✅ {len(result['youtube'])} items")
    else:
        print("   ❌ YouTube feed failed")

    # Naver blog
    print("📝 Fetching Naver blog feed…")
    nv_root = fetch_xml(FEEDS["naver"])
    if nv_root is not None:
        result["naver"] = parse_rss(nv_root)
        print(f"   ✅ {len(result['naver'])} items")
    else:
        print("   ❌ Naver feed failed")

    # Telegram — try RSSHub first, fallback to scrape
    print("📡 Fetching Telegram feed…")
    tg_items = []
    rsshub_url = FEEDS["telegram"][0]
    tg_root = fetch_xml(rsshub_url)
    if tg_root is not None:
        tg_items = parse_rss(tg_root)
        print(f"   ✅ RSSHub: {len(tg_items)} items")
    if not tg_items:
        print("   🔄 RSSHub failed, trying t.me/s scrape…")
        tg_items = scrape_telegram("fireantcrypto")
        print(f"   {'✅' if tg_items else '❌'} Scrape: {len(tg_items)} items")
    result["telegram"] = tg_items

    # Write output
    out_path = "feed.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"\n✅ feed.json 생성 완료 → {out_path}")
    print(f"   YouTube: {len(result['youtube'])}, Telegram: {len(result['telegram'])}, Naver: {len(result['naver'])}")


if __name__ == "__main__":
    main()
