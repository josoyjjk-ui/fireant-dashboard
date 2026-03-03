"""
ETF 칠판 이미지 생성기 — Gemini 칠판 필기 방식
"""
# /// script
# dependencies = ["google-genai", "Pillow"]
# ///
import os, sys, io
from PIL import Image as PILImage

TEMPLATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets/fireant-chalkboard-base.jpg")
OUTPUT   = os.path.join(os.path.dirname(os.path.abspath(__file__)), "etf_daily_chalk.png")


def select_funds(funds: dict) -> list[tuple]:
    """BlackRock/Fidelity 고정 + 규칙에 따른 상위 운용사 선별"""
    FIXED = ["BlackRock", "Fidelity"]
    others = {k: v for k, v in funds.items() if k not in FIXED}
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
    btc_lines = "\n".join(f"{name:<12} {fmt(val)}" for name, val in btc_rows)
    eth_lines = "\n".join(f"{name:<12} {fmt(val)}" for name, val in eth_rows)
    return f"""On the blank chalkboard in this image, write the following ETF data in beautiful chalk handwriting style.

Draw a vertical white chalk line dividing the chalkboard into left and right halves.
Draw a horizontal line under the header row.
Draw faint horizontal separator lines between each data row.

LEFT COLUMN — BTC:
Header (yellow chalk, large): "BTC ({fmt(btc_total)})"
Rows below (white chalk for names, green for positive, red for negative):
{btc_lines}

RIGHT COLUMN — ETH:
Header (yellow chalk, large): "ETH ({fmt(eth_total)})"
Rows below (white chalk for names, green for positive, red for negative):
{eth_lines}

Rules:
- Write every number EXACTLY as shown — do not change any digit
- Fund names in white chalk, LEFT-aligned in each cell
- Numbers in bright green (positive) or red (negative) chalk, RIGHT-aligned
- Headers in yellow chalk, larger font than data rows
- Authentic chalk handwriting texture on dark green board
- Keep the fire ant character and wooden frame completely unchanged"""


def generate(btc_total: float, btc_funds: dict,
             eth_total: float, eth_funds: dict,
             output: str = OUTPUT) -> str:

    from google import genai
    from google.genai import types

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY 환경변수 없음")

    client = genai.Client(api_key=api_key)

    btc_rows = select_funds(btc_funds)
    eth_rows = select_funds(eth_funds)
    prompt   = build_prompt(btc_total, btc_rows, eth_total, eth_rows)

    with open(TEMPLATE, "rb") as f:
        ref = f.read()

    response = client.models.generate_content(
        model="gemini-2.5-flash-image",
        contents=[
            types.Part.from_bytes(data=ref, mime_type="image/jpeg"),
            prompt
        ],
        config=types.GenerateContentConfig(
            response_modalities=["TEXT", "IMAGE"],
            image_config=types.ImageConfig(image_size="1K", aspect_ratio="16:9")
        )
    )

    for part in response.candidates[0].content.parts:
        if part.inline_data:
            img = PILImage.open(io.BytesIO(part.inline_data.data)).convert("RGB")
            img.save(output, quality=95)
            print(f"✅ 저장: {output}  {img.size}")
            return output

    raise RuntimeError("Gemini 이미지 생성 실패")


if __name__ == "__main__":
    # 3/3 데이터
    btc_funds = {
        "BlackRock": 767, "Fidelity": 95, "Grayscale": 0,
        "Bitwise": 36, "Ark": 6, "VanEck": 20
    }
    eth_funds = {
        "BlackRock": 26, "Fidelity": 1, "Grayscale": 4,
        "GrayMini": 5, "VanEck": 0
    }
    generate(962, btc_funds, 39, eth_funds)
