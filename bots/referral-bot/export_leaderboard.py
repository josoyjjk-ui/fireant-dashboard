# DB에서 leaderboard.json 생성 후 fireant-dashboard에 복사 + git push
import os, sqlite3, json, subprocess, urllib.request
from datetime import datetime, date

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "8715030972:AAEaCj5zaNsB6OhwBhXwg6gZ0KM8ibXOpW0")
CHAT_ID = "477743685"

def tg_alert(msg: str):
    try:
        url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
        data = json.dumps({"chat_id": CHAT_ID, "text": msg}).encode()
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass

DB = '/Users/fireant/.openclaw/workspace/bots/referral-bot/referral.db'
DASHBOARD = '/Users/fireant/fireant-dashboard'

con = sqlite3.connect(DB)
con.row_factory = sqlite3.Row

# ── 활성 이벤트 조회 ──────────────────────────────────────────
event = con.execute(
    "SELECT id, name, start_date, end_date FROM events WHERE is_active=1 ORDER BY id DESC LIMIT 1"
).fetchone()

if not event:
    print("⏸ 활성 이벤트 없음, 종료.")
    con.close()
    exit(0)

event_id   = event["id"]
event_name = event["name"]
start_date = event["start_date"]
end_date   = event["end_date"]

# 기간 체크
if start_date and end_date:
    today = date.today()
    start = date.fromisoformat(start_date)
    end   = date.fromisoformat(end_date)
    if not (start <= today <= end):
        print(f"⏸ 이벤트 기간 외 ({start_date} ~ {end_date}), 종료.")
        con.close()
        exit(0)

# ── 리더보드 쿼리 (event_points 기준) ────────────────────────
rows = con.execute("""
    SELECT ROW_NUMBER() OVER (ORDER BY ep.points DESC, u.registered_at ASC) as rank,
           u.username, u.first_name, ep.points,
           (SELECT COUNT(*) FROM users u2 WHERE u2.referrer_id = u.user_id) as invite_count
    FROM event_points ep
    JOIN users u ON ep.user_id = u.user_id
    WHERE ep.event_id = ? AND ep.points > 0
    ORDER BY ep.points DESC
""", (event_id,)).fetchall()

total_participants = len(rows)
total_points = sum(r["points"] for r in rows)
con.close()

data = {
    "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M KST"),
    "event_name": event_name,
    "period": {"start": start_date, "end": end_date},
    "total_participants": total_participants,
    "total_points": total_points,
    "leaderboard": [
        {
            "rank": r["rank"],
            "username": r["username"] or "",
            "first_name": r["first_name"] or "",
            "points": r["points"],
            "invite_count": r["invite_count"]
        } for r in rows
    ]
}

out = f"{DASHBOARD}/leaderboard.json"
with open(out, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"✅ leaderboard.json 생성 완료 ({total_participants}명, 이벤트: {event_name})")

# ── git push ──────────────────────────────────────────────────
result = subprocess.run(
    ["bash", "-c",
     f"cd {DASHBOARD} && git fetch origin && "
     f"git fetch origin && "
     f"git reset --hard origin/main && "
     f"git add leaderboard.json leaderboard/index.html && "
     f"git diff --cached --quiet || git commit -m '리더보드 자동 업데이트 [{event_name}]' && "
     f"git push origin main"],
    capture_output=True, text=True
)
print(result.stdout or "up-to-date")
if result.returncode != 0:
    err = result.stderr[:300] if result.stderr else "unknown error"
    tg_alert(f"⚠️ [리더보드 동기화 실패]\n{err}")
    print(f"ALERT SENT: {err}")
else:
    print(result.stderr[:200] if result.stderr else "")
