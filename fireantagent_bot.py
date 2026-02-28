"""
불개미 커뮤니티 캠페인 당첨자 검증 봇 (@fireantagent_bot)
- /start → 봇 소개 → 목적 선택 → 단계별 정보 수집 (인라인 버튼 UX)
"""

import logging, csv, os, subprocess, urllib.request, json as _json
from datetime import datetime
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application, CommandHandler, ContextTypes,
    ConversationHandler, MessageHandler, CallbackQueryHandler, filters
)

# ── 설정 ─────────────────────────────────────────────────────────
BOT_TOKEN = subprocess.check_output(
    ['security', 'find-generic-password', '-a', 'fireantagent_bot',
     '-s', 'telegram-bot-token', '-w'], text=True).strip()

CHANNEL_ID  = -1001201265014
SHEET_ID    = '1R7vwJKA1JtcUsktr7DPRQGr_28glZuXtP9swsDKAfuk'
WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbxS89ovB-E8iXkqoKJ_643AJJoJu1flCSx7HLGKDSWhJZsW5_RhDNCSwStoF2fbCQ/exec'
CSV_PATH    = os.path.expanduser('~/.openclaw/workspace/ama_results.csv')
ADMIN_IDS   = [477743685]

logging.basicConfig(format='%(asctime)s [%(levelname)s] %(message)s', level=logging.INFO)
logger = logging.getLogger(__name__)

# ── 대화 상태 ─────────────────────────────────────────────────────
(MENU,
 AMA_CAMPAIGN, AMA_TELEGRAM, AMA_TWITTER,
 AMA_YOUTUBE, AMA_PHONE, AMA_EVM, AMA_SOL) = range(8)

# ── 공통 유틸 ─────────────────────────────────────────────────────
def kb(*rows):
    """InlineKeyboardMarkup 빌더"""
    return InlineKeyboardMarkup([[InlineKeyboardButton(t, callback_data=d) for t, d in row] for row in rows])

def skip_kb(label="없음"):
    return kb([(f"⏭️  {label}", "SKIP"), ("❌ 취소", "CANCEL")])

def post_webhook(payload: dict):
    try:
        data = _json.dumps(payload, ensure_ascii=False).encode()
        req = urllib.request.Request(WEBHOOK_URL, data=data,
            headers={'Content-Type': 'application/json'}, method='POST')
        return _json.loads(urllib.request.urlopen(req, timeout=10).read())
    except Exception as e:
        logger.warning(f"Webhook 오류: {e}")
        return {'ok': False}

def ensure_csv():
    if not os.path.exists(CSV_PATH):
        with open(CSV_PATH, 'w', newline='', encoding='utf-8-sig') as f:
            csv.writer(f).writerow(
                ['번호','프로젝트','텔레그램ID','@username','트위터','유튜브','전화번호','EVM지갑','SOL지갑','제출일시','user_id'])

def get_next_num():
    try:
        with open(CSV_PATH, 'r', encoding='utf-8-sig') as f:
            return max(sum(1 for _ in csv.reader(f)) - 1, 1)
    except:
        return 1

def append_csv(row):
    with open(CSV_PATH, 'a', newline='', encoding='utf-8-sig') as f:
        csv.writer(f).writerow(row)

# ── 시작: /start ──────────────────────────────────────────────────
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data.clear()
    await update.message.reply_text(
        "안녕하세요! 👋\n\n"
        "저는 *불개미 커뮤니티 캠페인 당첨자 검증 봇*입니다.\n\n"
        "⚠️ 당첨자가 아닌 분이 작성하면 제출은 가능하나 보상은 지급되지 않습니다.\n\n"
        "아래를 눌러 정보 제출을 시작해주세요 👇",
        parse_mode='Markdown',
        reply_markup=kb([("🎉  정보 제출 시작하기", "START_AMA")])
    )
    return MENU

