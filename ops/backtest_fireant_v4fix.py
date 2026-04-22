"""
불개미 매매 원칙 개선판 v4-fix 백테스트
BTC 선물 (BTCUSDT), $1,000 초기 시드
기간: 2021-02-28 ~ 2026-02-28 UTC

v4 대비 완화 변경사항 (3곳):
  F-3. HL구조 비교 캔들 수 3개 → 2개 (직전 2캔들만 비교)
  I-1. 변동성 차단 임계값 3% → 5%, 윈도우 4캔들 → 2캔들
  F-1. R:R 최소 비율 2.0 → 1.5
"""

import os
import pickle
import pandas as pd
import numpy as np

# ── 캐시 경로 ──────────────────────────────────────────────────────────────────
CACHE_FILE = "/Users/fireant/.openclaw/workspace/backtest_data.pkl"

def load_data():
    if os.path.exists(CACHE_FILE):
        print(f"캐시 로드: {CACHE_FILE}")
        with open(CACHE_FILE, "rb") as f:
            df = pickle.load(f)
        print(f"캐시 로드 완료: {len(df)} 캔들 ({df.index[0]} ~ {df.index[-1]})")
        return df
    raise FileNotFoundError(f"캐시 없음: {CACHE_FILE}")


# ── 백테스트 파라미터 ─────────────────────────────────────────────────────────
INIT_SEED       = 1000.0    # 초기 시드
MAX_SEED        = 10000.0   # H-2: 시드 상한 $10,000
FEE_RATE        = 0.0004    # 0.04% 수수료
LEV             = 5         # 레버리지
LIQ_RATIO       = 0.20      # 청산 비율

ENTRY_LONG_PCT  = 0.965     # H24 × 0.965 이하 → 롱 신호
ENTRY_SHORT_PCT = 1.045     # H24 × 1.045 이상 → 숏 신호
ADD_STEP_PCT    = 0.005     # 물타기 간격 0.5%

MA150_WINDOW    = 150 * 24  # 3600 (B-2 유지)
COOLDOWN_BARS   = 24        # 24시간 쿨다운 (B-1 유지)

# G-1: ATR 기반 트레일링
ATR_WINDOW      = 14        # ATR14
ATR_MULT        = 1.0       # trail_dist = ATR14 × 1.0

# H-1: 월간 재투자 (30일)
REINVEST_DAYS   = 30
REINVEST_RATIO  = 0.50

# 역피라미딩 비율 (시드 기준)
ADD_RATIOS = [0.02, 0.03, 0.05]  # 1차 2%, 2차 3%, 3차 이후 5%

# F-1 완화: R:R 최소 비율 2.0 → 1.5
RR_MIN          = 1.5

# I-1 완화: 변동성 폭발 임계값 3% → 5%
VOL_SPIKE_THRESH = 0.05     # 5% 이상 진폭 = 폭발 (완화)


def seed_params(seed):
    """시드 기준으로 마진 파라미터 반환"""
    return {
        "init_margin":    seed * 0.20,
        "max_margin":     seed * 1.00,
        "freeze_margin":  seed * 0.80,
    }


def add_margin_for_count(seed, add_count):
    """물타기 횟수(0-indexed)에 따른 추가 마진"""
    if add_count < len(ADD_RATIOS):
        ratio = ADD_RATIOS[add_count]
    else:
        ratio = ADD_RATIOS[-1]
    return seed * ratio


