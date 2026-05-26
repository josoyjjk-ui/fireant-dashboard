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

def run_dashboard(args):
    return subprocess.run(args, cwd=DASHBOARD, capture_output=True, text=True)

def failed_result(message: str, code: int = 1):
    return subprocess.CompletedProcess(args=[], returncode=code, stdout="", stderr=message)

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


# ── 리더보드 쿼리 (event_points 기준) ────────────────────────
rows = con.execute("""
    SELECT ROW_NUMBER() OVER (ORDER BY ep.points DESC, u.registered_at ASC) as rank,
           u.username, u.first_name, ep.points,
           (SELECT COUNT(*) FROM event_points ep2 JOIN users u2 ON ep2.user_id=u2.user_id
            WHERE u2.referrer_id=u.user_id AND ep2.event_id=ep.event_id) as invite_count
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

# ── 원격 최신 상태 확인. 로컬 커밋/수정은 절대 덮어쓰지 않음 ─────────────
base = run_dashboard(["git", "fetch", "origin"])
if base.returncode == 0:
    dirty = run_dashboard(["git", "diff", "--quiet"])
    staged = run_dashboard(["git", "diff", "--cached", "--quiet"])
    if dirty.returncode != 0 or staged.returncode != 0:
        base = failed_result("Tracked local changes present; refusing to overwrite.", 10)

if base.returncode == 0:
    head = run_dashboard(["git", "rev-parse", "HEAD"])
    remote = run_dashboard(["git", "rev-parse", "origin/main"])
    if head.returncode != 0 or remote.returncode != 0:
        base = failed_result((head.stderr or remote.stderr or "Unable to resolve git refs").strip())
    elif head.stdout.strip() != remote.stdout.strip():
        ancestor = run_dashboard(["git", "merge-base", "--is-ancestor", head.stdout.strip(), remote.stdout.strip()])
        if ancestor.returncode != 0:
            base = failed_result("Local branch has unpushed or diverged commits; refusing to reset.", 11)
        else:
            base = run_dashboard(["git", "merge", "--ff-only", "origin/main"])

if base.returncode != 0:
    err = (base.stderr or base.stdout or "unknown git sync error")[:300]
    tg_alert(f"⚠️ [리더보드 동기화 중단]\n{err}")
    print(f"ALERT SENT: {err}")
    exit(base.returncode)

# ── JSON 파일 쓰기 ──────────────────────────────────────────
out = f"{DASHBOARD}/leaderboard.json"
with open(out, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"✅ leaderboard.json 생성 완료 ({total_participants}명, 이벤트: {event_name})")

# ── git push ──────────────────────────────────────────────────
result = run_dashboard(["git", "add", "leaderboard.json"])
if result.returncode == 0:
    result = run_dashboard(["git", "diff", "--cached", "--quiet"])
    if result.returncode == 0:
        print("up-to-date")
        exit(0)
    result = run_dashboard(["git", "commit", "-m", f"리더보드 자동 업데이트 [{event_name}]"])
if result.returncode == 0:
    result = run_dashboard(["git", "pull", "--rebase", "origin", "main"])
if result.returncode == 0:
    result = run_dashboard(["git", "push", "origin", "main"])

print(result.stdout or "up-to-date")
if result.returncode != 0:
    err = (result.stderr or result.stdout or "unknown error")[:300]
    tg_alert(f"⚠️ [리더보드 동기화 실패]\n{err}")
    print(f"ALERT SENT: {err}")
else:
    print(result.stderr[:200] if result.stderr else "")
