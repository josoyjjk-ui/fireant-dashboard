"""
불개미 캠페인 참여인증 봇 (@fireantagent_bot)
- AI 호출 없음, 순수 Python
- 유저가 /start → user_id 수집 → @fireantcrypto 멤버 여부 판정
- 결과 Google Sheet + 로컬 CSV 동시 저장
"""

import logging
import csv
import os
import subprocess
from datetime import datetime
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes
import gspread
from google.oauth2.service_account import Credentials

# ── 설정 ──────────────────────────────────────────────────────────
BOT_TOKEN = subprocess.check_output(
    ['security', 'find-generic-password', '-a', 'fireantagent_bot',
     '-s', 'telegram-bot-token', '-w'],
    text=True
).strip()

CHANNEL_ID = -1001201265014  # @fireantcrypto

SHEET_ID = os.environ.get('FIREANT_SHEET_ID', '')  # 실행 전 환경변수로 주입
CSV_PATH = os.path.expanduser('~/.openclaw/workspace/verification_results.csv')

SERVICE_ACCOUNT_PATH = os.path.expanduser(
    '~/.openclaw/workspace/secrets/google_service_account.json'
)

logging.basicConfig(
    format='%(asctime)s [%(levelname)s] %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# ── Google Sheet 초기화 ───────────────────────────────────────────
def get_sheet():
    if not os.path.exists(SERVICE_ACCOUNT_PATH) or not SHEET_ID:
        return None
    try:
        creds = Credentials.from_service_account_file(
            SERVICE_ACCOUNT_PATH,
            scopes=['https://www.googleapis.com/auth/spreadsheets']
        )
        gc = gspread.authorize(creds)
        sh = gc.open_by_key(SHEET_ID)
        ws = sh.sheet1
        if ws.row_count == 0 or ws.cell(1, 1).value != '번호':
            ws.update('A1:F1', [['번호', '텔레그램ID', '@username', '판정', '등록일시', 'user_id']])
        return ws
    except Exception as e:
        logger.warning(f"Sheet 연결 실패: {e}")
        return None

# ── CSV 초기화 ───────────────────────────────────────────────────
def ensure_csv():
    if not os.path.exists(CSV_PATH):
        with open(CSV_PATH, 'w', newline='', encoding='utf-8-sig') as f:
            csv.writer(f).writerow(['번호', '텔레그램ID', '@username', '판정', '등록일시', 'user_id'])

def get_next_row_num():
    try:
        with open(CSV_PATH, 'r', encoding='utf-8-sig') as f:
            return sum(1 for _ in csv.reader(f))  # 헤더 포함 행 수 = 다음 번호
    except:
        return 2

def save_to_csv(row):
    with open(CSV_PATH, 'a', newline='', encoding='utf-8-sig') as f:
        csv.writer(f).writerow(row)

# ── 멤버 여부 확인 ────────────────────────────────────────────────
async def check_member(context, user_id: int) -> bool:
    try:
        member = await context.bot.get_chat_member(CHANNEL_ID, user_id)
        return member.status in ('member', 'administrator', 'creator', 'restricted')
    except Exception as e:
        logger.info(f"멤버 확인 오류 (user_id={user_id}): {e}")
        return False

# ── /start 핸들러 ─────────────────────────────────────────────────
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    user_id = user.id
    username = user.username or ''
    display = f"@{username}" if username else f"id:{user_id}"
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    is_member = await check_member(context, user_id)
    verdict = '적격' if is_member else '부적격'

    row_num = get_next_row_num()
    row = [row_num - 1, display, f"@{username}" if username else '', verdict, now, user_id]

    # CSV 저장
    save_to_csv(row)

    # Sheet 저장 (가능하면)
    sheet = get_sheet()
    if sheet:
        try:
            sheet.append_row(row)
        except Exception as e:
            logger.warning(f"Sheet 저장 실패: {e}")

    # 유저 응답
    if is_member:
        msg = (
            f"✅ 참여 인증 완료!\n\n"
            f"불개미 채널 구독이 확인됐습니다.\n"
            f"등록 번호: {row_num - 1}"
        )
    else:
        msg = (
            f"❌ 인증 실패\n\n"
            f"불개미 채널(@fireantcrypto)에 먼저 입장해주세요.\n"
            f"입장 후 다시 /start 를 눌러주세요."
        )

    await update.message.reply_text(msg)
    logger.info(f"[{verdict}] {display} (id={user_id})")

# ── /count 핸들러 (관리자 전용) ───────────────────────────────────
ADMIN_IDS = [477743685]  # 불개미 해병님

async def count(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id not in ADMIN_IDS:
        return
    try:
        with open(CSV_PATH, 'r', encoding='utf-8-sig') as f:
            rows = list(csv.reader(f))
        total = len(rows) - 1
        eligible = sum(1 for r in rows[1:] if len(r) > 3 and r[3] == '적격')
        ineligible = total - eligible
        await update.message.reply_text(
            f"📊 현황\n"
            f"총 참여: {total}명\n"
            f"✅ 적격: {eligible}명\n"
            f"❌ 부적격: {ineligible}명"
        )
    except Exception as e:
        await update.message.reply_text(f"오류: {e}")

# ── 실행 ─────────────────────────────────────────────────────────
if __name__ == '__main__':
    ensure_csv()
    app = Application.builder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler('start', start))
    app.add_handler(CommandHandler('count', count))
    logger.info("봇 시작: @fireantagent_bot")
    app.run_polling()