# ── 백테스트 엔진 (v4-fix) ────────────────────────────────────────────────────
def run_backtest_v4fix(df):
    df = df.copy()

    # 사전 계산
    df["sma8"]    = df["close"].rolling(8).mean()
    df["sma25"]   = df["close"].rolling(25).mean()
    df["ma150"]   = df["close"].rolling(MA150_WINDOW).mean()
    df["h24"]     = df["high"].rolling(24).max().shift(1)
    df["prev_open"]  = df["open"].shift(1)
    df["prev_close"] = df["close"].shift(1)
    df["volume"]  = df["volume"].astype(float)
    df["vol_ma20"] = df["volume"].rolling(20).mean()

    # G-1: ATR14 계산
    df["atr14"] = (df["high"] - df["low"]).rolling(ATR_WINDOW).mean()

    # F-1: R:R 비율 계산
    df["tp_dist"] = abs(df["sma25"] - df["close"]) / df["close"]
    df["sl_dist"] = df["atr14"] / df["close"]
    df["rr_ratio"] = df["tp_dist"] / df["sl_dist"]

    # F-3 완화: 고점·저점 구조 (직전 2캔들만 비교, 3캔들 → 2캔들)
    df["low_1"]  = df["low"].shift(1)
    df["low_2"]  = df["low"].shift(2)   # low_3 제거
    df["high_1"] = df["high"].shift(1)
    df["high_2"] = df["high"].shift(2)  # high_3 제거
    # 직전 2캔들만 비교 (완화)
    df["hl_structure"] = df["low_1"] > df["low_2"]
    df["lh_structure"] = df["high_1"] < df["high_2"]

    # I-1 완화: 변동성 폭발 구간 감지 (직전 2캔들, 임계값 5%)
    for i in range(1, 3):  # 4캔들 → 2캔들
        df[f"candle_range_{i}"] = (df["high"].shift(i) - df["low"].shift(i)) / df["close"].shift(i)
    df["vol_spike"] = (
        (df["candle_range_1"] >= VOL_SPIKE_THRESH) |   # 3% → 5%
        (df["candle_range_2"] >= VOL_SPIKE_THRESH)     # 윈도우 4 → 2캔들
    )

    # ── 상태 변수 ──────────────────────────────────────────────────────────────
    seed           = INIT_SEED
    pnl_cum        = 0.0
    equity_peak    = seed
    max_dd         = 0.0
    pos            = None
    trades         = []
    cooldown_remaining = 0

    # H-1: 월간 재투자 추적
    month_start_ts   = None
    month_start_pnl  = pnl_cum

    # ── 헬퍼 함수 ──────────────────────────────────────────────────────────────
    def calc_avg_price(entries):
        total_size = sum(m * LEV for _, m in entries)
        wavg = sum(p * m * LEV for p, m in entries) / total_size
        return wavg

    def calc_liq(side, avg_price):
        if side == "long":
            return avg_price * (1 - LIQ_RATIO)
        else:
            return avg_price * (1 + LIQ_RATIO)

    def open_position(side, price, ts, atr14_val):
        nonlocal pnl_cum
        params = seed_params(seed)
        init_m = params["init_margin"]
        fee = init_m * LEV * FEE_RATE
        pnl_cum -= fee
        entries = [(price, init_m)]
        avg_p = calc_avg_price(entries)
        trail_dist = atr14_val * ATR_MULT
        return {
            "side":            side,
            "entries":         entries,
            "total_margin":    init_m,
            "avg_price":       avg_p,
            "liq_price":       calc_liq(side, avg_p),
            "last_add_price":  price,
            "add_count":       0,
            "tp1_done":        False,
            "tp2_done":        False,
            "trail_peak":      price,
            "trail_dist":      trail_dist,
            "trailing_active": False,
            "remaining_frac":  1.0,
            "open_ts":         ts,
            "realized_pnl":    -fee,
        }

    def add_to_position(pos, price):
        nonlocal pnl_cum
        params = seed_params(seed)
        freeze_m = params["freeze_margin"]
        max_m    = params["max_margin"]
        if pos["total_margin"] >= freeze_m:
            return pos
        if pos["total_margin"] >= max_m:
            return pos
        add_m = add_margin_for_count(seed, pos["add_count"])
        add_m = min(add_m, max_m - pos["total_margin"])
        if add_m <= 0:
            return pos
        fee = add_m * LEV * FEE_RATE
        pnl_cum -= fee
        pos["entries"].append((price, add_m))
        pos["total_margin"] += add_m
        pos["realized_pnl"] -= fee
        pos["add_count"] += 1
        avg_p = calc_avg_price(pos["entries"])
        pos["avg_price"]      = avg_p
        pos["liq_price"]      = calc_liq(pos["side"], avg_p)
        pos["last_add_price"] = price
        return pos

    def close_partial(pos, close_price, frac):
        nonlocal pnl_cum
        total_size  = pos["total_margin"] * LEV
        close_size  = total_size * pos["remaining_frac"] * frac
        fee         = close_size * FEE_RATE
        if pos["side"] == "long":
            gross = close_size * (close_price - pos["avg_price"]) / pos["avg_price"]
        else:
            gross = close_size * (pos["avg_price"] - close_price) / pos["avg_price"]
        net = gross - fee
        pnl_cum += net
        pos["realized_pnl"]   += net
        pos["remaining_frac"] -= pos["remaining_frac"] * frac
        return pos, net

    def close_all(pos, close_price, reason=""):
        nonlocal pnl_cum
        remaining = pos["remaining_frac"]
        if remaining <= 0:
            return 0.0
        total_size = pos["total_margin"] * LEV
        close_size = total_size * remaining
        fee        = close_size * FEE_RATE
        if pos["side"] == "long":
            gross = close_size * (close_price - pos["avg_price"]) / pos["avg_price"]
        else:
            gross = close_size * (pos["avg_price"] - close_price) / pos["avg_price"]
        net = gross - fee
        pnl_cum += net
        pos["realized_pnl"]   += net
        pos["remaining_frac"]  = 0.0
        return net

    def record_trade(pos, close_ts, is_liq=False):
        trades.append({
            "open_ts":       pos["open_ts"],
            "close_ts":      close_ts,
            "side":          pos["side"],
            "avg_price":     pos["avg_price"],
            "total_margin":  pos["total_margin"],
            "realized_pnl":  pos["realized_pnl"],
            "liquidated":    is_liq,
            "seed_at_open":  seed,
        })

    def update_equity_dd():
        nonlocal equity_peak, max_dd
        equity = seed + pnl_cum
        if equity > equity_peak:
            equity_peak = equity
        dd = (equity_peak - equity) / equity_peak * 100
        if dd > max_dd:
            max_dd = dd

    def check_monthly(ts):
        """H-1: 월간 재투자 체크"""
        nonlocal seed, month_start_ts, month_start_pnl, equity_peak
        if month_start_ts is None:
            return
        elapsed_days = (ts - month_start_ts).total_seconds() / 86400
        if elapsed_days >= REINVEST_DAYS:
            month_pnl = pnl_cum - month_start_pnl
            if month_pnl > 0:
                reinvest = month_pnl * REINVEST_RATIO
                new_seed = min(seed + reinvest, MAX_SEED)
                if new_seed > seed:
                    seed = new_seed
                    if seed + pnl_cum > equity_peak:
                        equity_peak = seed + pnl_cum
            month_start_ts  = ts
            month_start_pnl = pnl_cum

    # ── 메인 루프 ────────────────────────────────────────────────────────────────
    rows = list(df.itertuples())
    for row in rows:
        ts         = row.Index
        close      = row.close
        low        = row.low
        high       = row.high
        open_      = row.open
        sma8       = row.sma8
        sma25      = row.sma25
        ma150      = row.ma150
        h24        = row.h24
        prev_open  = row.prev_open
        prev_close = row.prev_close
        volume     = row.volume
        vol_ma20   = row.vol_ma20
        atr14      = row.atr14
        rr_ratio   = row.rr_ratio
        hl_struct  = row.hl_structure
        lh_struct  = row.lh_structure
        vol_spike  = row.vol_spike

        # NaN 건너뜀
        if (pd.isna(h24) or pd.isna(sma8) or pd.isna(sma25)
                or pd.isna(ma150) or pd.isna(prev_open) or pd.isna(prev_close)
                or pd.isna(vol_ma20) or pd.isna(atr14) or pd.isna(rr_ratio)):
            if month_start_ts is None and not pd.isna(h24):
                month_start_ts  = ts
                month_start_pnl = pnl_cum
            continue

        # 월간 초기화
        if month_start_ts is None:
            month_start_ts  = ts
            month_start_pnl = pnl_cum

        # 쿨다운 감소
        if cooldown_remaining > 0:
            cooldown_remaining -= 1

        # H-1: 월간 재투자 체크
        check_monthly(ts)

        # ── 포지션 없음: 진입 탐색 ─────────────────────────────────────────────
        if pos is None:
            if cooldown_remaining > 0:
                pass
            else:
                # 기본 필터
                trend_bull = (close > ma150)
                trend_bear = (close < ma150)
                prev_bullish = (prev_close > prev_open)
                prev_bearish = (prev_close < prev_open)
                vol_ok = (volume > vol_ma20 * 1.5)

                long_signal  = (close <= h24 * ENTRY_LONG_PCT)
                short_signal = (close >= h24 * ENTRY_SHORT_PCT)

                # I-1 완화: 변동성 차단 (5%, 2캔들)
                no_spike = not bool(vol_spike)

                # F-1 완화: R:R ≥ 1.5
                rr_ok = (not pd.isna(rr_ratio)) and (rr_ratio >= RR_MIN)

                # F-3 완화: 직전 2캔들 HL/LH 구조
                hl_ok = bool(hl_struct)
                lh_ok = bool(lh_struct)

                if (long_signal and trend_bull and prev_bullish and vol_ok
                        and no_spike and rr_ok and hl_ok):
                    pos = open_position("long", close, ts, atr14)
                elif (short_signal and trend_bear and prev_bearish and vol_ok
                        and no_spike and rr_ok and lh_ok):
                    pos = open_position("short", close, ts, atr14)

        # ── 포지션 있음 ────────────────────────────────────────────────────────
        else:
            side = pos["side"]
            params = seed_params(seed)
            trail_dist = pos["trail_dist"]

            # 1) 물타기 체크
            if pos["total_margin"] < params["freeze_margin"]:
                last_p = pos["last_add_price"]
                if side == "long" and close <= last_p * (1 - ADD_STEP_PCT):
                    pos = add_to_position(pos, close)
                elif side == "short" and close >= last_p * (1 + ADD_STEP_PCT):
                    pos = add_to_position(pos, close)

            # 2) 청산(liquidation) 체크
            liq_hit = False
            if side == "long" and low <= pos["liq_price"]:
                liq_hit = True
                liq_loss = -(pos["total_margin"] * pos["remaining_frac"])
                pnl_cum += liq_loss
                pos["realized_pnl"] += liq_loss
                pos["remaining_frac"] = 0.0
            elif side == "short" and high >= pos["liq_price"]:
                liq_hit = True
                liq_loss = -(pos["total_margin"] * pos["remaining_frac"])
                pnl_cum += liq_loss
                pos["realized_pnl"] += liq_loss
                pos["remaining_frac"] = 0.0

            if liq_hit:
                record_trade(pos, ts, is_liq=True)
                pos = None
                cooldown_remaining = COOLDOWN_BARS
                update_equity_dd()
                continue

            # 3) TP1 / TP2 / 트레일링 (G-1 ATR 기반)
            if not pos["tp1_done"]:
                tp1_hit = ((side == "long" and close > sma8) or
                           (side == "short" and close < sma8))
                if tp1_hit:
                    pos, _ = close_partial(pos, close, 0.5)  # 50% 청산
                    pos["tp1_done"] = True
                    pos["trailing_active"] = True
                    pos["trail_peak"] = close

            elif pos["tp1_done"] and not pos["tp2_done"]:
                # G-1: ATR 트레일링 스탑 (TP1 이후)
                if pos["trailing_active"]:
                    if side == "long":
                        if close > pos["trail_peak"]:
                            pos["trail_peak"] = close
                        trail_stop = pos["trail_peak"] - trail_dist
                        if close <= trail_stop:
                            close_all(pos, close, reason="trailing_stop")
                            record_trade(pos, ts)
                            pos = None
                            cooldown_remaining = COOLDOWN_BARS
                            update_equity_dd()
                            continue
                    else:  # short
                        if close < pos["trail_peak"]:
                            pos["trail_peak"] = close
                        trail_stop = pos["trail_peak"] + trail_dist
                        if close >= trail_stop:
                            close_all(pos, close, reason="trailing_stop")
                            record_trade(pos, ts)
                            pos = None
                            cooldown_remaining = COOLDOWN_BARS
                            update_equity_dd()
                            continue

                # TP2 체크 (SMA25 돌파시 잔여의 50% = 전체 25% 청산)
                if pos is not None:
                    tp2_hit = ((side == "long" and close > sma25) or
                               (side == "short" and close < sma25))
                    if tp2_hit:
                        pos, _ = close_partial(pos, close, 0.5)
                        pos["tp2_done"] = True

            elif pos["tp1_done"] and pos["tp2_done"]:
                # G-1: 잔여 25% ATR 트레일링 스탑
                if pos["trailing_active"]:
                    if side == "long":
                        if close > pos["trail_peak"]:
                            pos["trail_peak"] = close
                        trail_stop = pos["trail_peak"] - trail_dist
                        if close <= trail_stop:
                            close_all(pos, close, reason="trailing_stop_final")
                            record_trade(pos, ts)
                            pos = None
                            cooldown_remaining = COOLDOWN_BARS
                            update_equity_dd()
                            continue
                    else:  # short
                        if close < pos["trail_peak"]:
                            pos["trail_peak"] = close
                        trail_stop = pos["trail_peak"] + trail_dist
                        if close >= trail_stop:
                            close_all(pos, close, reason="trailing_stop_final")
                            record_trade(pos, ts)
                            pos = None
                            cooldown_remaining = COOLDOWN_BARS
                            update_equity_dd()
                            continue

                # SMA25 이탈 시 잔여 청산
                if pos is not None:
                    sma25_exit = ((side == "long" and close < sma25) or
                                  (side == "short" and close > sma25))
                    if sma25_exit:
                        close_all(pos, close, reason="sma25_exit")
                        record_trade(pos, ts)
                        pos = None
                        cooldown_remaining = COOLDOWN_BARS

            # 포지션 완전 청산 처리
            if pos is not None and pos["remaining_frac"] < 0.001:
                record_trade(pos, ts)
                pos = None
                cooldown_remaining = COOLDOWN_BARS

        # 자산 고점/낙폭 업데이트
        update_equity_dd()

    # 마지막 오픈 포지션 강제 청산
    if pos is not None and pos["remaining_frac"] > 0:
        last_close = df["close"].iloc[-1]
        last_ts    = df.index[-1]
        close_all(pos, last_close, reason="end_of_data")
        record_trade(pos, last_ts)

    return trades, pnl_cum, max_dd, equity_peak, seed


