#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10.0.0", "requests>=2.28.0"]
# ///
"""
불개미 일일시황 이미지 생성기 v9
- PIL 고정 렌더링 (확정 양식 2026-03-19)
- 배경: 진한 흑갈색 (#1a1410)
- 로고: 좌상단 박스 밖 자유배치
- 4분할: 흰 구분선
- 좌상단: ETF 박스 (BTC/ETH 각 블랙록·피델리티)
- 우상단: 큰 타이틀 + 미결제약정 박스
- 좌하단: DAT 박스
- 우하단: 코인베이스 프리미엄 박스
"""
import sys, os
from PIL import Image, ImageDraw, ImageFont
from datetime import datetime

# ── 인자 파싱 ──────────────────────────────────────────────
args = sys.argv[1:]
def A(key, default="—"):
    try: return args[args.index(key)+1]
    except: return default

btc_etf       = A("BTC_ETF",        "+$199.37M")
eth_etf       = A("ETH_ETF",        "+$138.25M")
btc_blackrock = A("BTC_BLACKROCK",  "+$169M")
btc_fidelity  = A("BTC_FIDELITY",   "+$24M")
eth_blackrock = A("ETH_BLACKROCK",  "+$82M")
eth_fidelity  = A("ETH_FIDELITY",   "-$35M")
btc_oi_24h    = A("BTC_OI_24H",     "-4.67%")
eth_oi_24h    = A("ETH_OI_24H",     "-9.93%")
dat_now       = A("DAT_NOW",        "$1.57B (22,341 BTC)")
cb_premium    = A("CB_PREMIUM",     "N/A")
date_str      = A("DATE",           datetime.now().strftime("%Y.%m.%d (KST)"))

OUTPUT   = "/Users/fireant/.openclaw/workspace/daily-report-latest.png"
LOGO_IMG = "/Users/fireant/.openclaw/workspace/assets/fireant-logo-nobg2.png"
FONT     = "/System/Library/Fonts/AppleSDGothicNeo.ttc"

# ── 색상 ──────────────────────────────────────────────────
BG       = (26, 20, 16)     # 진한 흑갈색 #1a1410
WHITE    = (255, 255, 255)
YELLOW   = (220, 190, 60)   # 골드 노랑 (BTC/ETH 헤더)
GREEN    = (80, 210, 80)    # 양수
RED      = (220, 60, 60)    # 음수
GRAY     = (180, 175, 168)  # 소주석·날짜
LINE     = (220, 220, 220)  # 흰 구분선/박스

W, H = 1280, 720

# ── 폰트 ──────────────────────────────────────────────────
def f(sz, bold=False):
    return ImageFont.truetype(FONT, sz, index=7 if bold else 3)

fMainTitle = f(72, True)   # 불개미 일일시황
fSecTitle  = f(32, True)   # 섹션 타이틀 (미결제약정 추이 등)
fETFHead   = f(34, True)   # BTC (+$199.37M)
fFund      = f(26)          # 블랙록 +$169M
fData      = f(28)          # BTC 24시간 : -4.67%
fSmall     = f(17)          # 소주석
fDate      = f(22)          # 날짜

# ── 유틸 ──────────────────────────────────────────────────
def cv(v): return GREEN if "+" in str(v) else RED if "-" in str(v) else WHITE

