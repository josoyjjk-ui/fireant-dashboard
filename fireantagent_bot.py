"""
불개미 캠페인 봇 (@fireantagent_bot)
기능 1: 채널 멤버 인증 (/start)
기능 2: AMA 당첨자 정보 수집 (/ama)
"""

import logging
import csv
import os
import subprocess
import urllib.request
import json as _json
from datetime import datetime
from telegram import Update, ReplyKeyboardRemove
from telegram.ext import (
    Application, CommandHandler, ContextTypes,
    ConversationHandler, MessageHandler, filters
)

# ── 설정 ─────────────────────────────────────────────────────────
BOT_TOKEN = subprocess.check_output(
    ['security', 'find-generic-password', '-a', 'fireantagent_bot',
     '-s', 'telegram-bot-token', '-w'],
    text=True
).strip()

CHANNEL_ID   = -1001201265014   # @fireantcrypto
SHEET_ID     = '1R7vwJKA1JtcUsktr7DPRQGr_28glZuXtP9swsDKAfuk'
WEBHOOK_URL  = 'https://script.google.com/macros/s/AKfycbxS89ovB-E8iXkqoKJ_643AJJoJu1flCSx7HLGKDSWhJZsW5_RhDNCSwStoF2fbCQ/exec'
CSV_PATH     = os.path.expanduser('~/.openclaw/workspace/verification_results.csv')
AMA_CSV_PATH = os.path.expanduser('~/.openclaw/workspace/ama_results.csv')
ADMIN_IDS    = [477743685]

logging.basicConfig(format='%(asctime)s [%(levelname)s] %(message)s', level=logging.INFO)
logger = logging.getLogger(__name__)

# AMA 대화 상태
AMA_PROJECT, AMA_YOUTUBE, AMA_TWITTER, AMA_PHONE, AMA_EVM, AMA_SOL = range(6)

# ── 웹훅 저장 ────────────────────────────────────────────────────
def post_webhook(payload: dict):
    try:
        data = _json.dumps(payload, ensure_ascii=False).encode('utf-8')
        req = urllib.request.Request(WEBHOOK_URL, data=data,
            headers={'Content-Type': 'application/json'}, method='POST')
        resp = urllib.request.urlopen(req, timeout=10)
        result = _json.loads(resp.read())
        if not result.get('ok'):
            logger.warning(f"Sheet 저장 실패: {result}")
    except Exception as e:
        logger.warning(f"Sheet 웹훅 오류: {e}")

# ── CSV 유틸 ─────────────────────────────────────────────────────
def ensure_csv():
    if not os.path.exists(CSV_PATH):
        with open(CSV_PATH, 'w', newline='', encoding='utf-8-sig') as f:
            csv.writer(f).writerow(['번호','텔레그램ID','@username','판정','등록일시','user_id'])

def ensure_ama_csv():
    if not os.path.exists(AMA_CSV_PATH):
        with open(AMA_CSV_PATH, 'w', newline='', encoding='utf-8-sig') as f:
            csv.writer(f).writerow(
                ['번호','프로젝트','텔레그램ID','@username','유튜브','트위터','전화번호','EVM지갑','SOL지갑','제출일시','user_id'])

def get_csv_next_num(path):
    try:
        with open(path, 'r', encoding='utf-8-sig') as f:
            return max(sum(1 for _ in csv.reader(f)) - 1, 1)
    except:
        return 1

def append_csv(path, row):
    with open(path, 'a', newline='', encoding='utf-8-sig') as f:
        csv.writer(f).writerow(row)

# ── 멤버 확인 ─────────────────────────────────────────────────────
async def check_member(context, user_id: int) -> bool:
    try:
        member = await context.bot.get_chat_member(CHANNEL_ID, user_id)
        return member.status in ('member', 'administrator', 'creator', 'restricted')
    except Exception as e:
        logger.info(f"멤버 확인 오류 (id={user_id}): {e}")
        return False

