"""
불개미 매매 원칙 최종 백테스트 — v4-fix + 복리 변형B
BTC 선물 (BTCUSDT), $1,000 초기 시드
기간: 2021-02-28 ~ 2026-02-28 UTC

v4-fix 기반, 복리 파라미터 변형B 적용:
  REINVEST_RATIO : 0.50 → 0.80  (수익의 80% 재투자)
  REINVEST_DAYS  : 30  → 14     (14일 주기)
  MAX_SEED       : 10000 → 20000 (시드 상한 $20,000)
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
MAX_SEED        = 20000.0   # 변형B: 시드 상한 $20,000 (v4-fix: 10000)
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

# 변형B: 14일 주기, 80% 재투자
REINVEST_DAYS   = 14        # v4-fix: 30 → 변형B: 14
REINVEST_RATIO  = 0.80      # v4-fix: 0.50 → 변형B: 0.80

# 역피라미딩 비율 (시드 기준) — 재투자 후 재계산
ADD_RATIOS = [0.02, 0.03, 0.05]  # 1차 2%, 2차 3%, 3차 이후 5%

# F-1 완화: R:R 최소 비율 1.5
RR_MIN          = 1.5

# I-1 완화: 변동성 폭발 임계값 5%
VOL_SPIKE_THRESH = 0.05     # 5% 이상 진폭 = 폭발


def seed_params(seed):
    """시드 기준으로 마진 파라미터 반환"""
    return {
        "init_margin":    seed * 0.20,
        "max_margin":     seed * 1.00,
        "freeze_margin":  seed * 0.80,
    }


def add_margin_for_count(seed, add_count):
    """물타기 횟수(0-indexed)에 따른 추가 마진 (시드 기준 비율)"""
    if add_count < len(ADD_RATIOS):
        ratio = ADD_RATIOS[add_count]
    else:
        ratio = ADD_RATIOS[-1]
    return seed * ratio


# ── 백테스트 엔진 (v4-fix + 변형B) ───────────────────────────────────────────
def run_backtest_final(df):
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

    # F-3 완화: 고점·저점 구조 (직전 2캔들만 비교)
    df["low_1"]  = df["low"].shift(1)
    df["low_2"]  = df["low"].shift(2)
    df["high_1"] = df["high"].shift(1)
    df["high_2"] = df["high"].shift(2)
    df["hl_structure"] = df["low_1"] > df["low_2"]
    df["lh_structure"] = df["high_1"] < df["high_2"]

    # I-1 완화: 변동성 폭발 구간 감지 (직전 2캔들, 임계값 5%)
    for i in range(1, 3):
        df[f"candle_range_{i}"] = (df["high"].shift(i) - df["low"].shift(i)) / df["close"].shift(i)
    df["vol_spike"] = (
        (df["candle_range_1"] >= VOL_SPIKE_THRESH) |
        (df["candle_range_2"] >= VOL_SPIKE_THRESH)
    )

    # ── 상태 변수 ──────────────────────────────────────────────────────────────
    seed           = INIT_SEED
    pnl_cum        = 0.0
    equity_peak    = seed
    max_dd         = 0.0
    pos            = None
    trades         = []
    cooldown_remaining = 0

    # 변형B: 14일 주기 재투자 추적
    last_reinvest_ts    = None   # 첫 유효 캔들에서 초기화
    pnl_at_last_reinvest = 0.0

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

    def check_reinvest(ts):
        """변형B: 14일 주기 재투자 체크 (수익 기간만, 80%)"""
        nonlocal seed, last_reinvest_ts, pnl_at_last_reinvest, equity_peak
        if last_reinvest_ts is None:
            return
        days_elapsed = (ts - last_reinvest_ts).days
        if days_elapsed >= REINVEST_DAYS:
            period_pnl = pnl_cum - pnl_at_last_reinvest
            if period_pnl > 0:  # 수익 기간만 재투자, 손실 기간 스킵
                new_seed = min(seed + period_pnl * REINVEST_RATIO, MAX_SEED)
                if new_seed > seed:
                    seed = new_seed
                    if seed + pnl_cum > equity_peak:
                        equity_peak = seed + pnl_cum
            pnl_at_last_reinvest = pnl_cum
            last_reinvest_ts = ts

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
            if last_reinvest_ts is None and not pd.isna(h24):
                last_reinvest_ts     = ts
                pnl_at_last_reinvest = pnl_cum
            continue

        # 최초 유효 캔들에서 재투자 타이머 시작
        if last_reinvest_ts is None:
            last_reinvest_ts     = ts
            pnl_at_last_reinvest = pnl_cum

        # 쿨다운 감소
        if cooldown_remaining > 0:
            cooldown_remaining -= 1

        # 변형B: 14일 재투자 체크
        check_reinvest(ts)

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

            # 1) 물타기 체크 (현재 시드 기준 비율로 계산)
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

V2 = {
    "total_trades": 140,
    "win_rate":     55.7,
    "liq_cnt":      0,
    "yearly": {2021: -14, 2022: 0, 2023: 46, 2024: 23, 2025: 85, 2026: 0},
    "pnl_cum":      139,
    "final_seed":   1000,
    "final_equity": 1139,
    "max_dd":       8.7,
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

V4FIX = {
    "total_trades": 38,
    "win_rate":     60.5,
    "liq_cnt":      0,
    "yearly": {2021: -39, 2022: 0, 2023: 62, 2024: 34, 2025: 24, 2026: 0},
    "pnl_cum":      82,
    "final_seed":   1103,
    "final_equity": 1185,
    "max_dd":       6.6,
}


def build_report(vfinal, rules_text):
    o   = ORIGINAL
    v2  = V2
    v3  = V3
    vfx = V4FIX
    vf  = vfinal

    yrs = [2021, 2022, 2023, 2024, 2025, 2026]

    def fmt_pnl(val):
        sign = "+" if val >= 0 else "-"
        return f"{sign}${abs(val):,.0f}"

    lines = []
    lines.append("=" * 72)
    lines.append("   불개미 매매 원칙 백테스트 최종 결과")
    lines.append("   기간: 2021-02-28 ~ 2026-02-28 | 초기시드: $1,000 | 5x")
    lines.append("=" * 72)
    lines.append(f"{'항목':<16} {'기존':>10} {'v2':>8} {'v3':>8} {'v4-fix':>8} {'최종(B)':>9}")
    lines.append("─" * 72)
    lines.append(
        f"{'거래횟수':<16} {o['total_trades']:>8,}회 {v2['total_trades']:>6,}회 "
        f"{v3['total_trades']:>6,}회 {vfx['total_trades']:>6,}회 {vf['total_trades']:>7,}회"
    )
    lines.append(
        f"{'승률':<16} {o['win_rate']:>8.1f}% {v2['win_rate']:>6.1f}% "
        f"{v3['win_rate']:>6.1f}% {vfx['win_rate']:>6.1f}% {vf['win_rate']:>7.1f}%"
    )
    lines.append(
        f"{'강제청산':<16} {o['liq_cnt']:>9}회 {v2['liq_cnt']:>6}회 "
        f"{v3['liq_cnt']:>6}회 {vfx['liq_cnt']:>6}회 {int(vf['liq_cnt']):>7}회"
    )
    lines.append("─" * 72)

    for yr in yrs:
        o_val  = o["yearly"].get(yr, 0)
        v2_val = v2["yearly"].get(yr, 0)
        v3_val = v3["yearly"].get(yr, 0)
        fx_val = vfx["yearly"].get(yr, 0)
        f_val  = vf["yearly"].get(yr, 0)
        lines.append(
            f"{str(yr) + ' 손익':<16} {fmt_pnl(o_val):>10} {fmt_pnl(v2_val):>8} "
            f"{fmt_pnl(v3_val):>8} {fmt_pnl(fx_val):>8} {fmt_pnl(f_val):>9}"
        )

    lines.append("─" * 72)
    lines.append(
        f"{'누적수익':<16} {fmt_pnl(o['pnl_cum']):>10} {fmt_pnl(v2['pnl_cum']):>8} "
        f"{fmt_pnl(v3['pnl_cum']):>8} {fmt_pnl(vfx['pnl_cum']):>8} {fmt_pnl(vf['pnl_cum']):>9}"
    )
    o_seed  = "$" + f"{o['final_seed']:,.0f}"
    v2_seed = "$" + f"{v2['final_seed']:,.0f}"
    v3_seed = "$" + f"{v3['final_seed']:,.0f}"
    fx_seed = "$" + f"{vfx['final_seed']:,.0f}"
    f_seed  = "$" + f"{vf['final_seed']:,.0f}"
    lines.append(
        f"{'최종시드':<16} {o_seed:>10} {v2_seed:>8} {v3_seed:>8} {fx_seed:>8} {f_seed:>9}"
    )
    o_eq  = "$" + f"{o['final_equity']:,.0f}"
    v2_eq = "$" + f"{v2['final_equity']:,.0f}"
    v3_eq = "$" + f"{v3['final_equity']:,.0f}"
    fx_eq = "$" + f"{vfx['final_equity']:,.0f}"
    f_eq  = "$" + f"{vf['final_equity']:,.0f}"
    lines.append(
        f"{'최종자산':<16} {o_eq:>10} {v2_eq:>8} {v3_eq:>8} {fx_eq:>8} {f_eq:>9}"
    )
    lines.append(
        f"{'MDD':<16} {o['max_dd']:>8.1f}% {v2['max_dd']:>6.1f}% "
        f"{v3['max_dd']:>6.1f}% {vfx['max_dd']:>6.1f}% {vf['max_dd']:>7.1f}%"
    )
    lines.append("=" * 72)
    lines.append("")
    lines.append(rules_text)

    return "\n".join(lines)


RULES_TEXT = """
★ 최종 확정 규칙 요약
════════════════════════════════════════════════════════════════════════

