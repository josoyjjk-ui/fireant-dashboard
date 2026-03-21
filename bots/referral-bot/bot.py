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
import threading
from datetime import datetime
from contextlib import contextmanager

# Google Sheets 연동
try:
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build as gbuild
    GSHEETS_AVAILABLE = True
except ImportError:
    GSHEETS_AVAILABLE = False

GSHEETS_TOKEN   = '/Users/fireant/.openclaw/workspace/secrets/google-token.json'
GSHEETS_SCOPES  = ['https://www.googleapis.com/auth/spreadsheets']
GSHEETS_SHEET_ID = '1prtoKycManbOj-HoMnzZ68kl6VEEm3h5vvvTUzK6QHs'
GSHEETS_RANGE    = '정보수집!A:I'

def append_to_sheet(row: list):
    """Google Sheets에 행 추가 (비동기 스레드로 실행)"""
    if not GSHEETS_AVAILABLE:
        return
    def _write():
        try:
            creds = Credentials.from_authorized_user_file(GSHEETS_TOKEN, GSHEETS_SCOPES)
            if creds.expired and creds.refresh_token:
                creds.refresh(Request())
            service = gbuild('sheets', 'v4', credentials=creds)
            service.spreadsheets().values().append(
                spreadsheetId=GSHEETS_SHEET_ID,
                range=GSHEETS_RANGE,
                valueInputOption='USER_ENTERED',
                insertDataOption='INSERT_ROWS',
                body={'values': [row]}
            ).execute()
        except Exception as e:
            logging.getLogger(__name__).error(f"Sheets 기록 실패: {e}")
    threading.Thread(target=_write, daemon=True).start()

def delete_from_sheet(user_id: int):
    """Sheets에서 user_id가 일치하는 행 삭제 (B열 = user_id)"""
    if not GSHEETS_AVAILABLE:
        return
    try:
        token_path = GSHEETS_TOKEN
        creds = Credentials.from_authorized_user_file(token_path, GSHEETS_SCOPES)
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
        service = gbuild('sheets', 'v4', credentials=creds)

        # 시트명 파싱 (GSHEETS_RANGE에서 '!' 앞부분)
        sheet_name = GSHEETS_RANGE.split('!')[0]

        # 전체 데이터 읽기 (A:B)
        result = service.spreadsheets().values().get(
            spreadsheetId=GSHEETS_SHEET_ID,
            range=f'{sheet_name}!A:B'
        ).execute()
        values = result.get('values', [])

        # user_id 매칭 행 찾기 (B열 = index 1)
        rows_to_delete = []
        for i, row in enumerate(values):
            if len(row) > 1 and row[1] == str(user_id):
                rows_to_delete.append(i)

        # 뒤에서부터 삭제 (인덱스 밀림 방지)
        for row_idx in reversed(rows_to_delete):
            service.spreadsheets().batchUpdate(
                spreadsheetId=GSHEETS_SHEET_ID,
                body={
                    'requests': [{
                        'deleteDimension': {
                            'range': {
                                'sheetId': 0,
                                'dimension': 'ROWS',
                                'startIndex': row_idx,
                                'endIndex': row_idx + 1
                            }
                        }
                    }]
                }
            ).execute()
        logger.info(f"Sheets 삭제 완료: user_id={user_id}, 삭제 행 수={len(rows_to_delete)}")
    except Exception as e:
        logging.getLogger(__name__).error(f"Sheets 삭제 예외: {e}")


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