# ═══════════════════════════════════════════════════════════════
# 기능 1: 채널 멤버 인증 (/start)
# ═══════════════════════════════════════════════════════════════
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    uid  = user.id
    uname = user.username or ''
    display = f"@{uname}" if uname else f"id:{uid}"
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    is_member = await check_member(context, uid)
    verdict   = '적격' if is_member else '부적격'
    num       = get_csv_next_num(CSV_PATH)
    row       = [num, display, f"@{uname}" if uname else '', verdict, now, uid]

    append_csv(CSV_PATH, row)
    post_webhook({'type': 'verify',
                  'num': num, 'display': display,
                  'username': f"@{uname}" if uname else '',
                  'verdict': verdict, 'timestamp': now, 'user_id': uid})

    if is_member:
        await update.message.reply_text(
            f"✅ 참여 인증 완료!\n\n"
            f"불개미 채널 구독이 확인됐습니다.\n"
            f"등록 번호: {num}"
        )
    else:
        await update.message.reply_text(
            f"❌ 인증 실패\n\n"
            f"불개미 채널(@fireantcrypto)에 먼저 입장해주세요.\n"
            f"입장 후 다시 /start 를 눌러주세요."
        )
    logger.info(f"[{verdict}] {display} (id={uid})")

# ═══════════════════════════════════════════════════════════════
# 기능 2: AMA 당첨자 정보 수집 (/ama)
# ═══════════════════════════════════════════════════════════════
async def ama_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    context.user_data['ama'] = {
        'telegram_display': f"@{user.username}" if user.username else f"id:{user.id}",
        'telegram_username': f"@{user.username}" if user.username else '',
        'user_id': user.id,
    }
    await update.message.reply_text(
        "🎉 *AMA 당첨자 정보 제출*\n\n"
        "언제든 /cancel 로 중단할 수 있습니다.\n\n"
        "①/⑥  어떤 프로젝트의 AMA 당첨자이신가요?\n"
        "_(예: Monad, Kaito, Aptos)_",
        parse_mode='Markdown'
    )
    return AMA_PROJECT

