#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["google-genai>=1.0.0", "pillow>=10.0.0"]
# ///
"""
불개미 일일시황 이미지 생성기 v7
- 모델: gemini-2.5-flash-image (고정)
- 레퍼런스 이미지 기반 AI 재현 + 데이터 치환
"""
import sys, os
from datetime import datetime
from google import genai
from google.genai import types

# ── 인자 파싱 ──────────────────────────────────────────────
args = sys.argv[1:]
def A(key, default="—"):
    try: return args[args.index(key)+1]
    except: return default

btc_etf    = A("BTC_ETF",      "+$199.37M")
eth_etf    = A("ETH_ETF",      "+$138.25M")
btc_oi_24h = A("BTC_OI_24H",   "+1.34%")
eth_oi_24h = A("ETH_OI_24H",   "-2.12%")
dat_now    = A("DAT_NOW",      "$1.57B (22,341 BTC)")
dat_week   = A("DAT_WEEK_AGO", "$1.28B (17,990 BTC)")
cb_premium = A("CB_PREMIUM",   "+0.023%")
date_str   = A("DATE",         datetime.now().strftime("%Y.%m.%d (KST)"))

OUTPUT  = "/Users/fireant/.openclaw/workspace/daily-report-latest.png"
REF_IMG = "/Users/fireant/.openclaw/workspace/assets/daily-chalk-reference.jpg"
MODEL   = "gemini-2.5-flash-image"  # 고정 모델

btc_dir = "순유입" if "+" in btc_etf else "순유출"
eth_dir = "순유입" if "+" in eth_etf else "순유출"

prompt = f"""이 이미지를 완전히 동일한 스타일과 레이아웃으로 재현하되, 아래 데이터로 수치만 교체해서 새로 생성해라.

=== 교체할 데이터 ===

[좌상단 박스: BTC·ETH ETF 유출입]
- BTC ({btc_etf}) — {btc_dir}
- ETH ({eth_etf}) — {eth_dir}
- ETF 데이터는 마지막 거래일 기준 (작은 글씨 유지)

[우상단 타이틀]
불개미 일일시황
날짜: {date_str}

[우중단 박스: 미결제약정 추이]
BTC 24시간 : {btc_oi_24h}
ETH 24시간 : {eth_oi_24h}

[좌하단 박스: DAT 추이]
현재      : {dat_now}
1주일 전  : {dat_week}

[우하단 박스: 코인베이스 프리미엄]
현재 지수: {cb_premium}

=== 스타일 규칙 (절대 변경 금지) ===
- 나무 액자 프레임 (갈색 나무결, 두껍게)
- 어두운 칠판 배경 (dark chalkboard green/black)
- 분필 폰트 (chalk font, handwritten feel)
- 좌상단 빨간 불개미 캐릭터 반드시 포함
- 섹션 박스: 흰색 분필선 직사각형
- 색상: 양수=초록, 음수=빨강, BTC·ETH 헤더=노란색, 일반텍스트=흰색
- 16:9 와이드 비율
- 한국어 텍스트 정확히 표기"""

# ── API 호출 ───────────────────────────────────────────────
client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

# 레퍼런스 이미지 로드
with open(REF_IMG, "rb") as f:
    img_bytes = f.read()

# 확장자로 MIME 타입 결정
ext = REF_IMG.rsplit(".", 1)[-1].lower()
mime = "image/jpeg" if ext in ("jpg", "jpeg") else "image/png"

response = client.models.generate_content(
    model=MODEL,
    contents=[
        types.Part.from_bytes(data=img_bytes, mime_type=mime),
        prompt
    ]
)

# 이미지 저장
saved = False
for part in response.candidates[0].content.parts:
    if part.inline_data:
        with open(OUTPUT, "wb") as f:
            f.write(part.inline_data.data)
        print(f"✅ 저장: {OUTPUT}  (model={MODEL})")
        saved = True
        break

if not saved:
    txt = response.text[:300] if hasattr(response, "text") and response.text else "없음"
    print(f"❌ 이미지 생성 실패 — 텍스트 응답: {txt}")
    sys.exit(1)
