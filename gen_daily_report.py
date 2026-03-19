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

prompt = f"""이 이미지를 완전히 동일한 스타일과 레이아웃으로 재현하되, 아래 데이터로 수치만 교체해서 새로 생성해라.

=== 교체할 데이터 (아래 텍스트를 글자 하나도 틀리지 말고 그대로 표기) ===

[좌상단 박스 제목] BTC ETH ETF 유출입
[좌상단 부제] ETF 데이터는 마지막 거래일 기준
[좌상단 BTC 줄] BTC ({btc_etf})
[좌상단 ETH 줄] ETH ({eth_etf})

[우상단 큰 제목] 불개미 일일시황
[우상단 날짜] {date_str}

[우중단 박스 제목] 미결제약정 추이
[우중단 줄1] BTC 24시간 : {btc_oi_24h}
[우중단 줄2] ETH 24시간 : {eth_oi_24h}
※ 반드시 위 2줄만. "32시간" "48시간" "72시간" 같은 항목 절대 추가하지 말 것.

[좌하단 박스 제목] DAT 추이
[좌하단 줄1] WEEKLY NET INFLOW : {dat_now}
※ 줄 1개만. 나머지 줄 추가 금지. "WEEKLY NET INFLOW" 텍스트 오타 절대 금지.

[우하단 박스 제목] 코인베이스 프리미엄
[우하단 줄1] 현재 지수 : {cb_premium}
※ "형재" "형제" 오타 절대 금지. 반드시 "현재 지수"로 표기.

=== 스타일 규칙 (절대 변경 금지) ===
- 나무 액자 프레임 완전 없음. 칠판 배경이 이미지 끝까지 꽉 차야 함. 갈색/브라운 테두리 절대 금지.
- 어두운 칠판 배경 (dark chalkboard green/black)
- 분필 폰트 (chalk font, handwritten feel)
- 좌상단 캐릭터·로고·아이콘 등 일체 없음. 칠판 영역만 표시
- 섹션 박스: 흰색 분필선 직사각형
- 색상: 양수=초록, 음수=빨강, BTC·ETH 헤더=노란색, 일반텍스트=흰색
- 16:9 와이드 비율
- 위에 명시된 텍스트 외 임의 내용(블랙록, 피델리티 등 세부 데이터) 추가 금지"""

# ── API 호출 (fallback chain) ──────────────────────────────

def get_xai_key():
    key = os.environ.get("XAI_API_KEY")
    if key: return key
    r = subprocess.run(["security", "find-generic-password", "-s", "XAI_API_KEY", "-a", "openclaw", "-w"],
                       capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else None

def overlay_logo(img_rgba):
    """로고 합성 비활성화 (해병님 요청: 좌상단 로고 삭제)"""
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
