#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["google-genai>=1.0.0", "pillow>=10.0.0", "requests>=2.28.0"]
# ///
"""
불개미 일일시황 이미지 생성기 v7
- 모델: gemini-2.5-flash-image (고정)
- 레퍼런스 이미지 기반 AI 재현 + 데이터 치환
"""
import sys, os, subprocess
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

OUTPUT   = "/Users/fireant/.openclaw/workspace/daily-report-latest.png"
REF_IMG  = "/Users/fireant/.openclaw/workspace/assets/daily-chalk-reference.jpg"
LOGO_IMG = "/Users/fireant/.openclaw/workspace/assets/fireant-logo-nobg2.png"  # 로컬 로고 고정 (웹 다운로드 금지)
# 이미지 생성 모델 우선순위
MODEL_CHAIN = [
    "grok-imagine-image-pro",         # 1순위: xAI Grok (글자 표현 우수)
    "gemini-3.1-flash-image-preview", # 2순위
    "gemini-3-pro-image-preview",     # 3순위
]

btc_dir = "순유입" if "+" in btc_etf else "순유출"
eth_dir = "순유입" if "+" in eth_etf else "순유출"

prompt = f"""=== 숫자 정확도 최우선 규칙 ===
아래 숫자들을 한 글자도 빠짐없이 정확하게 표기해야 한다. 숫자가 잘리거나 누락되면 실패다.
- "BTC (-$90.19M)" — 반드시 이 글자 그대로. "$90" 절대 누락 금지.
- "ETH (-$131.16M)" — 반드시 이 글자 그대로. "$131" 절대 누락 금지.
- "$1.57B (22,341 BTC)" — 반드시 이 글자 그대로.
- "-0.015%" — 반드시 이 글자 그대로.
- "+0.20%" — 반드시 이 글자 그대로.
- "-0.86%" — 반드시 이 글자 그대로.
숫자 사이에 공백 삽입 금지. "$ 90" "- 0.015" 등 공백 분리 절대 금지.

어두운 칠판 배경(dark chalkboard green/black)에 분필 스타일로 그려진 암호화폐 일일시황 이미지를 생성해라.

=== 필수 레이아웃: 정확히 2행 2열 그리드 ===
전체 이미지를 다음과 같이 배치해라:
- 상단 헤더 바(전체 너비): "불개미 일일시황" 제목 + {date_str} 날짜
- 하단 영역: 정확히 2×2 그리드 (4개 박스, 완전 동일 크기, 동일 여백)
  - [좌상] BTC ETH ETF 유출입 박스
  - [우상] 미결제약정 추이 박스
  - [좌하] DAT 추이 박스
  - [우하] 코인베이스 프리미엄 박스

=== 대칭 규칙 (절대 준수) ===
- 4개 박스 크기 완전 동일 (픽셀 단위로 동일한 너비, 동일한 높이)
- 4개 박스 간격 완전 동일 (상하좌우 여백 모두 동일)
- 좌측 2개 박스와 우측 2개 박스 너비 동일
- 상단 2개 박스와 하단 2개 박스 높이 동일
- 박스 내부 텍스트 정렬 통일 (제목은 좌측 정렬 또는 중앙 정렬 통일)

=== 각 박스 내용 ===

[상단 헤더 - 박스 없이 칠판 배경에 직접 표기]
큰 제목: 불개미 일일시황 (노란색, 분필 대형 글씨)
날짜: {date_str} (흰색, 중간 크기)

[좌상단 박스 - BTC ETH ETF 유출입]
제목: BTC ETH ETF 유출입 (노란색)
부제: ETF 데이터는 마지막 거래일 기준 (흰색, 작은 글씨)
BTC ({btc_etf}) ← 음수면 빨간색, 양수면 초록색
ETH ({eth_etf}) ← 음수면 빨간색, 양수면 초록색

[우상단 박스 - 미결제약정 추이]
제목: 미결제약정 추이 (노란색)
BTC 24시간 : {btc_oi_24h} ← 음수면 빨간색, 양수면 초록색
ETH 24시간 : {eth_oi_24h} ← 음수면 빨간색, 양수면 초록색
※ 이 박스에는 위 2줄만. 다른 줄 절대 추가 금지.

[좌하단 박스 - DAT 추이]
제목: DAT 추이 (노란색)
WEEKLY NET INFLOW : {dat_now} (흰색)
※ 이 박스에는 위 1줄만. 다른 줄 절대 추가 금지.

[우하단 박스 - 코인베이스 프리미엄]
제목: 코인베이스 프리미엄 (노란색)
현재 지수 : {cb_premium} ← 음수면 빨간색, 양수면 초록색
※ 반드시 "현재 지수"로 표기. "형재" "형제" 오타 절대 금지.

=== 스타일 규칙 ===
- 배경: 어두운 칠판 녹색/검정 (dark chalkboard green/black)
- 폰트: 분필 손글씨 느낌 (chalk handwritten font)
- 박스 테두리: 흰색 분필선 직사각형
- 나무 액자/갈색 테두리 절대 금지. 칠판이 이미지 끝까지 꽉 차야 함.
- 캐릭터·로고·아이콘 없음
- 비율: 16:9 와이드
- 위에 명시된 텍스트 외 임의 내용 추가 금지 (블랙록, 피델리티 등 세부 데이터 추가 금지)"""