# ── 결과 분석 ─────────────────────────────────────────────────────────────────
def analyze(trades, pnl_cum, max_dd, equity_peak, final_seed):
    if not trades:
        return "거래 없음", None

    df_t = pd.DataFrame(trades)
    df_t["year"] = df_t["close_ts"].dt.year

    yearly       = df_t.groupby("year")["realized_pnl"].sum()
    total_trades = len(df_t)
    wins         = (df_t["realized_pnl"] > 0).sum()
    win_rate     = wins / total_trades * 100
    liq_cnt      = df_t["liquidated"].sum()
    final_eq     = final_seed + pnl_cum

    return {
        "total_trades": total_trades,
        "win_rate":     win_rate,
        "liq_cnt":      liq_cnt,
        "yearly":       yearly,
        "pnl_cum":      pnl_cum,
        "final_seed":   final_seed,
        "final_equity": final_eq,
        "max_dd":       max_dd,
        "df_trades":    df_t,
    }


# ── 비교 기준 데이터 ───────────────────────────────────────────────────────────
ORIGINAL = {
    "total_trades": 1108,
    "win_rate":     53.1,
    "liq_cnt":      2,
    "yearly": {2021: -427.01, 2022: -526.53, 2023: 283.89,
               2024: 92.63,   2025: 207.48,  2026: -50.10},
    "pnl_cum":      -419.65,
    "final_seed":   1000,
    "final_equity": 580.35,
    "max_dd":       106.07,
}