# ── MENU 선택 ─────────────────────────────────────────────────────
async def menu_ama(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    user = q.from_user
    context.user_data['ama'] = {
        'auto_username': f"@{user.username}" if user.username else '',
        'telegram_display': f"@{user.username}" if user.username else f"id:{user.id}",
        'user_id': user.id,
    }
    await q.edit_message_text(
        "✅ 캠페인 당첨자 정보 수집을 시작합니다!\n\n"
        "🎯 *어떤 캠페인에 당첨되셨나요?*\n"
        "_예: Monad AMA, Kaito AMA, Aptos AMA_\n\n"
        "캠페인 이름을 입력해주세요:",
        parse_mode='Markdown'
    )
    return AMA_CAMPAIGN

# ── 1단계: 캠페인 이름 ────────────────────────────────────────────
async def step_campaign(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['ama']['project'] = update.message.text.strip()
    uname = context.user_data['ama']['auto_username']

    rows = []
    if uname:
        rows.append([(f"✅  내 ID 사용  ({uname})", "USE_MY_ID")])
    rows.append([("✏️  직접 입력", "TYPE_ID"), ("❌ 취소", "CANCEL")])

    await update.message.reply_text(
        "📱 *텔레그램 ID를 알려주세요*\n\n"
        "아래 버튼으로 자동 입력하거나 직접 @username을 입력해주세요.",
        parse_mode='Markdown',
        reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton(t, callback_data=d) for t, d in row] for row in rows])
    )
    return AMA_TELEGRAM