# ── API 호출 (fallback chain) ──────────────────────────────

def get_xai_key():
    key = os.environ.get("XAI_API_KEY")
    if key: return key
    r = subprocess.run(["security", "find-generic-password", "-s", "XAI_API_KEY", "-a", "openclaw", "-w"],
                       capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else None

def overlay_logo(img_rgba):
    """로고를 좌상단에 합성 (높이 90px, 비율 유지, 여백 12px)"""
    from PIL import Image as PILImage
    if not os.path.exists(LOGO_IMG):
        print(f"⚠️ 로고 파일 없음: {LOGO_IMG}", file=sys.stderr)
        return img_rgba
    logo = PILImage.open(LOGO_IMG).convert("RGBA")
    target_h = 90
    ratio = target_h / logo.height
    target_w = int(logo.width * ratio)
    logo = logo.resize((target_w, target_h), PILImage.LANCZOS)
    margin = 12
    img_rgba.paste(logo, (margin, margin), logo)
    return img_rgba

def try_grok(prompt_text):
    """xAI Grok Imagine API로 이미지 생성 (텍스트 프롬프트만, 레퍼런스 이미지 미지원)"""
    import requests
    from io import BytesIO
    from PIL import Image as PILImage
    xai_key = get_xai_key()
    if not xai_key:
        raise Exception("XAI_API_KEY not found")
    headers = {"Authorization": f"Bearer {xai_key}", "Content-Type": "application/json"}
    data = {"model": "grok-imagine-image-pro", "prompt": prompt_text, "n": 1}
    r = requests.post("https://api.x.ai/v1/images/generations", headers=headers, json=data, timeout=120)
    if r.status_code != 200:
        raise Exception(f"{r.status_code} {r.text[:200]}")
    img_url = r.json()["data"][0]["url"]
    img_bytes_out = requests.get(img_url, timeout=60).content
    img = PILImage.open(BytesIO(img_bytes_out)).convert("RGBA")
    img = overlay_logo(img)
    img.convert("RGB").save(OUTPUT, "PNG")

def try_gemini(model_name):
    """Gemini 모델로 레퍼런스 이미지 기반 생성"""
    from io import BytesIO
    from PIL import Image as PILImage
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    with open(REF_IMG, "rb") as f:
        img_bytes = f.read()
    ext = REF_IMG.rsplit(".", 1)[-1].lower()
    mime = "image/jpeg" if ext in ("jpg", "jpeg") else "image/png"
    response = client.models.generate_content(
        model=model_name,
        contents=[types.Part.from_bytes(data=img_bytes, mime_type=mime), prompt],
        config=types.GenerateContentConfig(response_modalities=["IMAGE", "TEXT"])
    )
    saved = False
    for part in response.candidates[0].content.parts:
        if part.inline_data:
            img = PILImage.open(BytesIO(part.inline_data.data)).convert("RGBA")
            img = overlay_logo(img)
            img.convert("RGB").save(OUTPUT, "PNG")
            saved = True
            break
    if not saved:
        txt = response.text[:300] if hasattr(response, "text") and response.text else "없음"
        raise Exception(f"이미지 없음 — 텍스트: {txt}")

last_error = None
for model in MODEL_CHAIN:
    try:
        print(f"Trying model: {model}...")
        if model == "grok-imagine-image-pro":
            try_grok(prompt)
        else:
            try_gemini(model)
        print(f"✅ 저장: {OUTPUT}  (model={model})")
        sys.exit(0)
    except Exception as e:
        err = str(e)
        print(f"⚠️ {model} 실패: {err[:120]}", file=sys.stderr)
        last_error = err
        if any(x in err for x in ["503", "UNAVAILABLE", "timeout", "Timeout", "deadline", "404", "NOT_FOUND", "XAI_API_KEY"]):
            continue
        # 치명적 오류
        print(f"❌ 이미지 생성 실패: {err}", file=sys.stderr)
        sys.exit(1)

print(f"❌ 모든 모델 실패. 마지막 오류: {last_error}", file=sys.stderr)
sys.exit(1)