# /inform 상태값
INF_EMAIL    = 10
INF_TG       = 11
INF_PHONE    = 12
INF_AGREE    = 13
INF_REALNAME = 14  # 빗썸 실명 입력 상태
INF_EDIT_CONFIRM = 20  # 수정 확인 대기 상태

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
                ever_registered INTEGER DEFAULT 0,
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

            CREATE TABLE IF NOT EXISTS user_info (
                user_id     INTEGER PRIMARY KEY,
                email       TEXT,
                telegram_id TEXT,
                phone       TEXT,
                agreed      INTEGER DEFAULT 0,
                submitted_at TEXT DEFAULT (datetime('now', 'localtime'))
            );
        """)
        # real_name 컬럼 추가 (이미 있으면 무시)
        try:
            conn.execute("ALTER TABLE user_info ADD COLUMN real_name TEXT")
        except sqlite3.OperationalError:
            pass  # 이미 존재
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
        existing = conn.execute("SELECT user_id, ever_registered FROM users WHERE user_id=?", (user_id,)).fetchone()
        if existing:
            if existing["ever_registered"] == 1:
                return False  # 이미 등록 완료 (재입장 어뷰징 차단)
            # 레코드 있으나 미완료 → 업데이트
            conn.execute(
                "UPDATE users SET username=?, first_name=?, points=10, ever_registered=1 WHERE user_id=?",
                (username, first_name, user_id)
            )
            return True
        conn.execute(
            "INSERT INTO users (user_id, username, first_name, points, ever_registered) VALUES (?,?,?,10,1)",
            (user_id, username, first_name)
        )
    return True


def set_referrer(user_id: int, referrer_input: str) -> tuple[bool, str, int]:
    """초대자 설정. referrer_input은 @username 문자열.
    반환: (성공여부, 메시지, 초대자_user_id)"""
    username_clean = referrer_input.lstrip("@").strip().lower()
    with get_db() as conn:
        user = conn.execute("SELECT referrer_id FROM users WHERE user_id=?", (user_id,)).fetchone()
        if not user:
            return False, "먼저 /start로 등록해주세요.", 0
        if user["referrer_id"] is not None:
            return False, "이미 초대자가 등록되어 있습니다.", 0
        referrer = conn.execute(
            "SELECT user_id, first_name, points FROM users WHERE LOWER(username)=?", (username_clean,)
        ).fetchone()
        if not referrer:
            return False, f"@{username_clean} 유저를 찾을 수 없습니다.\n상대방도 먼저 봇에서 /start를 눌러야 합니다.", 0
        if referrer["user_id"] == user_id:
            return False, "자기 자신을 초대자로 등록할 수 없습니다.", 0
        conn.execute("UPDATE users SET referrer_id=? WHERE user_id=?", (referrer["user_id"], user_id))
        conn.execute("UPDATE users SET points = points + 10 WHERE user_id=?", (referrer["user_id"],))  # 초대자 +10
        conn.execute("UPDATE users SET points = points + 10 WHERE user_id=?", (user_id,))              # 피초대자 +10
        new_points = referrer["points"] + 10
    return True, referrer["first_name"], referrer["user_id"], new_points


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

    # 그룹챗에서는 무응답
    if update.effective_chat.type != "private":
        return

    # 이벤트 공지 — 항상 먼저 표시
    await update.message.reply_text(
        "📣 현재 진행중인 이벤트는 🧩 Eigen Cloud 한국 커뮤니티 릴레이 입장이벤트입니다!\n\n"
        "✅ 아래 채널에 모두 입장해 주세요!\n\n"
        "👉 EigenCloud 한국 공지채널: https://t.me/EigenCloudKorea\n"
        "👉 EigenCloud 한국 커뮤니티: https://t.me/EigenCloud_KR_Community\n"
        "👉 불개미 채널: https://t.me/fireantcrypto\n"
        "👉 불개미 대화방: https://t.me/fireantgroup\n\n"
        "4개 채널 입장 후 아래 절차를 따라주세요!",
        disable_web_page_preview=True
    )

    is_new = register_user(user.id, user.username or "", user.first_name or "")

    if is_new:
        await update.message.reply_text(
            "🔥 친구초대 이벤트 진행 중!\n\n"
            "친구를 초대하면 나와 친구 모두 10포인트씩 지급됩니다.\n"
            "포인트는 이벤트 종료 후 리워드로 환산됩니다.\n\n"
            "👇 아래에 초대한 분의 아이디를 입력해주세요!"
        )
        await update.message.reply_text(
            f"✅ 환영합니다, {user.first_name}님!\n"
            f"🎉 기본 +10 포인트가 지급됐습니다!\n\n"
            f"나를 이곳에 초대한 사람의 텔레그램 @유저네임을 입력하면\n"
            f"👉 나에게 +10포인트 추가 지급\n"
            f"👉 초대한 친구에게도 +10포인트 지급\n\n"
            f"(예: @fireantico)\n"
            f"없으면 /skip 입력"
        )
        return WAITING_REFERRER
    else:
        # 이미 등록된 유저 — user_info 제출 여부 확인
        with get_db() as conn:
            info = conn.execute(
                "SELECT user_id FROM user_info WHERE user_id=? AND agreed=1", (user.id,)
            ).fetchone()

        if info:
            # 정보도 이미 제출함
            await update.message.reply_text(
                f"이미 등록된 유저입니다, {user.first_name}님!\n"
                f"/points 로 포인트를 확인하세요."
            )
        else:
            # 등록은 됐지만 정보 미제출
            await update.message.reply_text(
                f"이미 등록된 유저입니다, {user.first_name}님!\n\n"
                f"📋 아직 당첨자 정보를 제출하지 않으셨습니다.\n"
                f"/inform 을 입력해 정보를 제출해주세요."
            )
        return ConversationHandler.END


async def receive_referrer_id(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    text = update.message.text.strip()

    if not text or text.startswith("/"):
        await update.message.reply_text(
            "@유저네임을 입력해주세요. (예: @fireantico)\n없으면 /skip"
        )
        return WAITING_REFERRER

    result = set_referrer(user.id, text)
    if len(result) == 4:
        ok, msg, referrer_uid, new_points = result
    else:
        ok, msg, referrer_uid = result
        new_points = 0

    if ok:
        invitee_name = user.first_name or user.username or "누군가"
        invitee_username = f"@{user.username}" if user.username else invitee_name
        await update.message.reply_text(
            f"✅ {msg}님을 초대자로 등록했습니다!\n💰 나에게 +10포인트, 초대자에게도 +10포인트 지급됐습니다."
        )
        # 초대자에게 알림 DM
        try:
            await context.bot.send_message(
                chat_id=referrer_uid,
                text=(
                    f"🎉 {invitee_username}님이 회원님의 초대로 등록했습니다!\n\n"
                    f"📌 피초대자: {invitee_username}\n"
                    f"💰 지급 포인트: +10점\n"
                    f"🏆 현재 누적 포인트: {new_points}점"
                )
            )
        except Exception:
            pass  # 초대자가 봇을 시작 안 했을 경우 무시
    else:
        await update.message.reply_text(f"❌ {msg}")

    # 초대자 등록 완료 후 → 당첨자 정보 수집 시작
    await update.message.reply_text(
        "📋 *당첨자 정보 입력을 시작합니다!*\n\n"
        "리워드 지급을 위해 아래 정보를 순서대로 입력해주세요.\n\n"
        "1️⃣ 이메일 주소를 입력해주세요.\n"
        "예) example@gmail.com",
        parse_mode="Markdown"
    )
    return INF_EMAIL


async def cmd_skip(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_chat.type != "private":
        return

    await update.message.reply_text("초대자 없이 등록했습니다.")

    # 초대자 없이 등록 후 → 당첨자 정보 수집 시작
    await update.message.reply_text(
        "📋 *당첨자 정보 입력을 시작합니다!*\n\n"
        "리워드 지급을 위해 아래 정보를 순서대로 입력해주세요.\n\n"
        "1️⃣ 이메일 주소를 입력해주세요.\n"
        "예) example@gmail.com",
        parse_mode="Markdown"
    )
    return INF_EMAIL


async def cmd_setreferrer(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_chat.type != "private":
        return

    """기존 등록 유저도 초대자를 나중에 입력할 수 있는 명령어. /setreferrer @username"""
    user = update.effective_user
    args = context.args
    if not args:
        await update.message.reply_text(
            "사용법: /setreferrer @유저네임\n예: /setreferrer @fireantico"
        )
        return

    referrer_input = args[0]
    result = set_referrer(user.id, referrer_input)
    if len(result) == 4:
        ok, msg, referrer_uid, new_points = result
    else:
        ok, msg, referrer_uid = result
        new_points = 0

    if ok:
        invitee_name = user.first_name or user.username or "누군가"
        invitee_username = f"@{user.username}" if user.username else invitee_name
        await update.message.reply_text(
            f"✅ {msg}님을 초대자로 등록했습니다!\n💰 나에게 +10포인트, 초대자에게도 +10포인트 지급됐습니다."
        )
        try:
            await context.bot.send_message(
                chat_id=referrer_uid,
                text=(
                    f"🎉 {invitee_username}님이 회원님의 초대로 등록했습니다!\n\n"
                    f"📌 피초대자: {invitee_username}\n"
                    f"💰 지급 포인트: +10점\n"
                    f"🏆 현재 누적 포인트: {new_points}점"
                )
            )
        except Exception:
            pass
    else:
        await update.message.reply_text(f"❌ {msg}")


# ── /inform 플로우 ────────────────────────────────────────────────────────────

async def cmd_inform(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """상품 수령 정보 입력 시작"""
    if update.effective_chat.type != "private":
        await update.message.reply_text("개인 채팅에서만 사용 가능합니다.")
        return ConversationHandler.END

    user_id = update.effective_user.id

    # 이미 제출한 경우 완료 메시지 재발송
    with get_db() as conn:
        existing = conn.execute(
            "SELECT email, telegram_id, phone, real_name FROM user_info WHERE user_id=?", (user_id,)
        ).fetchone()
    if existing:
        real_name = existing['real_name'] or "-"
        keyboard = InlineKeyboardMarkup([[
            InlineKeyboardButton("✏️ 정보 수정하기", callback_data="inf_edit_request")
        ]])
        await update.message.reply_text(
            "🎉 *정보 제출 완료!*\n\n"
            f"📧 이메일: {existing['email']}\n"
            f"💬 텔레그램: {existing['telegram_id']}\n"
            f"📱 휴대전화: {existing['phone']}\n"
            f"👤 빗썸 실명: {real_name}\n\n"
            "리워드는 순위 확정 후 순차적으로 지급됩니다.\n감사합니다! 🔥\n\n"
            "당신은 모든 정보를 잘 제출했습니다!\n\n"
            "💡 정보를 수정하고 싶다면 아래 버튼을 누르세요.",
            parse_mode="Markdown",
            reply_markup=keyboard
        )
        return ConversationHandler.END

    await update.message.reply_text(
        "📋 *상품 수령 정보 입력*\n\n"
        "리워드 지급을 위해 아래 정보를 순서대로 입력해주세요.\n\n"
        "1️⃣ 이메일 주소를 입력해주세요.\n"
        "예) example@gmail.com",
        parse_mode="Markdown"
    )
    return INF_EMAIL


async def inf_receive_email(update: Update, context: ContextTypes.DEFAULT_TYPE):
    email = update.message.text.strip()
    if "@" not in email or "." not in email:
        await update.message.reply_text("❌ 올바른 이메일 형식이 아닙니다. 다시 입력해주세요.\n예) example@gmail.com")
        return INF_EMAIL

    context.user_data["inf_email"] = email
    await update.message.reply_text(
        f"✅ 이메일: {email}\n\n"
        "2️⃣ 텔레그램 아이디를 입력해주세요. (@포함)\n"
        "예) @fireantico"
    )
    return INF_TG


async def inf_receive_tg(update: Update, context: ContextTypes.DEFAULT_TYPE):
    tg = update.message.text.strip()
    if not tg.startswith("@"):
        tg = "@" + tg
    context.user_data["inf_tg"] = tg
    await update.message.reply_text(
        f"✅ 텔레그램: {tg}\n\n"
        "3️⃣ 휴대전화 번호를 입력해주세요.\n"
        "예) 010-1234-5678"
    )
    return INF_PHONE


async def inf_receive_phone(update: Update, context: ContextTypes.DEFAULT_TYPE):
    phone = update.message.text.strip()
    context.user_data["inf_phone"] = phone
    await update.message.reply_text(
        f"✅ 휴대전화: {phone}\n\n"
        "4️⃣ 빗썸에 가입한 실명을 입력해주세요.\n"
        "예) 홍길동"
    )
    return INF_REALNAME


async def inf_receive_realname(update: Update, context: ContextTypes.DEFAULT_TYPE):
    real_name = update.message.text.strip()
    context.user_data["inf_real_name"] = real_name

    keyboard = InlineKeyboardMarkup([[
        InlineKeyboardButton("✅ 동의합니다", callback_data="inf_agree_yes"),
        InlineKeyboardButton("❌ 동의하지 않습니다", callback_data="inf_agree_no"),
    ]])
    await update.message.reply_text(
        f"✅ 빗썸 실명: {real_name}\n\n"
        "5️⃣ *개인정보 수집·이용 동의*\n\n"
        "수집 항목: 이메일, 텔레그램 아이디, 휴대전화 번호, 빗썸 실명\n"
        "수집 목적: 이벤트 리워드 지급\n"
        "보유 기간: 리워드 지급 완료 후 6개월\n\n"
        "위 내용에 동의하십니까?",
        parse_mode="Markdown",
        reply_markup=keyboard
    )
    return INF_AGREE


async def inf_agree_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    user_id = query.from_user.id

    if query.data == "inf_agree_no":
        await query.edit_message_text("❌ 개인정보 수집에 동의하지 않아 정보 입력이 취소되었습니다.")
        return ConversationHandler.END

    email     = context.user_data.get("inf_email", "")
    tg        = context.user_data.get("inf_tg", "")
    phone     = context.user_data.get("inf_phone", "")
    real_name = context.user_data.get("inf_real_name", "")

    inserted = False
    with get_db() as conn:
        # 이미 제출 여부 재확인 (동시 요청 방지)
        existing = conn.execute("SELECT user_id FROM user_info WHERE user_id=?", (user_id,)).fetchone()
        if not existing:
            conn.execute(
                "INSERT INTO user_info (user_id, email, telegram_id, phone, real_name, agreed) VALUES (?,?,?,?,?,1)",
                (user_id, email, tg, phone, real_name)
            )
            inserted = True
        # 포인트 및 순위 조회
        user_row = conn.execute("SELECT points FROM users WHERE user_id=?", (user_id,)).fetchone()
        points = user_row["points"] if user_row else 0
        rank_row = conn.execute(
            "SELECT COUNT(*)+1 as rank FROM users WHERE points > ?", (points,)
        ).fetchone()
        rank = rank_row["rank"] if rank_row else "-"

    # Google Sheets에 기록 (신규 제출 시에만) — 실패해도 메시지 전송은 반드시 진행
    if inserted:
        try:
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            append_to_sheet([now_str, str(user_id), tg, query.from_user.first_name or "", email, phone, real_name, points, rank])
        except Exception as e:
            logging.getLogger(__name__).error(f"Sheets 기록 예외: {e}")

    completion_text = (
        "🎉 *정보 제출 완료!*\n\n"
        f"📧 이메일: {email}\n"
        f"💬 텔레그램: {tg}\n"
        f"📱 휴대전화: {phone}\n"
        f"👤 빗썸 실명: {real_name}\n\n"
        "리워드는 순위 확정 후 순차적으로 지급됩니다.\n감사합니다! 🔥\n\n"
        "당신은 모든 정보를 잘 제출했습니다!\n\n"
        "💡 정보를 수정하고 싶다면 아래 버튼을 누르세요."
    )
    edit_keyboard = InlineKeyboardMarkup([[
        InlineKeyboardButton("✏️ 정보 수정하기", callback_data="inf_edit_request")
    ]])
    try:
        await query.edit_message_text(completion_text, parse_mode="Markdown", reply_markup=edit_keyboard)
    except Exception:
        # edit_message_text 실패 시 (메시지 없거나 타임아웃 등) send_message로 fallback
        await query.get_bot().send_message(
            chat_id=user_id,
            text=completion_text,
            parse_mode="Markdown",
            reply_markup=edit_keyboard
        )
    return ConversationHandler.END


async def inf_edit_request_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """수정 버튼 클릭 → 확인 절차"""
    query = update.callback_query
    await query.answer()

    keyboard = InlineKeyboardMarkup([[
        InlineKeyboardButton("✅ 삭제 후 재제출", callback_data="inf_edit_confirm"),
        InlineKeyboardButton("❌ 취소", callback_data="inf_edit_cancel"),
    ]])
    await query.edit_message_reply_markup(reply_markup=None)
    await query.message.reply_text(
        "⚠️ 기존 제출 정보를 삭제하고 다시 입력하시겠습니까?\n\n"
        "삭제 후에는 되돌릴 수 없습니다.",
        reply_markup=keyboard
    )


async def inf_edit_confirm_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """삭제 후 재제출 확인 — inform_conv의 entry_point로 등록"""
    query = update.callback_query
    await query.answer()
    user_id = query.from_user.id

    # DB에서 삭제
    with get_db() as conn:
        conn.execute("DELETE FROM user_info WHERE user_id=?", (user_id,))

    # Google Sheets에서도 삭제 (스레드로)
    threading.Thread(target=delete_from_sheet, args=(user_id,), daemon=True).start()

    await query.edit_message_text("🗑️ 기존 정보가 삭제되었습니다. 다시 입력을 시작합니다.")

    # 정보 입력 플로우 재시작
    context.user_data.clear()
    await context.bot.send_message(
        chat_id=user_id,
        text=(
            "📋 *상품 수령 정보 입력*\n\n"
            "리워드 지급을 위해 아래 정보를 순서대로 입력해주세요.\n\n"
            "1️⃣ 이메일 주소를 입력해주세요.\n"
            "예) example@gmail.com"
        ),
        parse_mode="Markdown"
    )
    return INF_EMAIL


async def inf_edit_cancel_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """수정 취소"""
    query = update.callback_query
    await query.answer()
    await query.edit_message_text("❌ 수정이 취소되었습니다.")


async def cmd_export_inform(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """관리자 전용: /export_inform — 정보 수집 결과 CSV 다운로드"""
    if update.effective_user.id != ADMIN_ID:
        return

    with get_db() as conn:
        rows = conn.execute("""
            SELECT u.username, u.first_name, i.telegram_id, i.email, i.phone, i.real_name, i.submitted_at,
                   u.points,
                   (SELECT COUNT(*) FROM users u2 WHERE u2.referrer_id = u.user_id) as invite_count
            FROM user_info i
            JOIN users u ON u.user_id = i.user_id
            WHERE i.agreed = 1
            ORDER BY u.points DESC
        """).fetchall()

    if not rows:
        await update.message.reply_text("제출된 정보가 없습니다.")
        return

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["순위", "텔레그램아이디", "이름", "포인트", "초대수", "이메일", "전화번호", "빗썸실명", "제출일시"])
    for i, r in enumerate(rows, 1):
        writer.writerow([i, r["telegram_id"] or r["username"], r["first_name"],
                         r["points"], r["invite_count"], r["email"], r["phone"],
                         r["real_name"] or "", r["submitted_at"]])

    await update.message.reply_document(
        document=buf.getvalue().encode("utf-8-sig"),
        filename="eigencloud_inform.csv",
        caption=f"📋 정보 제출 현황 — 총 {len(rows)}명"
    )


async def cmd_inform_count(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """관리자: 정보 제출 현황 간단 확인"""
    if update.effective_user.id != ADMIN_ID:
        return
    with get_db() as conn:
        total = conn.execute("SELECT COUNT(*) as c FROM users WHERE ever_registered=1").fetchone()["c"]
        submitted = conn.execute("SELECT COUNT(*) as c FROM user_info WHERE agreed=1").fetchone()["c"]
    await update.message.reply_text(f"📊 정보 제출 현황\n전체 등록자: {total}명\n제출 완료: {submitted}명\n미제출: {total - submitted}명")


async def cmd_points(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_chat.type != "private":
        return

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
    if update.effective_chat.type != "private":
        return

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


# ── 채널 멤버 이벤트 (신규 입장 / 퇴장) ────────────────────────────────────
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

    old_status = result.old_chat_member.status
    new_status = result.new_chat_member.status
    target_user = result.new_chat_member.user

    if target_user.is_bot:
        return

    # 신규 입장 (was: not member → now: member)
    if old_status in ("left", "kicked", "restricted") and new_status == "member":
        # 봇은 먼저 DM 불가 → 채널에 멘션 메시지로 안내 후 30초 뒤 자동 삭제
        try:
            mention = f'<a href="tg://user?id={target_user.id}">{target_user.first_name}</a>'
            bot_username = (await context.bot.get_me()).username
            sent = await context.bot.send_message(
                chat_id=result.chat.id,
                text=(
                    f"🎉 {mention}님 환영합니다!\n\n"
                    f"🔥 친구초대 이벤트 진행 중!\n"
                    f"포인트를 받으려면 아래 봇에서 /start 를 눌러주세요 👇\n"
                    f"@{bot_username}"
                ),
                parse_mode="HTML"
            )
            # 30초 후 자동 삭제
            async def delete_later(chat_id, msg_id):
                import asyncio
                await asyncio.sleep(5)
                try:
                    await context.bot.delete_message(chat_id=chat_id, message_id=msg_id)
                except Exception:
                    pass
            import asyncio
            asyncio.create_task(delete_later(result.chat.id, sent.message_id))
        except Exception as e:
            logger.warning("채널 환영 메시지 실패 (user_id=%s): %s", target_user.id, e)

    # 퇴장 / 강퇴 (was: member/admin → now: left/kicked)
    elif old_status in ("member", "administrator", "creator", "restricted") and new_status in ("left", "kicked"):
        user_id = target_user.id
        logger.info("채널 퇴장 감지 user_id=%s channel_id=%s", user_id, channel_id)

        with get_db() as conn:
            user_row = conn.execute(
                "SELECT points, referrer_id FROM users WHERE user_id=?", (user_id,)
            ).fetchone()

            if user_row:
                referrer_id = user_row["referrer_id"]

                # 해당 유저 포인트 0 초기화
                conn.execute("UPDATE users SET points=0 WHERE user_id=?", (user_id,))

                # 초대자에게 지급됐던 10포인트 회수
                if referrer_id:
                    conn.execute(
                        "UPDATE users SET points = MAX(0, points - 10) WHERE user_id=?",
                        (referrer_id,)
                    )
                    logger.info("초대자 포인트 회수 referrer_id=%s", referrer_id)

        # 퇴장 유저에게 DM
        try:
            await context.bot.send_message(
                chat_id=user_id,
                text="채널을 퇴장하여 포인트가 몰수되었습니다."
            )
        except Exception as e:
            logger.warning("퇴장 DM 발송 실패 (user_id=%s): %s", user_id, e)


# ── 메인 ─────────────────────────────────────────────────────────────────────
def main():
    init_db()
    with get_db() as conn:
        conn.execute("UPDATE event_period SET start_date='2026-03-21', end_date='2026-04-03' WHERE id=1")
    token = get_token()

    app = Application.builder().token(token).build()

    # ConversationHandler: /start → 초대자 입력 → 당첨자 정보 수집
    conv = ConversationHandler(
        entry_points=[CommandHandler("start", cmd_start)],
        states={
            WAITING_REFERRER: [
                CommandHandler("skip", cmd_skip),
                MessageHandler(filters.TEXT & ~filters.COMMAND, receive_referrer_id),
            ],
            INF_EMAIL: [MessageHandler(filters.TEXT & ~filters.COMMAND, inf_receive_email)],
            INF_TG:    [MessageHandler(filters.TEXT & ~filters.COMMAND, inf_receive_tg)],
            INF_PHONE: [MessageHandler(filters.TEXT & ~filters.COMMAND, inf_receive_phone)],
            INF_REALNAME: [MessageHandler(filters.TEXT & ~filters.COMMAND, inf_receive_realname)],
            INF_AGREE: [CallbackQueryHandler(inf_agree_callback, pattern="^inf_agree_")],
        },
        fallbacks=[CommandHandler("skip", cmd_skip)],
    )
    app.add_handler(conv)

    # /inform ConversationHandler (독립 - 기존 등록자 재진입용 + 수정 플로우)
    inform_conv = ConversationHandler(
        entry_points=[
            CommandHandler("inform", cmd_inform),
            CallbackQueryHandler(inf_edit_confirm_callback, pattern="^inf_edit_confirm$"),
        ],
        states={
            INF_EMAIL:    [MessageHandler(filters.TEXT & ~filters.COMMAND, inf_receive_email)],
            INF_TG:       [MessageHandler(filters.TEXT & ~filters.COMMAND, inf_receive_tg)],
            INF_PHONE:    [MessageHandler(filters.TEXT & ~filters.COMMAND, inf_receive_phone)],
            INF_REALNAME: [MessageHandler(filters.TEXT & ~filters.COMMAND, inf_receive_realname)],
            INF_AGREE:    [CallbackQueryHandler(inf_agree_callback, pattern="^inf_agree_")],
        },
        fallbacks=[CommandHandler("start", cmd_start)],
        per_message=False,
    )
    app.add_handler(inform_conv)

    # 유저 명령어
    app.add_handler(CommandHandler("points", cmd_points))
    app.add_handler(CommandHandler("setreferrer", cmd_setreferrer))
    app.add_handler(CommandHandler("rank", cmd_rank))

    # 관리자 명령어
    app.add_handler(CommandHandler("admin", cmd_admin))
    app.add_handler(CommandHandler("leaderboard", cmd_leaderboard))
    app.add_handler(CommandHandler("export", cmd_export))
    app.add_handler(CommandHandler("addchannel", cmd_addchannel))
    app.add_handler(CommandHandler("removechannel", cmd_removechannel))
    app.add_handler(CommandHandler("reset", cmd_reset))
    app.add_handler(CommandHandler("setperiod", cmd_setperiod))
    app.add_handler(CommandHandler("export_inform", cmd_export_inform))
    app.add_handler(CommandHandler("inform_count", cmd_inform_count))

    # 정보 수정 관련 콜백 (inform_conv entry_point보다 먼저 등록)
    app.add_handler(CallbackQueryHandler(inf_edit_request_callback, pattern="^inf_edit_request$"))
    app.add_handler(CallbackQueryHandler(inf_edit_cancel_callback, pattern="^inf_edit_cancel$"))

    # 콜백
    app.add_handler(CallbackQueryHandler(callback_handler))

    # 채널 멤버 변경 이벤트
    app.add_handler(ChatMemberHandler(chat_member_handler, ChatMemberHandler.CHAT_MEMBER))

    logger.info("🤖 Referral Bot 시작!")
    app.run_polling(allowed_updates=Update.ALL_TYPES, drop_pending_updates=True)


if __name__ == "__main__":
    main()
