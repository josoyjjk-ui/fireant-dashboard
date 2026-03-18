#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["google-genai>=1.0.0", "pillow>=10.0.0", "requests>=2.28.0"]
# ///
"""
불개미 일일시황 이미지 생성기 v8
- 모델 체인: grok-imagine-image-pro(1) → gemini-3.1-flash(2) → gemini-3-pro(3)
- 펀드별 ETF 데이터 지원
- CB 프리미엄: 현재값만 (24h/72h 없음)
- 로컬 불개미 로고 좌상단 합성
"""
import sys, os, subprocess, io
from datetime import datetime
from google import genai
from google.genai import types

# ── 인자 파싱 ──────────────────────────────────────────────
args = sys.argv[1:]
def A(key, default="—"):
    try: return args[args.index(key)+1]
    except: return default

btc_etf      = A("BTC_ETF",       "+$199.37M")
eth_etf      = A("ETH_ETF",       "+$138.25M")
btc_oi_24h   = A("BTC_OI_24H",    "-4.67%")
eth_oi_24h   = A("ETH_OI_24H",    "-9.93%")
dat_now      = A("DAT_NOW",       "$1.57B (22,341 BTC)")
dat_week     = A("DAT_WEEK_AGO",  "—")
cb_premium   = A("CB_PREMIUM",    "N/A")
date_str     = A("DATE",          datetime.now().strftime("%Y.%m.%d (KST)"))

# BTC ETF 펀드별 (주요 4개)
btc_blackrock  = A("BTC_BLACKROCK",  "+$169M")
btc_fidelity   = A("BTC_FIDELITY",   "+$24M")
btc_ark        = A("BTC_ARK",        "+$2M")
btc_vaneck     = A("BTC_VANECK",     "+$3M")

# ETH ETF 펀드별 (주요)
eth_blackrock  = A("ETH_BLACKROCK",  "+$82M")
eth_fidelity   = A("ETH_FIDELITY",   "-$35M")

OUTPUT   = "/Users/fireant/.openclaw/workspace/daily-report-latest.png"
REF_IMG  = "/Users/fireant/.openclaw/workspace/assets/daily-chalk-reference.jpg"
LOGO_IMG = "/Users/fireant/.openclaw/workspace/assets/fireant-logo-nobg.png"

# 이미지 생성 모델 우선순위
MODEL_CHAIN = [
    "grok-imagine-image-pro",         # 1순위: xAI Grok
    "gemini-3.1-flash-image-preview", # 2순위
    "gemini-3-pro-image-preview",     # 3순위
]

prompt = f"""Create a dark chalkboard cryptocurrency market dashboard image, exactly 1792x1024 pixels (16:9).

CRITICAL STYLE:
- Pure dark green chalkboard texture background (#1a2e1a ~ #2d3a2d)
- NO wooden frame, NO beige border, NO brown border anywhere. Chalkboard fills edge to edge.
- All text in chalk handwriting style (rough, natural)
- White chalk dividing lines between sections
- Positive numbers = bright green chalk, negative = red chalk
- Section headers/titles = warm yellow chalk
- General labels = white chalk

LAYOUT - 4 quadrants divided by white chalk cross lines:

=== TOP-LEFT QUADRANT (ETF section, ~50% width, ~55% height) ===
Section title in yellow chalk: "BTC·ETH ETF 유출입"
Just below title, small white text: "(ETF 데이터는 마지막 거래일 기준)"

BTC subsection:
  Large yellow label: "BTC ({btc_etf})"
  2x2 fund grid in white/green chalk:
  Row 1: "블랙록  {btc_blackrock}"   "피델리티  {btc_fidelity}"
  Row 2: "아크     {btc_ark}"         "반에크   {btc_vaneck}"
  (positive values in green, negative in red)

ETH subsection below:
  Large yellow label: "ETH ({eth_etf})"
  1 row: "블랙록  {eth_blackrock}"   "피델리티  {eth_fidelity}"
  (positive values in green, negative in red)

=== TOP-RIGHT QUADRANT (Header + OI section) ===
Very large white chalk title (biggest text on image): "불개미 일일시황"
Small white text below: "{date_str}"

White chalk border box below titled "미결제약정 추이" (yellow):
  "BTC 24시간 : {btc_oi_24h}"  (red, negative)
  "ETH 24시간 : {eth_oi_24h}"  (red, negative)
  ONLY these 2 lines. No 72시간, no other lines.

=== BOTTOM-LEFT QUADRANT ===
White chalk border box titled "DAT 추이" (yellow):
  "WEEKLY NET INFLOW : {dat_now}"  (green if positive)
  Only 1 line. No extra lines.

=== BOTTOM-RIGHT QUADRANT ===
White chalk border box titled "코인베이스 프리미엄" (yellow):
  "현재 지수 : {cb_premium}"
  Only 1 line. No 24시간, no 72시간 lines.

CRITICAL TEXT RULES:
- Korean text must be perfectly legible and 100% accurate
- No typos: "현재" not "형재", "유출입" not "유입출"
- "WEEKLY NET INFLOW" must be spelled exactly as shown
- Do NOT add any fund data not listed above
- Do NOT add 72시간 lines"""

# ── API 호출 (fallback chain) ──────────────────────────────

def get_xai_key():
    key = os.environ.get("XAI_API_KEY")
    if key: return key
    r = subprocess.run(["security", "find-generic-password", "-s", "XAI_API_KEY", "-a", "openclaw", "-w"],
                       capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else None

def overlay_logo(base_img):
    """로컬 불개미 로고를 좌상단에 합성"""
    from PIL import Image as PILImage
    try:
        logo = PILImage.open(LOGO_IMG).convert("RGBA")
        logo_h = int(base_img.height * 0.17)
        logo_w = int(logo.width * logo_h / logo.height)
        logo = logo.resize((logo_w, logo_h), PILImage.LANCZOS)
        base_rgba = base_img.convert("RGBA")
        base_rgba.paste(logo, (22, 22), logo)
        return base_rgba.convert("RGB")
    except Exception as e:
        print(f"⚠️ 로고 합성 실패: {e}", file=sys.stderr)
        return base_img.convert("RGB")

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
    img = PILImage.open(BytesIO(img_bytes_out))
    final = overlay_logo(img)
    final.save(OUTPUT, "PNG")

def try_gemini(model_name):
    """Gemini 모델로 레퍼런스 이미지 기반 생성"""
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    with open(REF_IMG, "rb") as f:
        img_bytes = f.read()
    ext = REF_IMG.rsplit(".", 1)[-1].lower()
    mime = "image/jpeg" if ext in ("jpg", "jpeg") else "image/png"
    response = client.models.generate_content(
        model=model_name,
        contents=[types.Part.from_bytes(data=img_bytes, mime_type=mime), prompt]
    )
    saved = False
    for part in response.candidates[0].content.parts:
        if part.inline_data:
            with open(OUTPUT, "wb") as f:
                f.write(part.inline_data.data)
            saved = True
            break
    if not saved:
        txt = response.text[:300] if hasattr(response, "text") and response.text else "없음"
        raise Exception(f"이미지 없음 — 텍스트: {txt}")
    # Gemini 결과에도 로고 합성
    from PIL import Image as PILImage
    img = PILImage.open(OUTPUT)
    final = overlay_logo(img)
    final.save(OUTPUT, "PNG")

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
