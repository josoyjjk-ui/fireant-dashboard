"""
ETF 칠판 이미지 생성기 — Gemini (nano-banana) 방식
규칙:
  - 철자 오류는 허용
  - 숫자는 반드시 정확해야 함 → 불일치 시 최대 3회 재시도
  - gemini-2.5-flash-image 전용
"""
# /// script
# dependencies = ["google-genai", "Pillow"]
# ///
import os, sys, io
from PIL import Image as PILImage

TEMPLATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets/fireant-chalkboard-base.jpg")
OUTPUT   = os.path.join(os.path.dirname(os.path.abspath(__file__)), "etf_daily_chalk.png")
MODEL    = "gemini-2.5-flash-image"
MAX_RETRY = 3


def select_funds(funds: dict) -> list[tuple]:
    """BlackRock/Fidelity 고정 + 규칙에 따른 상위 운용사 선별"""
    FIXED   = ["BlackRock", "Fidelity"]
    others  = {k: v for k, v in funds.items() if k not in FIXED}
    inflow  = {k: v for k, v in others.items() if v > 0}
    outflow = {k: v for k, v in others.items() if v < 0}
    mixed   = bool(inflow) and bool(outflow)

    if mixed:
        top = []
        if inflow:  top.append(max(inflow, key=inflow.get))
        if outflow: top.append(min(outflow, key=outflow.get))
    elif outflow:
        top = sorted(outflow, key=lambda k: outflow[k])[:3]
    else:
        top = sorted(inflow, key=lambda k: inflow[k], reverse=True)[:3]

    result = [(f, funds.get(f, 0)) for f in FIXED]
    for name in top:
        result.append((name, funds[name]))
    return result


def fmt(val: float) -> str:
    if val == 0: return "0M"
    sign = "+" if val > 0 else ""
    if abs(val) >= 1000:
        return f"{sign}{val/1000:.1f}B"
    return f"{sign}{int(val)}M"


def build_prompt(btc_total, btc_rows, eth_total, eth_rows) -> str:
    btc_lines = "\n".join(f"  {name:<12} {fmt(val)}" for name, val in btc_rows)
    eth_lines = "\n".join(f"  {name:<12} {fmt(val)}" for name, val in eth_rows)

    # 숫자만 추출 (검증용)
    all_nums = [fmt(btc_total), fmt(eth_total)]
    for _, v in btc_rows: all_nums.append(fmt(v))
    for _, v in eth_rows: all_nums.append(fmt(v))

    return f"""On the blank chalkboard in this image, write ETF flow data in chalk handwriting style.

Draw a vertical white chalk line dividing the board into left/right halves.
Draw a horizontal line under the header row.
Draw faint separator lines between each data row.

LEFT COLUMN — BTC:
Header (yellow chalk, large): "BTC ({fmt(btc_total)})"
Rows (fund name LEFT-aligned, number RIGHT-aligned per row):
{btc_lines}

RIGHT COLUMN — ETH:
Header (yellow chalk, large): "ETH ({fmt(eth_total)})"
Rows (fund name LEFT-aligned, number RIGHT-aligned per row):
{eth_lines}

CRITICAL: Write EVERY number EXACTLY as listed above. Numbers must be pixel-perfect.
Positive numbers in bright green chalk. Negative numbers in red chalk. Zero (0M) in white chalk.
Fund names in white chalk. Keep fire ant character and frame unchanged.""", all_nums


def verify_numbers(img_path: str, expected: list[str]) -> tuple[bool, list[str]]:
    """이미지에서 숫자 검증 — google vision 대신 gemini로 확인"""
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    with open(img_path, "rb") as f:
        data = f.read()

    prompt = f"""List EVERY number written on the chalkboard in this image.
Format: one number per line, exactly as written (e.g. +767M, -43M, 0M, +962M).
Do not include fund names, just the numbers."""

    resp = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=[types.Part.from_bytes(data=data, mime_type="image/jpeg"), prompt]
    )
    found_text = resp.text.lower()

    missing = []
    for num in expected:
        # 숫자 매칭 (대소문자 무시, m/b 단위 포함)
        if num.lower() not in found_text:
            missing.append(num)

    return len(missing) == 0, missing


def generate_once(client, ref_bytes, prompt) -> bytes | None:
    from google.genai import types

    resp = client.models.generate_content(
        model=MODEL,
        contents=[
            types.Part.from_bytes(data=ref_bytes, mime_type="image/jpeg"),
            prompt
        ],
        config=types.GenerateContentConfig(
            response_modalities=["TEXT", "IMAGE"],
            image_config=types.ImageConfig(image_size="1K", aspect_ratio="16:9")
        )
    )
    for part in resp.candidates[0].content.parts:
        if part.inline_data:
            return part.inline_data.data
    return None


def generate(btc_total: float, btc_funds: dict,
             eth_total: float, eth_funds: dict,
             output: str = OUTPUT) -> str:

    from google import genai

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY 환경변수 없음")

    client = genai.Client(api_key=api_key)

    btc_rows = select_funds(btc_funds)
    eth_rows = select_funds(eth_funds)
    prompt, expected_nums = build_prompt(btc_total, btc_rows, eth_total, eth_rows)

    with open(TEMPLATE, "rb") as f:
        ref = f.read()

    for attempt in range(1, MAX_RETRY + 1):
        print(f"⏳ 생성 시도 {attempt}/{MAX_RETRY}...")
        img_data = generate_once(client, ref, prompt)
        if not img_data:
            print(f"  ❌ 이미지 없음, 재시도")
            continue

        img = PILImage.open(io.BytesIO(img_data)).convert("RGB")
        img.save(output, quality=95)

        ok, missing = verify_numbers(output, expected_nums)
        if ok:
            print(f"✅ 저장: {output}  {img.size}  (시도 {attempt}회)")
            return output
        else:
            print(f"  ⚠️ 숫자 불일치: {missing} — 재시도")

    # 최대 재시도 초과 → 마지막 결과 그대로 사용 (철자 오류는 허용)
    print(f"⚠️ {MAX_RETRY}회 시도 후 최종 저장 (숫자 불일치 있을 수 있음): {output}")
    return output


if __name__ == "__main__":
    # 3/3 최신 확정 데이터
    btc_funds = {
        "BlackRock": 767, "Fidelity": 95, "Bitwise": 36,
        "VanEck": 20, "GrayMini": 18, "Ark": 6,
        "Franklin": 14, "Invesco": 6, "Grayscale": 0,
    }
    eth_funds = {
        "BlackRock": 26, "Fidelity": 1,
        "GrayMini": 5, "Grayscale": 4, "VanEck": 0,
    }
    generate(962, btc_funds, 39, eth_funds)
