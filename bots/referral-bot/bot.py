#!/usr/bin/env python3
"""
Referral Bot - 텔레그램 채널 친구초대 이벤트 봇
Python 3 + python-telegram-bot v20+ (async)
"""

import os
import csv
import io
import logging
import sqlite3
import subprocess
from datetime import datetime
from contextlib import contextmanager

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    CallbackQueryHandler,
    ChatMemberHandler,
    ConversationHandler,
    filters,
    ContextTypes,
)

# ── 설정 ────────────────────────────────────────────────────────────────────
def get_token() -> str:
    result = subprocess.run(
        ["security", "find-generic-password", "-a", "referral-bot",
         "-s", "telegram-bot-token", "-w"],
        capture_output=True, text=True
    )
    token = result.stdout.strip()
    if not token:
        raise RuntimeError("Keychain에서 봇 토큰을 가져올 수 없습니다.")
    return token

ADMIN_ID = 477743685
DB_PATH = os.path.join(os.path.dirname(__file__), "referral.db")

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    level=logging.INFO,
    handlers=[
        logging.FileHandler(os.path.join(os.path.dirname(__file__), "bot.log")),
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger(__name__)

# ConversationHandler 상태
WAITING_REFERRER = 1
WAITING_RESET_CONFIRM = 2

# ── DB ───────────────────────────────────────────────────────────────────────
@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                user_id     INTEGER PRIMARY KEY,
                username    TEXT,
                first_name  TEXT,
                points      INTEGER DEFAULT 0,
                referrer_id INTEGER,
                registered_at TEXT DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (referrer_id) REFERENCES users(user_id)
            );

            CREATE TABLE IF NOT EXISTS channels (
                channel_id  INTEGER PRIMARY KEY,
                channel_name TEXT,
                added_at    TEXT DEFAULT (datetime('now', 'localtime'))
            );

            CREATE TABLE IF NOT EXISTS event_period (
                id          INTEGER PRIMARY KEY CHECK (id = 1),
                start_date  TEXT,
                end_date    TEXT
            );

            INSERT OR IGNORE INTO event_period (id, start_date, end_date)
            VALUES (1, NULL, NULL);
        """)
    logger.info("DB 초기화 완료: %s", DB_PATH)


# ── 헬퍼 ────────────────────────────────────────────────────────────────────
def is_event_active() -> bool:
    with get_db() as conn:
        row = conn.execute("SELECT start_date, end_date FROM event_period WHERE id=1").fetchone()
    if not row or (row["start_date"] is None and row["end_date"] is None):
        return True  # 기간 미설정 = 상시 운영
    now = datetime.now().strftime("%Y-%m-%d")
    start = row["start_date"] or "0000-00-00"
    end   = row["end_date"]   or "9999-12-31"
    return start <= now <= end


def get_user(user_id: int):
    with get_db() as conn:
        return conn.execute("SELECT * FROM users WHERE user_id=?", (user_id,)).fetchone()


def register_user(user_id: int, username: str, first_name: str) -> bool:
    """새 유저 등록. 이미 있으면 False."""
    with get_db() as conn:
        existing = conn.execute("SELECT user_id FROM users WHERE user_id=?", (user_id,)).fetchone()
        if existing:
            return False
        conn.execute(
            "INSERT INTO users (user_id, username, first_name, points) VALUES (?,?,?,1)",
            (user_id, username, first_name)
        )
    return True


def set_referrer(user_id: int, referrer_id: int) -> tuple[bool, str]:
    """초대자 설정. (성공여부, 메시지)"""
    if user_id == referrer_id:
        return False, "자기 자신을 초대자로 등록할 수 없습니다."
    with get_db() as conn:
        user = conn.execute("SELECT referrer_id FROM users WHERE user_id=?", (user_id,)).fetchone()
        if not user:
            return False, "먼저 /start로 등록해주세요."
        if user["referrer_id"] is not None:
            return False, "이미 초대자가 등록되어 있습니다."
        referrer = conn.execute("SELECT user_id, first_name FROM users WHERE user_id=?", (referrer_id,)).fetchone()
        if not referrer:
            return False, f"ID {referrer_id}는 아직 봇을 시작하지 않은 유저입니다."
        conn.execute("UPDATE users SET referrer_id=? WHERE user_id=?", (referrer_id, user_id))
        conn.execute("UPDATE users SET points = points + 1 WHERE user_id=?", (referrer_id,))
    return True, referrer["first_name"]


def get_leaderboard(limit: int = 10):
    with get_db() as conn:
        return conn.execute(
            "SELECT user_id, username, first_name, points FROM users ORDER BY points DESC LIMIT ?",
            (limit,)
        ).fetchall()


def get_all_channels():
    with get_db() as conn:
        return conn.execute("SELECT channel_id, channel_name FROM channels").fetchall()


# ── 유저 명령어 ──────────────────────────────────────────────────────────────
async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    if not user:
        return

    is_new = register_user(user.id, user.username or "", user.first_name or "")

    if is_new:
        await update.message.reply_text(
            f"✅ 환영합니다, {user.first_name}님!\n"
            f"+1 포인트가 지급됐습니다.\n\n"
            f"초대한 분의 텔레그램 숫자 ID를 입력해주세요.\n"
            f"(없으면 /skip 입력)"
        )
        return WAITING_REFERRER
    else:
        await update.message.reply_text(
            f"이미 등록된 유저입니다, {user.first_name}님!\n"
            f"/points 로 포인트를 확인하세요."
        )
        return ConversationHandler.END


async def receive_referrer_id(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    text = update.message.text.strip()

    try:
        referrer_id = int(text)
    except ValueError:
        await update.message.reply_text(
            "숫자 ID를 입력해주세요. (예: 123456789)\n없으면 /skip"
        )
        return WAITING_REFERRER

    ok, msg = set_referrer(user.id, referrer_id)
    if ok:
        await update.message.reply_text(f"✅ {msg}님을 초대자로 등록했습니다! 초대자에게 +1 포인트가 지급됐습니다.")
    else:
        await update.message.reply_text(f"❌ {msg}")

    return ConversationHandler.END


async def cmd_skip(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("초대자 없이 등록했습니다. /points 로 포인트를 확인하세요.")
    return ConversationHandler.END


async def cmd_points(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    row = get_user(user.id)
    if not row:
        await update.message.reply_text("아직 등록되지 않았습니다. /start 로 시작해주세요.")
        return
    await update.message.reply_text(
        f"🏆 {user.first_name}님의 포인트\n"
        f"현재 포인트: {row['points']}점"
    )


async def cmd_rank(update: Update, context: ContextTypes.DEFAULT_TYPE):
    board = get_leaderboard(10)
    if not board:
        await update.message.reply_text("아직 등록된 유저가 없습니다.")
        return

    lines = ["🏆 TOP 10 순위\n"]
    medals = ["🥇", "🥈", "🥉"]
    for i, row in enumerate(board):
        prefix = medals[i] if i < 3 else f"{i+1}."
        name = row["first_name"] or row["username"] or str(row["user_id"])
        lines.append(f"{prefix} {name} — {row['points']}점")

    await update.message.reply_text("\n".join(lines))


# ── 관리자 명령어 ────────────────────────────────────────────────────────────
def admin_only(func):
    async def wrapper(update: Update, context: ContextTypes.DEFAULT_TYPE):
        if update.effective_user.id != ADMIN_ID:
            await update.message.reply_text("⛔ 관리자 전용 명령어입니다.")
            return
        return await func(update, context)
    wrapper.__name__ = func.__name__
    return wrapper


@admin_only
async def cmd_admin(update: Update, context: ContextTypes.DEFAULT_TYPE):
    keyboard = [
        [InlineKeyboardButton("📊 리더보드", callback_data="admin_leaderboard"),
         InlineKeyboardButton("📤 CSV 내보내기", callback_data="admin_export")],
        [InlineKeyboardButton("📋 채널 목록", callback_data="admin_channels"),
         InlineKeyboardButton("📅 이벤트 기간", callback_data="admin_period")],
        [InlineKeyboardButton("🔴 포인트 초기화", callback_data="admin_reset")],
    ]
    await update.message.reply_text(
        "🛠 관리자 메뉴",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )


@admin_only
async def cmd_leaderboard(update: Update, context: ContextTypes.DEFAULT_TYPE):
    board = get_leaderboard(20)
    if not board:
        await update.message.reply_text("등록된 유저가 없습니다.")
        return
    lines = ["📊 전체 포인트 순위\n"]
    for i, row in enumerate(board):
        name = row["first_name"] or row["username"] or str(row["user_id"])
        lines.append(f"{i+1}. {name} ({row['user_id']}) — {row['points']}점")
    await update.message.reply_text("\n".join(lines))


@admin_only
async def cmd_export(update: Update, context: ContextTypes.DEFAULT_TYPE):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT user_id, username, first_name, points, referrer_id, registered_at FROM users ORDER BY points DESC"
        ).fetchall()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["user_id", "username", "first_name", "points", "referrer_id", "registered_at"])
    for row in rows:
        writer.writerow([row["user_id"], row["username"], row["first_name"],
                         row["points"], row["referrer_id"], row["registered_at"]])

    buf.seek(0)
    filename = f"referral_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    await update.message.reply_document(
        document=buf.getvalue().encode("utf-8-sig"),
        filename=filename,
        caption=f"총 {len(rows)}명 데이터"
    )


@admin_only
async def cmd_addchannel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text("사용법: /addchannel <channel_id>")
        return
    try:
        channel_id = int(context.args[0])
    except ValueError:
        await update.message.reply_text("채널 ID는 숫자여야 합니다.")
        return

    with get_db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO channels (channel_id) VALUES (?)",
            (channel_id,)
        )
    await update.message.reply_text(f"✅ 채널 {channel_id} 추가됐습니다.")


@admin_only
async def cmd_removechannel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text("사용법: /removechannel <channel_id>")
        return
    try:
        channel_id = int(context.args[0])
    except ValueError:
        await update.message.reply_text("채널 ID는 숫자여야 합니다.")
        return

    with get_db() as conn:
        conn.execute("DELETE FROM channels WHERE channel_id=?", (channel_id,))
    await update.message.reply_text(f"✅ 채널 {channel_id} 제거됐습니다.")


@admin_only
async def cmd_reset(update: Update, context: ContextTypes.DEFAULT_TYPE):
    keyboard = [
        [InlineKeyboardButton("⚠️ 정말 초기화", callback_data="confirm_reset"),
         InlineKeyboardButton("❌ 취소", callback_data="cancel_reset")]
    ]
    await update.message.reply_text(
        "⚠️ 모든 유저 포인트를 초기화합니다. 계속하시겠습니까?",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )


@admin_only
async def cmd_setperiod(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if len(context.args) < 2:
        await update.message.reply_text("사용법: /setperiod <시작일 YYYY-MM-DD> <종료일 YYYY-MM-DD>")
        return
    start, end = context.args[0], context.args[1]
    with get_db() as conn:
        conn.execute(
            "UPDATE event_period SET start_date=?, end_date=? WHERE id=1",
            (start, end)
        )
    await update.message.reply_text(f"✅ 이벤트 기간: {start} ~ {end}")


# ── 콜백 쿼리 ────────────────────────────────────────────────────────────────
async def callback_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    data = query.data

    if update.effective_user.id != ADMIN_ID and data.startswith("admin_"):
        await query.edit_message_text("⛔ 관리자 전용입니다.")
        return

    if data == "admin_leaderboard":
        board = get_leaderboard(20)
        lines = ["📊 전체 포인트 순위\n"]
        for i, row in enumerate(board):
            name = row["first_name"] or row["username"] or str(row["user_id"])
            lines.append(f"{i+1}. {name} ({row['user_id']}) — {row['points']}점")
        await query.edit_message_text("\n".join(lines) if board else "데이터 없음")

    elif data == "admin_export":
        await query.edit_message_text("CSV 내보내기는 /export 명령어를 사용하세요.")

    elif data == "admin_channels":
        channels = get_all_channels()
        if not channels:
            await query.edit_message_text("등록된 채널이 없습니다.")
        else:
            lines = ["📋 등록된 채널\n"]
            for ch in channels:
                lines.append(f"• {ch['channel_id']} ({ch['channel_name'] or '이름 없음'})")
            await query.edit_message_text("\n".join(lines))

    elif data == "admin_period":
        with get_db() as conn:
            row = conn.execute("SELECT start_date, end_date FROM event_period WHERE id=1").fetchone()
        if row and row["start_date"]:
            await query.edit_message_text(f"📅 이벤트 기간: {row['start_date']} ~ {row['end_date']}")
        else:
            await query.edit_message_text("📅 이벤트 기간: 상시 운영 중\n변경: /setperiod YYYY-MM-DD YYYY-MM-DD")

    elif data == "admin_reset":
        keyboard = [
            [InlineKeyboardButton("⚠️ 정말 초기화", callback_data="confirm_reset"),
             InlineKeyboardButton("❌ 취소", callback_data="cancel_reset")]
        ]
        await query.edit_message_text(
            "⚠️ 모든 유저 포인트를 0으로 초기화합니다. 계속하시겠습니까?",
            reply_markup=InlineKeyboardMarkup(keyboard)
        )

    elif data == "confirm_reset":
        with get_db() as conn:
            conn.execute("UPDATE users SET points=0, referrer_id=NULL")
        await query.edit_message_text("✅ 포인트 초기화 완료.")

    elif data == "cancel_reset":
        await query.edit_message_text("❌ 초기화 취소됐습니다.")


# ── 채널 멤버 이벤트 (신규 입장) ─────────────────────────────────────────────
async def chat_member_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    result = update.chat_member
    if not result:
        return

    # 등록된 채널인지 확인
    channel_id = result.chat.id
    with get_db() as conn:
        registered = conn.execute(
            "SELECT channel_id FROM channels WHERE channel_id=?", (channel_id,)
        ).fetchone()
    if not registered:
        return

    # 신규 입장 (was: not member → now: member)
    old_status = result.old_chat_member.status
    new_status = result.new_chat_member.status
    if old_status in ("left", "kicked", "restricted") and new_status == "member":
        new_user = result.new_chat_member.user
        if new_user.is_bot:
            return
        try:
            await context.bot.send_message(
                chat_id=new_user.id,
                text=(
                    f"안녕하세요, {new_user.first_name}님! 👋\n"
                    f"채널에 오신 걸 환영합니다!\n\n"
                    f"초대한 분의 텔레그램 숫자 ID를 입력해주세요.\n"
                    f"(없으면 /skip 입력)\n\n"
                    f"먼저 /start 로 이벤트에 참여해주세요!"
                )
            )
        except Exception as e:
            logger.warning("DM 발송 실패 (user_id=%s): %s", new_user.id, e)


# ── 메인 ─────────────────────────────────────────────────────────────────────
def main():
    init_db()
    token = get_token()

    app = Application.builder().token(token).build()

    # ConversationHandler: /start → 초대자 입력
    conv = ConversationHandler(
        entry_points=[CommandHandler("start", cmd_start)],
        states={
            WAITING_REFERRER: [
                CommandHandler("skip", cmd_skip),
                MessageHandler(filters.TEXT & ~filters.COMMAND, receive_referrer_id),
            ],
        },
        fallbacks=[CommandHandler("skip", cmd_skip)],
    )
    app.add_handler(conv)

    # 유저 명령어
    app.add_handler(CommandHandler("points", cmd_points))
    app.add_handler(CommandHandler("rank", cmd_rank))

    # 관리자 명령어
    app.add_handler(CommandHandler("admin", cmd_admin))
    app.add_handler(CommandHandler("leaderboard", cmd_leaderboard))
    app.add_handler(CommandHandler("export", cmd_export))
    app.add_handler(CommandHandler("addchannel", cmd_addchannel))
    app.add_handler(CommandHandler("removechannel", cmd_removechannel))
    app.add_handler(CommandHandler("reset", cmd_reset))
    app.add_handler(CommandHandler("setperiod", cmd_setperiod))

    # 콜백
    app.add_handler(CallbackQueryHandler(callback_handler))

    # 채널 멤버 변경 이벤트
    app.add_handler(ChatMemberHandler(chat_member_handler, ChatMemberHandler.CHAT_MEMBER))

    logger.info("🤖 Referral Bot 시작!")
    app.run_polling(allowed_updates=Update.ALL_TYPES, drop_pending_updates=True)


if __name__ == "__main__":
    main()
