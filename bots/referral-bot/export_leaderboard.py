# DB에서 leaderboard.json 생성 후 /tmp/fireant-dashboard에 복사 + git push
import sqlite3, json, subprocess
from datetime import datetime, date

DB = '/Users/fireant/.openclaw/workspace/bots/referral-bot/referral.db'
DASHBOARD = '/tmp/fireant-dashboard'

con = sqlite3.connect(DB)
con.row_factory = sqlite3.Row

# ── 이벤트 기간 체크 ──────────────────────────────────────────
period = None
try:
    period = con.execute("SELECT start_date, end_date FROM event_period WHERE id=1").fetchone()
except Exception:
    pass

if period:
    today = date.today()
    start = date.fromisoformat(period["start_date"])
    end   = date.fromisoformat(period["end_date"])
    if not (start <= today <= end):
        print(f"⏸ 이벤트 기간 외 ({period['start_date']} ~ {period['end_date']}), 종료.")
        con.close()
        exit(0)
else:
    print("⚠️ event_period 없음 — 기간 체크 스킵, 계속 진행.")

# ── 리더보드 쿼리 ─────────────────────────────────────────────
rows = con.execute("""
    SELECT ROW_NUMBER() OVER (ORDER BY points DESC, registered_at ASC) as rank,
           username, first_name, points,
           (SELECT COUNT(*) FROM users u2 WHERE u2.referrer_id = u1.user_id) as invite_count
    FROM users u1
    WHERE points > 0
    ORDER BY points DESC
""").fetchall()
con.close()

data = {
    "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M KST"),
    "period": {"start": period["start_date"], "end": period["end_date"]} if period else {},
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

print(f"✅ leaderboard.json 생성 완료 ({len(data['leaderboard'])}명)")

# ── git push ──────────────────────────────────────────────────
result = subprocess.run(
    ["bash", "-c",
     f"cd {DASHBOARD} && git add leaderboard.json && "
     f"git diff --cached --quiet || git commit -m '리더보드 자동 업데이트' && git push"],
    capture_output=True, text=True
)
print(result.stdout or "up-to-date")
print(result.stderr[:200] if result.stderr else "")