【기본 원칙 — 불변】
 1. 거래소: BTC/USDT 선물, 레버리지 5x
 2. 초기 시드: $1,000
 3. 수수료: 0.04% (메이커/테이커)
 4. 청산 비율: 20% (마진 20% 손실 시 청산)

【v2 추가 규칙】
 B-1. 쿨다운: 청산/손절 후 24시간(24캔들) 진입 금지
 B-2. 추세 필터: 150일 MA (MA150) 위에서만 롱, 아래에서만 숏
 B-3. 거래량 확인: 현재 거래량 ≥ 20캔들 평균 × 1.5배
 B-4. 직전 캔들 방향 일치: 롱은 직전 캔들 양봉, 숏은 음봉
 B-5. 진입 조건: 24시간 고점 × 0.965 이하(롱) / × 1.045 이상(숏)
 B-6. 역피라미딩(물타기): 0.5% 이격마다 추가 진입
       1차: 시드×2%, 2차: 시드×3%, 3차 이후: 시드×5%
 B-7. 동결 임계: 총 마진이 시드×80% 도달 시 물타기 중단
 B-8. 최대 마진: 시드×100% (시드 전액 한도)

【v3 추가 규칙】
 C-1. TP1: SMA8 돌파 시 포지션 50% 청산
 C-2. TP2: SMA25 돌파 시 잔여 50% 청산 (전체 25%)
 C-3. TP2 이후 잔여 25%는 SMA25 이탈 시 청산
 H-1. 복리 재투자: 30일 주기, 기간 수익의 50% 시드에 추가
 H-2. 시드 상한: $10,000

