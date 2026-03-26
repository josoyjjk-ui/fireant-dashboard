#!/usr/bin/env python3
import asyncio
import json
import logging
import sqlite3
import subprocess
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional
from zoneinfo import ZoneInfo

import requests
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "task34.db"
GOOGLE_TOKEN_PATH = Path("/Users/fireant/.openclaw/workspace/secrets/google-bridge34-token.json")
KST = ZoneInfo("Asia/Seoul")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("task34bot")


@dataclass
class TaskItem:
    event_id: str
    summary: str
    when_label: str
    due_date: datetime
    overdue: bool
    d_label: str


def get_bot_token() -> str:
    # 환경변수 우선 사용 (LaunchAgent 환경)
    import os
    env_token = os.environ.get("TASK34_BOT_TOKEN", "")
    if env_token:
        return env_token
    # Keychain fallback
    return subprocess.check_output(
        ["security", "find-generic-password", "-s", "task34-bot-token", "-w"],
        text=True,
    ).strip()


def init_db() -> None:
    conn = sqlite3.connect(DB_PATH)
    try:
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS email_map (
                email TEXT PRIMARY KEY,
                telegram_username TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS group_chats (
                chat_id INTEGER PRIMARY KEY,
                title TEXT,
                activated_at TEXT NOT NULL
            )
            """
        )
        conn.commit()
    finally:
        conn.close()


def db_connect():
    return sqlite3.connect(DB_PATH)


def refresh_google_access_token(token_data: dict) -> dict:
    payload = {
        "client_id": token_data["client_id"],
        "client_secret": token_data["client_secret"],
        "refresh_token": token_data["refresh_token"],
        "grant_type": "refresh_token",
    }
    resp = requests.post(token_data.get("token_uri", "https://oauth2.googleapis.com/token"), data=payload, timeout=20)
    resp.raise_for_status()
    refreshed = resp.json()
    token_data["access_token"] = refreshed["access_token"]
    token_data["token"] = refreshed["access_token"]
    expires_in = int(refreshed.get("expires_in", 3600))
    token_data["expiry"] = (datetime.now(tz=KST) + timedelta(seconds=expires_in)).isoformat()
    GOOGLE_TOKEN_PATH.write_text(json.dumps(token_data, ensure_ascii=False), encoding="utf-8")
    return token_data


def load_google_token() -> dict:
    token_data = json.loads(GOOGLE_TOKEN_PATH.read_text(encoding="utf-8"))
    expiry = token_data.get("expiry")
    expired = True
    if expiry:
        try:
            expiry_dt = datetime.fromisoformat(expiry.replace("Z", "+00:00"))
            expired = datetime.now(tz=expiry_dt.tzinfo or KST) >= expiry_dt - timedelta(minutes=5)
        except ValueError:
            expired = True
    if expired:
        logger.info("Google access_token 갱신 중")
        token_data = refresh_google_access_token(token_data)
    return token_data


def build_calendar_service():
    token_data = load_google_token()
    return build("calendar", "v3", developerKey=None, credentials=None, cache_discovery=False,
                 requestBuilder=None), token_data["access_token"]


def calendar_list_events(start: datetime, end: datetime) -> List[dict]:
    service, access_token = build_calendar_service()
    headers = {"Authorization": f"Bearer {access_token}"}

    # googleapiclient에서 credentials 없이 build 시 auth header 자동 주입이 없어서 REST fallback 사용
    params = {
        "timeMin": start.astimezone(ZoneInfo("UTC")).isoformat().replace("+00:00", "Z"),
        "timeMax": end.astimezone(ZoneInfo("UTC")).isoformat().replace("+00:00", "Z"),
        "singleEvents": "true",
        "orderBy": "startTime",
    }
    resp = requests.get(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events",
        headers=headers,
        params=params,
        timeout=20,
    )
    resp.raise_for_status()
    return resp.json().get("items", [])


def map_email(email: str) -> Optional[str]:
    conn = db_connect()
    try:
        cur = conn.cursor()
        cur.execute("SELECT telegram_username FROM email_map WHERE lower(email)=lower(?)", (email,))
        row = cur.fetchone()
        return row[0] if row else None
    finally:
        conn.close()


def upsert_email_map(email: str, username: str) -> None:
    conn = db_connect()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO email_map(email, telegram_username, created_at)
            VALUES (?, ?, ?)
            ON CONFLICT(email) DO UPDATE SET
              telegram_username=excluded.telegram_username,
              created_at=excluded.created_at
            """,
            (email.strip().lower(), username.strip().lstrip("@"), datetime.now(tz=KST).isoformat()),
        )
        conn.commit()
    finally:
        conn.close()


