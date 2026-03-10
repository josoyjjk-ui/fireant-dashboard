#!/usr/bin/env python3
"""
기율봇 (@giyulbot) — 쿠포니봇 CS 오류 신고 텔레그램 봇
수집 항목: 텔레그램 아이디, 트위터 아이디, 휴대전화번호, 이메일, 오류 내용
데이터는 Google Sheets에 자동 저장
"""

import json
import csv
import os
import asyncio
import requests as http_requests
from datetime import datetime
from telegram import Update, ReplyKeyboardMarkup, ReplyKeyboardRemove
from telegram.ext import (
    ApplicationBuilder, CommandHandler, MessageHandler,
    ConversationHandler, filters, ContextTypes
)

BOT_TOKEN = "***REMOVED***"
ADMIN_ID = 477743685
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "giyulbot_data")
CSV_PATH = os.path.join(DATA_DIR, "reports.csv")
GOOGLE_TOKEN_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "secrets", "google-token.json")
GSHEET_ID = "1grh4SF4Ba8jDT44p5Kw0eg0HOJZpiO0dv7ztJCzpxBs"
GSHEET_RANGE = "신고내역!A:G"


def get_google_token():
    """Get fresh Google OAuth token."""
    try:
        with open(GOOGLE_TOKEN_PATH) as f:
            td = json.load(f)
        resp = http_requests.post("https://oauth2.googleapis.com/token", data={
            "client_id": td["client_id"],
            "client_secret": td["client_secret"],
            "refresh_token": td["refresh_token"],
            "grant_type": "refresh_token"
        }, timeout=10)
        return resp.json().get("access_token")
    except Exception as e:
        print(f"[GSheet] Token error: {e}")
        return None


def append_to_gsheet(row):
    """Append a row to Google Sheets."""
    try:
        token = get_google_token()
        if not token:
            return False
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        resp = http_requests.post(
            f"https://sheets.googleapis.com/v4/spreadsheets/{GSHEET_ID}/values/{GSHEET_RANGE}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
            headers=headers,
            json={"values": [row]},
            timeout=10
        )
        print(f"[GSheet] Append: {resp.status_code}")
        return resp.status_code == 200
    except Exception as e:
        print(f"[GSheet] Error: {e}")
        return False

# Conversation states
TG_ID, TWITTER_ID, PHONE, EMAIL, ERROR_DESC, CONFIRM = range(6)

os.makedirs(DATA_DIR, exist_ok=True)

# Initialize CSV if not exists
if not os.path.exists(CSV_PATH):
    with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["timestamp", "user_id", "telegram_id", "twitter_id", "phone", "email", "error_description"])


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "⚠️ 쿠포니봇 오류 신고 봇입니다.\n\n"
        "기프티콘 미지급 또는 오류 발생 시\n"
        "아래 절차에 따라 정보를 입력해 주세요.\n\n"
        "📋 수집 항목:\n"
        "1. 텔레그램 아이디\n"
        "2. 트위터 아이디\n"
        "3. 휴대전화번호\n"
        "4. 이메일 주소\n"
        "5. 오류 내용\n\n"
        "신고를 시작하려면 /report 를 입력해 주세요."
    )


async def report_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data.clear()
    await update.message.reply_text(
        "📝 오류 신고를 시작합니다.\n\n"
        "1️⃣ 텔레그램 아이디를 입력해 주세요. (@포함)\n"
        "예: @username"
    )
    return TG_ID


