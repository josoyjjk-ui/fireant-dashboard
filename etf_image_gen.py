"""
ETF 칠판 이미지 생성기
불개미 칠판 스타일 — 최신 ETF 유출입 데이터 → 이미지
"""
from PIL import Image, ImageDraw, ImageFont
import os

TEMPLATE = os.path.join(os.path.dirname(__file__), "assets/fireant-chalkboard-base.jpg")
OUTPUT   = os.path.join(os.path.dirname(__file__), "etf_daily_chalk.png")

# 칠판 내부 좌표 (1280x720 기준)
BL, BT, BR, BB = 330, 72, 1220, 530
DIV_X = BL + (BR - BL) // 2   # 775

# ── 표시 규칙 ──────────────────────────────────────────
def select_funds(funds: dict) -> list[tuple]:
    """
    funds: {"운용사명": float(M)} — 양수=유입, 음수=유출, 0=변동없음
    반환: [(name, value), ...] — BlackRock/Fidelity 고정 포함 최대 5개
    """
    FIXED = ["BlackRock", "Fidelity"]
    others = {k: v for k, v in funds.items() if k not in FIXED}

    inflow  = {k: v for k, v in others.items() if v > 0}
    outflow = {k: v for k, v in others.items() if v < 0}
    mixed   = bool(inflow) and bool(outflow)

    if mixed:
        # 혼재: 최대 유입 1개 + 최대 유출 1개
        top = []
        if inflow:
            top.append(max(inflow, key=inflow.get))
        if outflow:
            top.append(min(outflow, key=outflow.get))
    elif outflow:
        top = sorted(outflow, key=lambda k: outflow[k])[:3]
    else:
        top = sorted(inflow, key=lambda k: inflow[k], reverse=True)[:3]

    result = [(f, funds.get(f, 0)) for f in FIXED]
    for name in top:
        result.append((name, funds[name]))
    return result


def fmt(val: float) -> str:
    if val == 0:
        return "0M"
    sign = "+" if val > 0 else ""
    if abs(val) >= 1000:
        return f"{sign}{val/1000:.1f}B"
    return f"{sign}{int(val)}M"


def val_color(val: float, GREEN, RED, WHITE):
    if val > 0: return GREEN
    if val < 0: return RED
    return WHITE


def generate(btc_total: float, btc_funds: dict,
             eth_total: float, eth_funds: dict,
             output: str = OUTPUT):

    src  = Image.open(TEMPLATE).copy()
    W, H = src.size
    draw = ImageDraw.Draw(src)

    BW = BR - BL
    BH = BB - BT

    try:
        f_hdr  = ImageFont.truetype("/System/Library/Fonts/Supplemental/ChalkboardSE-Bold.ttf",    50)
        f_name = ImageFont.truetype("/System/Library/Fonts/Supplemental/ChalkboardSE-Regular.ttf", 32)
        f_val  = ImageFont.truetype("/System/Library/Fonts/Supplemental/ChalkboardSE-Bold.ttf",    36)
    except:
        f_hdr = f_name = f_val = ImageFont.load_default()

    YELLOW = (240, 220, 65)
    GREEN  = (85,  215, 85)
    RED    = (230, 85,  85)
    WHITE  = (242, 242, 225)
    CHALK  = (190, 205, 190)
    LGRAY  = (155, 175, 162)

    btc_rows = select_funds(btc_funds)
    eth_rows = select_funds(eth_funds)
    ROW_CNT  = max(len(btc_rows), len(eth_rows))

    HDR_H = int(BH * 0.20)
    ROW_H = (BH - HDR_H) // ROW_CNT
    PAD   = 16

    ROWS_Y = [BT + HDR_H + i * ROW_H for i in range(ROW_CNT)]

    # 구조선
    draw.line([(BL, BT+HDR_H), (BR, BT+HDR_H)], fill=WHITE, width=3)
    draw.line([(DIV_X, BT+6),  (DIV_X, BB-6)],  fill=WHITE, width=3)
    for y in ROWS_Y[1:]:
        draw.line([(BL+6,     y), (DIV_X-6, y)], fill=CHALK, width=1)
        draw.line([(DIV_X+6, y), (BR-6,    y)], fill=CHALK, width=1)

    # 헤더
    btc_hdr = f"BTC ({fmt(btc_total)})"
    eth_hdr = f"ETH ({fmt(eth_total)})"
    draw.text(((BL+DIV_X)//2, BT+HDR_H//2), btc_hdr,
              fill=val_color(btc_total, YELLOW, RED, WHITE), font=f_hdr, anchor="mm")
    draw.text(((DIV_X+BR)//2,  BT+HDR_H//2), eth_hdr,
              fill=val_color(eth_total, YELLOW, RED, WHITE), font=f_hdr, anchor="mm")

    # BTC 행
    for i, (name, val) in enumerate(btc_rows):
        cy = ROWS_Y[i] + ROW_H // 2
        draw.text((BL+PAD,    cy), name,      fill=WHITE,                           font=f_name, anchor="lm")
        draw.text((DIV_X-PAD, cy), fmt(val),  fill=val_color(val, GREEN, RED, WHITE), font=f_val,  anchor="rm")

    # ETH 행
    for i, (name, val) in enumerate(eth_rows):
        cy = ROWS_Y[i] + ROW_H // 2
        draw.text((DIV_X+PAD, cy), name,      fill=WHITE,                           font=f_name, anchor="lm")
        draw.text((BR-PAD,    cy), fmt(val),  fill=val_color(val, GREEN, RED, WHITE), font=f_val,  anchor="rm")

    src.save(output, quality=95)
    print(f"✅ 저장: {output}  ({W}x{H})")
    return output


# ── 오늘 데이터로 테스트 ──
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