# ── 2단계: 텔레그램 ID ────────────────────────────────────────────
async def step_telegram_auto(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """내 ID 자동 사용 버튼"""
    q = update.callback_query
    await q.answer("✅ 내 ID가 자동 입력되었습니다.")
    uname = context.user_data['ama']['auto_username']
    context.user_data['ama']['telegram_id'] = uname
    await q.edit_message_text(f"📱 텔레그램 ID: *{uname}* ✅", parse_mode='Markdown')
    await _ask_twitter(q.message)
    return AMA_TWITTER

async def step_telegram_type_btn(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """직접 입력 버튼 클릭"""
    q = update.callback_query
    await q.answer()
    await q.edit_message_text("📱 텔레그램 @username을 직접 입력해주세요:")
    return AMA_TELEGRAM

async def step_telegram_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """직접 텍스트 입력"""
    context.user_data['ama']['telegram_id'] = update.message.text.strip()
    await _ask_twitter(update.message)
    return AMA_TWITTER

async def _ask_twitter(msg):
    await msg.reply_text(
        "🐦 *트위터(X) 닉네임을 알려주세요*\n_@포함 입력  예: @fireant_",
        parse_mode='Markdown',
        reply_markup=skip_kb("없음")
    )

# ── 3단계: 트위터 ─────────────────────────────────────────────────
async def step_twitter_skip(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    context.user_data['ama']['twitter'] = '없음'
    await q.edit_message_text("🐦 트위터: *없음* ✅", parse_mode='Markdown')
    await _ask_youtube(q.message)
    return AMA_YOUTUBE

async def step_twitter_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['ama']['twitter'] = update.message.text.strip()
    await _ask_youtube(update.message)
    return AMA_YOUTUBE

async def _ask_youtube(msg):
    await msg.reply_text(
        "▶️ *유튜브 닉네임을 알려주세요*\n_채널 링크 또는 @아이디_",
        parse_mode='Markdown',
        reply_markup=skip_kb("없음")
    )

# ── 4단계: 유튜브 ─────────────────────────────────────────────────
async def step_youtube_skip(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    context.user_data['ama']['youtube'] = '없음'
    await q.edit_message_text("▶️ 유튜브: *없음* ✅", parse_mode='Markdown')
    await _ask_phone(q.message)
    return AMA_PHONE

async def step_youtube_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['ama']['youtube'] = update.message.text.strip()
    await _ask_phone(update.message)
    return AMA_PHONE

async def _ask_phone(msg):
    await msg.reply_text(
        "📞 *휴대전화번호를 알려주세요*\n_예: 01012345678_",
        parse_mode='Markdown',
        reply_markup=skip_kb("건너뛰기")
    )

# ── 5단계: 전화번호 ───────────────────────────────────────────────
async def step_phone_skip(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    context.user_data['ama']['phone'] = '없음'
    await q.edit_message_text("📞 전화번호: *없음* ✅", parse_mode='Markdown')
    await _ask_evm(q.message)
    return AMA_EVM

async def step_phone_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['ama']['phone'] = update.message.text.strip()
    await _ask_evm(update.message)
    return AMA_EVM

async def _ask_evm(msg):
    await msg.reply_text(
        "💎 *EVM 지갑주소를 입력해주세요*\n_0x로 시작하는 주소_",
        parse_mode='Markdown',
        reply_markup=skip_kb("없음")
    )

# ── 6단계: EVM 지갑 ───────────────────────────────────────────────
async def step_evm_skip(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    context.user_data['ama']['evm'] = '없음'
    await q.edit_message_text("💎 EVM 지갑: *없음* ✅", parse_mode='Markdown')
    await _ask_sol(q.message)
    return AMA_SOL

async def step_evm_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['ama']['evm'] = update.message.text.strip()
    await _ask_sol(update.message)
    return AMA_SOL

async def _ask_sol(msg):
    await msg.reply_text(
        "◎ *솔라나(SOL) 지갑주소를 입력해주세요*",
        parse_mode='Markdown',
        reply_markup=skip_kb("없음")
    )

# ── 7단계: SOL 지갑 → 완료 ───────────────────────────────────────
async def step_sol_skip(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    context.user_data['ama']['sol'] = '없음'
    await q.edit_message_text("◎ SOL 지갑: *없음* ✅", parse_mode='Markdown')
    await _finish(context, q.message)
    return ConversationHandler.END

async def step_sol_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['ama']['sol'] = update.message.text.strip()
    await _finish(context, update.message)
    return ConversationHandler.END

async def _finish(context: ContextTypes.DEFAULT_TYPE, reply_msg):
    d   = context.user_data['ama']
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    num = get_next_num()

    row = [
        num,
        d.get('project',''),
        d.get('telegram_display',''),
        d.get('telegram_id',''),
        d.get('twitter',''),
        d.get('youtube',''),
        d.get('phone',''),
        d.get('evm',''),
        d.get('sol',''),
        now,
        d.get('user_id',''),
    ]
    append_csv(row)
    post_webhook({
        'type': 'ama', 'num': num,
        'project':          d.get('project',''),
        'telegram_display': d.get('telegram_display',''),
        'telegram_username':d.get('telegram_id',''),
        'twitter':          d.get('twitter',''),
        'youtube':          d.get('youtube',''),
        'phone':            d.get('phone',''),
        'evm':              d.get('evm',''),
        'sol':              d.get('sol',''),
        'timestamp': now,
        'user_id':   d.get('user_id',''),
    })

    tg  = d.get('telegram_id','') or d.get('telegram_display','')
    evm = d.get('evm','없음')
    sol = d.get('sol','없음')

    await reply_msg.reply_text(
        "━━━━━━━━━━━━━━━━━━━━\n"
        "✅ *제출이 완료되었습니다!*\n"
        "━━━━━━━━━━━━━━━━━━━━\n\n"
        f"📌 캠페인:  {d.get('project','')}\n"
        f"📱 텔레그램: {tg}\n"
        f"🐦 트위터:  {d.get('twitter','없음')}\n"
        f"▶️  유튜브:  {d.get('youtube','없음')}\n"
        f"📞 전화번호: {d.get('phone','없음')}\n"
        f"💎 EVM:    `{evm}`\n"
        f"◎  SOL:    `{sol}`\n\n"
        "당첨 보상은 검토 후 별도 안내 드립니다. 🎊\n"
        "━━━━━━━━━━━━━━━━━━━━",
        parse_mode='Markdown'
    )
    logger.info(f"[AMA완료] {tg} → {d.get('project','')} (id={d.get('user_id','')})")
    context.user_data.clear()

# ── 취소 ─────────────────────────────────────────────────────────
async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data.clear()
    text = "❌ 취소되었습니다.\n다시 시작하려면 /start 를 눌러주세요."
    if update.callback_query:
        await update.callback_query.answer()
        await update.callback_query.edit_message_text(text)
    else:
        await update.message.reply_text(text)
    return ConversationHandler.END

# ── 관리자: /count ────────────────────────────────────────────────
async def count(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id not in ADMIN_IDS:
        return
    try:
        with open(CSV_PATH, 'r', encoding='utf-8-sig') as f:
            rows = list(csv.reader(f))
        total = len(rows) - 1
        projects = {}
        for r in rows[1:]:
            p = r[1] if len(r) > 1 else '?'
            projects[p] = projects.get(p, 0) + 1
        breakdown = '\n'.join(f"  • {k}: {v}건" for k, v in projects.items()) or '  없음'
        await update.message.reply_text(
            f"📊 *AMA 제출 현황*\n\n"
            f"총 제출: *{total}건*\n\n"
            f"캠페인별:\n{breakdown}",
            parse_mode='Markdown'
        )
    except Exception as e:
        await update.message.reply_text(f"오류: {e}")

# ── 실행 ─────────────────────────────────────────────────────────
if __name__ == '__main__':
    ensure_csv()

    conv = ConversationHandler(
        entry_points=[
            CommandHandler('start', start),
            MessageHandler(filters.ALL & ~filters.COMMAND, start),
        ],
        states={
            MENU: [
                CallbackQueryHandler(menu_ama,    pattern='^START_AMA$'),
                CallbackQueryHandler(cancel,      pattern='^CANCEL$'),
            ],
            AMA_CAMPAIGN: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, step_campaign),
            ],
            AMA_TELEGRAM: [
                CallbackQueryHandler(step_telegram_auto,     pattern='^USE_MY_ID$'),
                CallbackQueryHandler(step_telegram_type_btn, pattern='^TYPE_ID$'),
                CallbackQueryHandler(cancel,                 pattern='^CANCEL$'),
                MessageHandler(filters.TEXT & ~filters.COMMAND, step_telegram_text),
            ],
            AMA_TWITTER: [
                CallbackQueryHandler(step_twitter_skip, pattern='^SKIP$'),
                CallbackQueryHandler(cancel,            pattern='^CANCEL$'),
                MessageHandler(filters.TEXT & ~filters.COMMAND, step_twitter_text),
            ],
            AMA_YOUTUBE: [
                CallbackQueryHandler(step_youtube_skip, pattern='^SKIP$'),
                CallbackQueryHandler(cancel,            pattern='^CANCEL$'),
                MessageHandler(filters.TEXT & ~filters.COMMAND, step_youtube_text),
            ],
            AMA_PHONE: [
                CallbackQueryHandler(step_phone_skip, pattern='^SKIP$'),
                CallbackQueryHandler(cancel,          pattern='^CANCEL$'),
                MessageHandler(filters.TEXT & ~filters.COMMAND, step_phone_text),
            ],
            AMA_EVM: [
                CallbackQueryHandler(step_evm_skip, pattern='^SKIP$'),
                CallbackQueryHandler(cancel,        pattern='^CANCEL$'),
                MessageHandler(filters.TEXT & ~filters.COMMAND, step_evm_text),
            ],
            AMA_SOL: [
                CallbackQueryHandler(step_sol_skip, pattern='^SKIP$'),
                CallbackQueryHandler(cancel,        pattern='^CANCEL$'),
                MessageHandler(filters.TEXT & ~filters.COMMAND, step_sol_text),
            ],
        },
        fallbacks=[
            CommandHandler('cancel', cancel),
            CommandHandler('start',  start),
        ],
        allow_reentry=True,
    )

    app = Application.builder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler('count', count))
    app.add_handler(conv)

    logger.info("봇 시작: @fireantagent_bot")
    app.run_polling()