V3 = {
    "total_trades": 143,
    "win_rate":     57.3,
    "liq_cnt":      0,
    "yearly": {2021: 156, 2022: 219, 2023: 312, 2024: 408, 2025: 531, 2026: 89},
    "pnl_cum":      1715,
    "final_seed":   1858,
    "final_equity": 2715,
    "max_dd":       6.2,
}

V4 = {
    "total_trades": 12,
    "win_rate":     41.7,
    "liq_cnt":      0,
    "yearly": {2021: 1, 2022: 0, 2023: -24, 2024: -17, 2025: 8, 2026: 0},
    "pnl_cum":      -32,
    "final_seed":   1016,
    "final_equity": 984,
    "max_dd":       4.7,
}


def build_report(v4fix):
    o   = ORIGINAL
    v3  = V3
    v4  = V4
    vfx = v4fix

    yrs = [2021, 2022, 2023, 2024, 2025, 2026]

    def fmt_pnl(val):
        sign = "+" if val >= 0 else "-"
        return f"{sign}${abs(val):,.0f}"

    lines = []
    lines.append("=" * 72)
    lines.append("   백테스트 비교: 기존 vs v3(best) vs v4(실패) vs v4-fix")
    lines.append("   기간: 2021-02-28 ~ 2026-02-28 | 초기시드: $1,000 | 5x")
    lines.append("=" * 72)
    lines.append(f"{'항목':<18} {'기존':>10} {'v3':>10} {'v4':>10} {'v4-fix':>10}")
    lines.append("─" * 72)
    lines.append(f"{'거래횟수':<18} {o['total_trades']:>8,}회 {v3['total_trades']:>8,}회 {v4['total_trades']:>8,}회 {vfx['total_trades']:>8,}회")
    lines.append(f"{'승률':<18} {o['win_rate']:>8.1f}% {v3['win_rate']:>8.1f}% {v4['win_rate']:>8.1f}% {vfx['win_rate']:>8.1f}%")
    lines.append(f"{'강제청산':<18} {o['liq_cnt']:>9}회 {v3['liq_cnt']:>9}회 {v4['liq_cnt']:>9}회 {int(vfx['liq_cnt']):>9}회")
    lines.append("─" * 72)

    for yr in yrs:
        o_val  = o["yearly"].get(yr, 0)
        v3_val = v3["yearly"].get(yr, 0)
        v4_val = v4["yearly"].get(yr, 0)
        fx_val = vfx["yearly"].get(yr, 0)
        lines.append(f"{str(yr) + ' 손익':<18} {fmt_pnl(o_val):>10} {fmt_pnl(v3_val):>10} {fmt_pnl(v4_val):>10} {fmt_pnl(fx_val):>10}")

    lines.append("─" * 72)
    lines.append(f"{'누적수익':<18} {fmt_pnl(o['pnl_cum']):>10} {fmt_pnl(v3['pnl_cum']):>10} {fmt_pnl(v4['pnl_cum']):>10} {fmt_pnl(vfx['pnl_cum']):>10}")
    o_seed  = "$" + f"{o['final_seed']:,.0f}"
    v3_seed = "$" + f"{v3['final_seed']:,.0f}"
    v4_seed = "$" + f"{v4['final_seed']:,.0f}"
    fx_seed = "$" + f"{vfx['final_seed']:,.0f}"
    lines.append(f"{'최종시드':<18} {o_seed:>10} {v3_seed:>10} {v4_seed:>10} {fx_seed:>10}")
    o_eq  = "$" + f"{o['final_equity']:,.0f}"
    v3_eq = "$" + f"{v3['final_equity']:,.0f}"
    v4_eq = "$" + f"{v4['final_equity']:,.0f}"
    fx_eq = "$" + f"{vfx['final_equity']:,.0f}"
    lines.append(f"{'최종자산':<18} {o_eq:>10} {v3_eq:>10} {v4_eq:>10} {fx_eq:>10}")
    lines.append(f"{'MDD':<18} {o['max_dd']:>8.1f}% {v3['max_dd']:>8.1f}% {v4['max_dd']:>8.1f}% {vfx['max_dd']:>8.1f}%")
    lines.append("=" * 72)

    return "\n".join(lines)