async def get_tg_id(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data["telegram_id"] = update.message.text.strip()
    await update.message.reply_text(
        "2️⃣ X(트위터) 아이디를 입력해 주세요. (@포함)\n"
        "예: @username"
    )
    return TWITTER_ID


async def get_twitter_id(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data["twitter_id"] = update.message.text.strip()
    await update.message.reply_text(
        "3️⃣ 휴대전화번호를 입력해 주세요.\n"
        "예: 01012345678"
    )
    return PHONE


async def get_phone(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data["phone"] = update.message.text.strip()
    await update.message.reply_text(
        "4️⃣ 이메일 주소를 입력해 주세요."
    )
    return EMAIL


async def get_email(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data["email"] = update.message.text.strip()
    await update.message.reply_text(
        "5️⃣ 어떤 오류가 발생했는지 자세히 적어주세요.\n"
        "(기프티콘 미수신, 링크 오류, 이미 사용된 쿠폰 등)"
    )
    return ERROR_DESC


async def get_error_desc(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data["error_desc"] = update.message.text.strip()
    d = context.user_data
    summary = (
        "📋 입력하신 내용을 확인해 주세요.\n\n"
        f"• 텔레그램: {d['telegram_id']}\n"
        f"• 트위터: {d['twitter_id']}\n"
        f"• 전화번호: {d['phone']}\n"
        f"• 이메일: {d['email']}\n"
        f"• 오류 내용: {d['error_desc']}\n\n"
        "제출하시겠습니까?"
    )
    keyboard = ReplyKeyboardMarkup(
        [["✅ 제출", "❌ 취소"]], one_time_keyboard=True, resize_keyboard=True
    )
    await update.message.reply_text(summary, reply_markup=keyboard)
    return CONFIRM


async def confirm(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.message.text == "✅ 제출":
        d = context.user_data
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        user_id = update.effective_user.id

        # Save to CSV
        row = [now, user_id, d["telegram_id"], d["twitter_id"],
               d["phone"], d["email"], d["error_desc"]]
        with open(CSV_PATH, "a", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(row)

        # Save to Google Sheets
        append_to_gsheet([str(x) for x in row])

        # Notify admin
        admin_msg = (
            f"🚨 새 오류 신고 접수\n\n"
            f"⏰ {now}\n"
            f"👤 유저ID: {user_id}\n"
            f"📱 텔레그램: {d['telegram_id']}\n"
            f"🐦 트위터: {d['twitter_id']}\n"
            f"📞 전화: {d['phone']}\n"
            f"📧 이메일: {d['email']}\n"
            f"❗ 오류: {d['error_desc']}"
        )
        try:
            await context.bot.send_message(chat_id=ADMIN_ID, text=admin_msg)
        except Exception:
            pass

        await update.message.reply_text(
            "✅ 신고가 접수되었습니다.\n"
            "확인 후 기프티콘을 재지급해 드리겠습니다.\n"
            "감사합니다! 🙏",
            reply_markup=ReplyKeyboardRemove()
        )
    else:
        await update.message.reply_text(
            "❌ 신고가 취소되었습니다.\n"
            "다시 신고하려면 /report 를 입력해 주세요.",
            reply_markup=ReplyKeyboardRemove()
        )

    context.user_data.clear()
    return ConversationHandler.END


async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data.clear()
    await update.message.reply_text(
        "❌ 신고가 취소되었습니다.",
        reply_markup=ReplyKeyboardRemove()
    )
    return ConversationHandler.END


async def admin_count(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != ADMIN_ID:
        return
    if not os.path.exists(CSV_PATH):
        await update.message.reply_text("접수된 신고가 없습니다.")
        return
    with open(CSV_PATH, "r", encoding="utf-8") as f:
        reader = csv.reader(f)
        next(reader)  # skip header
        rows = list(reader)
    await update.message.reply_text(f"📊 총 접수 건수: {len(rows)}건")


async def admin_list(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != ADMIN_ID:
        return
    if not os.path.exists(CSV_PATH):
        await update.message.reply_text("접수된 신고가 없습니다.")
        return
    with open(CSV_PATH, "r", encoding="utf-8") as f:
        reader = csv.reader(f)
        next(reader)
        rows = list(reader)
    if not rows:
        await update.message.reply_text("접수된 신고가 없습니다.")
        return
    # Show last 10
    recent = rows[-10:]
    msg = "📋 최근 신고 내역 (최대 10건)\n\n"
    for r in recent:
        msg += f"⏰ {r[0]}\n📱 {r[2]} | 🐦 {r[3]}\n📞 {r[4]} | 📧 {r[5]}\n❗ {r[6]}\n{'─'*30}\n"
    await update.message.reply_text(msg)


def main():
    app = ApplicationBuilder().token(BOT_TOKEN).build()

    conv_handler = ConversationHandler(
        entry_points=[CommandHandler("report", report_start)],
        states={
            TG_ID: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_tg_id)],
            TWITTER_ID: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_twitter_id)],
            PHONE: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_phone)],
            EMAIL: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_email)],
            ERROR_DESC: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_error_desc)],
            CONFIRM: [MessageHandler(filters.TEXT & ~filters.COMMAND, confirm)],
        },
        fallbacks=[CommandHandler("cancel", cancel)],
    )

    app.add_handler(CommandHandler("start", start))
    app.add_handler(conv_handler)
    app.add_handler(CommandHandler("count", admin_count))
    app.add_handler(CommandHandler("list", admin_list))

    print("🤖 기율봇 시작됨...")
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