def activate_chat(chat_id: int, title: str) -> None:
    conn = db_connect()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO group_chats(chat_id, title, activated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(chat_id) DO UPDATE SET
              title=excluded.title,
              activated_at=excluded.activated_at
            """,
            (chat_id, title, datetime.now(tz=KST).isoformat()),
        )
        conn.commit()
    finally:
        conn.close()


def list_active_chats() -> List[int]:
    conn = db_connect()
    try:
        cur = conn.cursor()
        cur.execute("SELECT chat_id FROM group_chats")
        return [r[0] for r in cur.fetchall()]
    finally:
        conn.close()


def parse_event_due(event: dict) -> datetime:
    if "dateTime" in event.get("start", {}):
        return datetime.fromisoformat(event["start"]["dateTime"].replace("Z", "+00:00")).astimezone(KST)
    date_val = event.get("start", {}).get("date")
    if date_val:
        return datetime.fromisoformat(date_val).replace(tzinfo=KST)
    return datetime.now(tz=KST)


def assign_users(event: dict) -> List[str]:
    users = []
    for attendee in event.get("attendees", []):
        email = attendee.get("email")
        if not email:
            continue
        mapped = map_email(email)
        if mapped:
            users.append(f"@{mapped}")

    if not users:
        organizer_email = (event.get("organizer") or {}).get("email")
        if organizer_email:
            mapped = map_email(organizer_email)
            if mapped:
                users.append(f"@{mapped}")

    if not users:
        users = ["@unmapped"]
    return sorted(set(users))


def make_d_label(due: datetime, now: datetime) -> str:
    delta_days = (due.date() - now.date()).days
    if delta_days == 0:
        return "D-0"
    if delta_days > 0:
        return f"D+{delta_days}"
    return "지연"


def build_task_items(events: List[dict], now: datetime) -> Dict[str, List[TaskItem]]:
    buckets: Dict[str, List[TaskItem]] = {}
    for ev in events:
        status = ev.get("status", "confirmed")
        if status == "cancelled":
            continue
        due = parse_event_due(ev)
        users = assign_users(ev)
        summary = ev.get("summary", "(제목 없음)")
        overdue = due < now
        if "dateTime" in ev.get("start", {}):
            when_label = due.strftime("%H:%M")
        else:
            when_label = "전일" if overdue else "종일"
        d_label = make_d_label(due, now)
        item = TaskItem(
            event_id=ev.get("id", ""),
            summary=summary,
            when_label=when_label,
            due_date=due,
            overdue=overdue,
            d_label=d_label,
        )
        for user in users:
            buckets.setdefault(user, []).append(item)

    for user in buckets:
        buckets[user].sort(key=lambda x: x.due_date)
    return buckets


def render_reminder(events: List[dict], now: datetime) -> str:
    buckets = build_task_items(events, now)
    total = 0
    overdue_count = 0

    lines = [
        f"🔔 [업무 리마인더] {now.strftime('%Y-%m-%d %H:%M')} KST",
        "",
        "━━━━━━━━━━━━━━━━",
        "📋 미완료 업무",
        "━━━━━━━━━━━━━━━━",
        "",
    ]

    if not buckets:
        lines += ["오늘~7일 내 미완료 업무가 없습니다.", "", "━━━━━━━━━━━━━━━━", "총 0건 | 지연 0건"]
        return "\n".join(lines)

    for user, items in buckets.items():
        lines.append(f"👤 {user}")
        for item in items:
            total += 1
            if item.overdue:
                overdue_count += 1
                lines.append(f"  • [{item.when_label}] {item.summary} ⚠️ 지연")
            else:
                lines.append(f"  • [{item.when_label}] {item.summary} ⏰ {item.d_label}")
        lines.append("")

    lines += ["━━━━━━━━━━━━━━━━", f"총 {total}건 | 지연 {overdue_count}건"]
    return "\n".join(lines)


async def send_reminder_to_all(app: Application, horizon_days: int = 7) -> None:
    now = datetime.now(tz=KST)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end = (start + timedelta(days=horizon_days + 1)).replace(hour=0)

    try:
        events = calendar_list_events(start, end)
        text = render_reminder(events, now)
        chat_ids = list_active_chats()
        if not chat_ids:
            logger.info("활성화된 그룹 채팅이 없습니다.")
            return
        for chat_id in chat_ids:
            await app.bot.send_message(chat_id=chat_id, text=text)
        logger.info("리마인더 전송 완료: %s개 채팅", len(chat_ids))
    except HttpError:
        logger.exception("Google Calendar API 오류")
    except Exception:
        logger.exception("리마인더 전송 실패")


async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat = update.effective_chat
    activate_chat(chat.id, chat.title or chat.full_name or str(chat.id))
    await update.message.reply_text("✅ Task34 봇 활성화 완료\n이 채팅에 정기 리마인더를 보냅니다.")


async def cmd_today(update: Update, context: ContextTypes.DEFAULT_TYPE):
    now = datetime.now(tz=KST)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)
    events = calendar_list_events(start, end)
    await update.message.reply_text(render_reminder(events, now))


async def cmd_week(update: Update, context: ContextTypes.DEFAULT_TYPE):
    now = datetime.now(tz=KST)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=8)
    events = calendar_list_events(start, end)
    await update.message.reply_text(render_reminder(events, now))


async def cmd_map(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if len(context.args) != 2:
        await update.message.reply_text("사용법: /map 이메일 @텔레그램아이디")
        return

    email, username = context.args
    if "@" not in email or not username.startswith("@"):
        await update.message.reply_text("형식 오류. 예: /map user@company.com @username")
        return

    upsert_email_map(email, username)
    await update.message.reply_text(f"매핑 저장: {email.lower()} → {username}")


def setup_scheduler(app: Application) -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler(timezone=KST)

    # 주간/주말 동일: 09,13,17,21시 + 23~08 매시간
    scheduler.add_job(lambda: asyncio.create_task(send_reminder_to_all(app)), "cron", hour="9,13,17,21", minute=0)
    scheduler.add_job(lambda: asyncio.create_task(send_reminder_to_all(app)), "cron", hour="23,0,1,2,3,4,5,6,7,8", minute=0)

    scheduler.start()
    return scheduler


async def post_init(app: Application) -> None:
    setup_scheduler(app)
    logger.info("Task34 bot started - scheduler running")


async def async_main() -> None:
    init_db()
    token = get_bot_token()

    app = Application.builder().token(token).post_init(post_init).build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("today", cmd_today))
    app.add_handler(CommandHandler("week", cmd_week))
    app.add_handler(CommandHandler("map", cmd_map))

    logger.info("Task34 bot starting...")
    async with app:
        await app.start()
        await app.updater.start_polling(allowed_updates=Update.ALL_TYPES)
        # Run until shutdown
        import signal
        stop_event = asyncio.Event()
        
        def _stop():
            stop_event.set()
        
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, _stop)
        
        await stop_event.wait()
        await app.updater.stop()
        await app.stop()


def main() -> None:
    asyncio.run(async_main())


if __name__ == "__main__":
    main()