def draw_img():
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    MX = W // 2       # 640
    MY = 430           # 수평 분할선

    # ── 분할선 ──
    d.line([(MX, 0), (MX, H)], fill=LINE, width=2)
    d.line([(0, MY), (W, MY)], fill=LINE, width=2)

    PAD = 14  # 박스 내부 패딩
    R   = 12  # 모서리 둥글기

    # ── 박스 그리기 ──────────────────────────────────────
    # 좌상단 박스: 로고 크기(140px) 아래부터 시작, ETF 텍스트 포함
    LOGO_H = 130
    boxes = {
        "etf":  (8,  LOGO_H+4, MX-4,  MY-4),   # 좌상단 (로고 아래부터)
        "oi":   (MX+4, 180, W-8, MY-4),          # 우상단 미결제약정 박스만
        "dat":  (8,  MY+4, MX-4, H-8),           # 좌하단
        "cb":   (MX+4, MY+4, W-8, H-8),          # 우하단
    }
    for bx1, by1, bx2, by2 in boxes.values():
        d.rounded_rectangle([bx1, by1, bx2, by2], radius=R, outline=LINE, width=2)

    # ── 좌상단: BTC·ETH ETF 유출입 ──────────────────────
    bx1, by1, bx2, by2 = boxes["etf"]
    cx = (bx1 + bx2) // 2

    # 타이틀
    ty = by1 + 16
    ctxt(d, cx, ty, "BTC·ETH ETF 유출입", fSecTitle, WHITE)
    ty += 42
    ctxt(d, cx, ty, "(ETF 데이터는 마지막 거래일 기준)", fSmall, GRAY)

    # BTC 헤더
    ty += 34
    ctxt(d, cx, ty, f"BTC ({btc_etf})", fETFHead, YELLOW)
    ty += 48
    # 블랙록 | 피델리티
    draw_fund_row(d, bx1, bx2, ty, "블랙록", btc_blackrock, "피델리티", btc_fidelity)

    # 구분선
    ty += 44
    sep_y = ty + 4
    d.line([(bx1+20, sep_y), (bx2-20, sep_y)], fill=LINE, width=1)

    # ETH 헤더
    ty += 22
    ctxt(d, cx, ty, f"ETH ({eth_etf})", fETFHead, YELLOW)
    ty += 48
    draw_fund_row(d, bx1, bx2, ty, "블랙록", eth_blackrock, "피델리티", eth_fidelity)

    # ── 우상단: 타이틀 + 미결제약정 ──────────────────────
    rcx = MX + (W - MX) // 2

    # 큰 타이틀 (박스 밖)
    ctxt(d, rcx, 30, "불개미 일일시황", fMainTitle, WHITE)
    ctxt(d, rcx, 118, date_str, fDate, GRAY)

    # 미결제약정 박스
    bx1, by1, bx2, by2 = boxes["oi"]
    oy = by1 + 18
    ctxt(d, rcx, oy, "미결제약정 추이", fSecTitle, WHITE)
    oy += 56
    # BTC / ETH 각 줄
    draw_data_line(d, bx1+20, bx2-20, oy, "BTC 24시간 :", btc_oi_24h)
    oy += 46
    draw_data_line(d, bx1+20, bx2-20, oy, "ETH 24시간 :", eth_oi_24h)

    # ── 좌하단: DAT 추이 ──────────────────────────────────
    bx1, by1, bx2, by2 = boxes["dat"]
    dcx = (bx1 + bx2) // 2
    dcy = (by1 + by2) // 2
    ctxt(d, dcx, dcy - 42, "DAT 추이", fSecTitle, WHITE)
    # WEEKLY NET INFLOW 레이블 + 값
    label = "WEEKLY NET INFLOW : "
    bb = d.textbbox((0,0), label, font=fData)
    val_w = d.textbbox((0,0), dat_now, font=fData)[2]
    total_w = bb[2] + val_w
    lx = dcx - total_w // 2
    d.text((lx, dcy + 10), label, font=fData, fill=WHITE)
    d.text((lx + bb[2], dcy + 10), dat_now, font=fData, fill=GREEN)

    # ── 우하단: 코인베이스 프리미엄 ──────────────────────
    bx1, by1, bx2, by2 = boxes["cb"]
    ccx = (bx1 + bx2) // 2
    ccy = (by1 + by2) // 2
    ctxt(d, ccx, ccy - 42, "코인베이스 프리미엄", fSecTitle, WHITE)
    cb_text = f"현재 지수 : {cb_premium}"
    ctxt(d, ccx, ccy + 10, cb_text, fData, WHITE)

    # ── 로고 합성 (박스 밖 좌상단) ────────────────────────
    try:
        logo = Image.open(LOGO_IMG).convert("RGBA")
        lh = LOGO_H
        lw = int(logo.width * lh / logo.height)
        logo = logo.resize((lw, lh), Image.LANCZOS)
        img_rgba = img.convert("RGBA")
        img_rgba.paste(logo, (8, 4), logo)
        img = img_rgba.convert("RGB")
    except Exception as e:
        print(f"⚠️ 로고 합성 실패: {e}", file=sys.stderr)

    img.save(OUTPUT, "PNG")
    print(f"✅ 저장: {OUTPUT}")

def ctxt(d, cx, y, text, font, color):
    bb = d.textbbox((0,0), text, font=font)
    d.text((cx - (bb[2]-bb[0])//2, y), text, font=font, fill=color)

def draw_fund_row(d, bx1, bx2, y, l1, v1, l2, v2):
    """펀드 2열 렌더링"""
    mid = (bx1 + bx2) // 2
    # 좌열
    lw1 = d.textbbox((0,0), l1, font=f(26))[2]
    vw1 = d.textbbox((0,0), v1, font=f(26))[2]
    gap = 10
    total1 = lw1 + gap + vw1
    lx1 = mid // 2 - total1 // 2 + bx1 // 2
    d.text((lx1, y), l1, font=f(26), fill=WHITE)
    d.text((lx1 + lw1 + gap, y), v1, font=f(26), fill=cv(v1))
    # 우열
    lw2 = d.textbbox((0,0), l2, font=f(26))[2]
    vw2 = d.textbbox((0,0), v2, font=f(26))[2]
    total2 = lw2 + gap + vw2
    lx2 = mid + (bx2 - mid) // 2 - total2 // 2
    d.text((lx2, y), l2, font=f(26), fill=WHITE)
    d.text((lx2 + lw2 + gap, y), v2, font=f(26), fill=cv(v2))

def draw_data_line(d, x1, x2, y, label, value):
    """레이블 + 값 한 줄 (값은 오른쪽)"""
    font = f(28)
    lbb = d.textbbox((0,0), label, font=font)
    vbb = d.textbbox((0,0), value, font=font)
    total = lbb[2] + 12 + vbb[2]
    lx = (x1 + x2) // 2 - total // 2
    d.text((lx, y), label, font=font, fill=WHITE)
    d.text((lx + lbb[2] + 12, y), value, font=font, fill=cv(value))

draw_img()