async def ama_project(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['ama']['project'] = update.message.text.strip()
    await update.message.reply_text(
        "②/⑥  유튜브 채널 링크 또는 @아이디를 입력해주세요.\n"
        "없으시면 `없음` 입력",
        parse_mode='Markdown'
    )
    return AMA_YOUTUBE

async def ama_youtube(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['ama']['youtube'] = update.message.text.strip()
    await update.message.reply_text(
        "③/⑥  트위터(X) 닉네임을 입력해주세요. (@포함)\n"
        "없으시면 `없음` 입력",
        parse_mode='Markdown'
    )
    return AMA_TWITTER

async def ama_twitter(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['ama']['twitter'] = update.message.text.strip()
    await update.message.reply_text(
        "④/⑥  개인 휴대전화번호를 입력해주세요.\n"
        "_(예: 01012345678)_",
        parse_mode='Markdown'
    )
    return AMA_PHONE

async def ama_phone(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['ama']['phone'] = update.message.text.strip()
    await update.message.reply_text(
        "⑤/⑥  EVM 지갑주소를 입력해주세요. (0x…)\n"
        "없으시면 `없음` 입력",
        parse_mode='Markdown'
    )
    return AMA_EVM

async def ama_evm(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['ama']['evm'] = update.message.text.strip()
    await update.message.reply_text(
        "⑥/⑥  SOL 지갑주소를 입력해주세요.\n"
        "없으시면 `없음` 입력",
        parse_mode='Markdown'
    )
    return AMA_SOL

async def ama_sol(update: Update, context: ContextTypes.DEFAULT_TYPE):
    d = context.user_data['ama']
    d['sol']       = update.message.text.strip()
    d['timestamp'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    num = get_csv_next_num(AMA_CSV_PATH)
    row = [
        num, d['project'], d['telegram_display'], d['telegram_username'],
        d['youtube'], d['twitter'], d['phone'], d['evm'], d['sol'],
        d['timestamp'], d['user_id']
    ]
    append_csv(AMA_CSV_PATH, row)
    post_webhook({
        'type': 'ama',
        'num': num,
        'project': d['project'],
        'telegram_display': d['telegram_display'],
        'telegram_username': d['telegram_username'],
        'youtube': d['youtube'],
        'twitter': d['twitter'],
        'phone': d['phone'],
        'evm': d['evm'],
        'sol': d['sol'],
        'timestamp': d['timestamp'],
        'user_id': d['user_id'],
    })

    await update.message.reply_text(
        f"✅ *제출 완료!*\n\n"
        f"📌 프로젝트: {d['project']}\n"
        f"📱 텔레그램: {d['telegram_display']}\n"
        f"▶️  유튜브: {d['youtube']}\n"
        f"🐦 트위터: {d['twitter']}\n"
        f"📞 전화번호: {d['phone']}\n"
        f"💎 EVM: `{d['evm']}`\n"
        f"◎  SOL: `{d['sol']}`\n\n"
        f"당첨 보상은 검토 후 별도 안내 드립니다. 🎊",
        parse_mode='Markdown',
        reply_markup=ReplyKeyboardRemove()
    )
    logger.info(f"[AMA] {d['telegram_display']} → {d['project']} (id={d['user_id']})")
    context.user_data.pop('ama', None)
    return ConversationHandler.END

async def ama_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data.pop('ama', None)
    await update.message.reply_text(
        "❌ 제출이 취소되었습니다.\n다시 시작하려면 /ama 를 입력하세요.",
        reply_markup=ReplyKeyboardRemove()
    )
    return ConversationHandler.END

# ═══════════════════════════════════════════════════════════════
# 관리자 명령
# ═══════════════════════════════════════════════════════════════
async def count(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id not in ADMIN_IDS:
        return
    try:
        with open(CSV_PATH, 'r', encoding='utf-8-sig') as f:
            rows = list(csv.reader(f))
        total    = len(rows) - 1
        eligible = sum(1 for r in rows[1:] if len(r) > 3 and r[3] == '적격')

        ama_total = 0
        try:
            with open(AMA_CSV_PATH, 'r', encoding='utf-8-sig') as f:
                ama_total = sum(1 for _ in csv.reader(f)) - 1
        except:
            pass

        await update.message.reply_text(
            f"📊 *현황*\n\n"
            f"*[채널 인증]*\n"
            f"총 참여: {total}명\n"
            f"✅ 적격: {eligible}명\n"
            f"❌ 부적격: {total - eligible}명\n\n"
            f"*[AMA 당첨자 제출]*\n"
            f"총 제출: {ama_total}건",
            parse_mode='Markdown'
        )
    except Exception as e:
        await update.message.reply_text(f"오류: {e}")

# ═══════════════════════════════════════════════════════════════
# 실행
# ═══════════════════════════════════════════════════════════════
if __name__ == '__main__':
    ensure_csv()
    ensure_ama_csv()

    ama_conv = ConversationHandler(
        entry_points=[CommandHandler('ama', ama_start)],
        states={
            AMA_PROJECT: [MessageHandler(filters.TEXT & ~filters.COMMAND, ama_project)],
            AMA_YOUTUBE: [MessageHandler(filters.TEXT & ~filters.COMMAND, ama_youtube)],
            AMA_TWITTER: [MessageHandler(filters.TEXT & ~filters.COMMAND, ama_twitter)],
            AMA_PHONE:   [MessageHandler(filters.TEXT & ~filters.COMMAND, ama_phone)],
            AMA_EVM:     [MessageHandler(filters.TEXT & ~filters.COMMAND, ama_evm)],
            AMA_SOL:     [MessageHandler(filters.TEXT & ~filters.COMMAND, ama_sol)],
        },
        fallbacks=[CommandHandler('cancel', ama_cancel)],
    )

    app = Application.builder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler('start', start))
    app.add_handler(CommandHandler('count', count))
    app.add_handler(ama_conv)

    logger.info("봇 시작: @fireantagent_bot")
    app.run_polling()