# ── 메인 ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    df = load_data()

    print(f"\n데이터 범위: {df.index[0]} ~ {df.index[-1]}")
    print(f"총 캔들 수 : {len(df)}")
    print("\n[v4-fix] 백테스트 실행 중...")
    print("  변경사항: F-3(3캔들→2캔들), I-1(3%→5%,4캔들→2캔들), F-1(R:R 2.0→1.5)")

    trades, pnl, mdd, peak, final_seed = run_backtest_v4fix(df)
    stats = analyze(trades, pnl, mdd, peak, final_seed)

    if isinstance(stats, str):
        print(stats)
    else:
        yearly_dict = {int(yr): float(p) for yr, p in stats["yearly"].items()}
        v4fix_for_report = {
            "total_trades": stats["total_trades"],
            "win_rate":     stats["win_rate"],
            "liq_cnt":      int(stats["liq_cnt"]),
            "yearly":       yearly_dict,
            "pnl_cum":      stats["pnl_cum"],
            "final_seed":   stats["final_seed"],
            "final_equity": stats["final_equity"],
            "max_dd":       stats["max_dd"],
        }

        report = build_report(v4fix_for_report)
        print("\n" + report)

        out_path = "/Users/fireant/.openclaw/workspace/backtest_result_v4fix.txt"
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(report)
            f.write("\n\n[v4-fix 거래 내역 (최근 50건)]\n")
            f.write(stats["df_trades"].tail(50).to_string())
        print(f"\n결과 저장 완료: {out_path}")