【v4-fix 추가 규칙 (완화 조정)】
 F-1. R:R 필터: 진입 시 기대 R:R ≥ 1.5 (TP까지 거리/SL까지 거리)
       * v4는 2.0이었으나 v4-fix에서 1.5로 완화
 F-3. HL 구조 필터: 직전 2캔들 저점 상승(롱) / 고점 하락(숏) 확인
       * v4는 3캔들 비교였으나 v4-fix에서 2캔들로 완화
 G-1. ATR14 기반 트레일링 스탑: TP1 이후 trail_dist = ATR14 × 1.0
 I-1. 변동성 폭발 차단: 직전 2캔들 진폭 ≥ 5% 시 진입 금지
       * v4는 3%, 4캔들이었으나 v4-fix에서 5%, 2캔들로 완화

【최종 변형B — 복리 설정】
 ★ REINVEST_RATIO : 0.80  (기간 수익의 80% 재투자)
 ★ REINVEST_DAYS  : 14    (14일 주기, v4-fix 30일 → 단축)
 ★ MAX_SEED       : 20000 (시드 상한 $20,000, v4-fix $10,000 → 확대)
 ★ 손실 기간 스킵: 14일 기간 손익이 0 이하이면 재투자 없음
 ★ 물타기 금액 재계산: 재투자 후 새 시드 기준으로 비율 자동 갱신

════════════════════════════════════════════════════════════════════════
"""


# ── 메인 ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    df = load_data()

    print(f"\n데이터 범위: {df.index[0]} ~ {df.index[-1]}")
    print(f"총 캔들 수 : {len(df)}")
    print("\n[최종B] 백테스트 실행 중 (v4-fix + 복리 변형B)...")
    print("  변형B: REINVEST_RATIO=0.80, REINVEST_DAYS=14, MAX_SEED=20000")

    trades, pnl, mdd, peak, final_seed = run_backtest_final(df)
    stats = analyze(trades, pnl, mdd, peak, final_seed)

    if isinstance(stats, str):
        print(stats)
    else:
        yearly_dict = {int(yr): float(p) for yr, p in stats["yearly"].items()}
        vfinal_for_report = {
            "total_trades": stats["total_trades"],
            "win_rate":     stats["win_rate"],
            "liq_cnt":      int(stats["liq_cnt"]),
            "yearly":       yearly_dict,
            "pnl_cum":      stats["pnl_cum"],
            "final_seed":   stats["final_seed"],
            "final_equity": stats["final_equity"],
            "max_dd":       stats["max_dd"],
        }

        report = build_report(vfinal_for_report, RULES_TEXT)
        print("\n" + report)

        # 결과 파일 저장
        result_path = "/Users/fireant/.openclaw/workspace/backtest_final_result.txt"
        with open(result_path, "w", encoding="utf-8") as f:
            f.write(report)
            f.write("\n\n[최종B 거래 내역 (최근 50건)]\n")
            f.write(stats["df_trades"].tail(50).to_string())
        print(f"\n결과 저장 완료: {result_path}")
