"""
불개미 매매 원칙 개선판 v3 백테스트
BTC 선물 (BTCUSDT), $1,000 초기 시드
기간: 2021-02-28 ~ 2026-02-28 UTC

v2 대비 변경 규칙 (6개):
  A-3. 트레일링 스탑 (본절 고정 → 트레일링)
       TP1 이후 breakeven 제거, trailing stop -1.5%(롱) / +1.5%(숏)
  B-1. 쿨다운 48h → 24h
  B-2. MA200 → MA150 필터
  C-1. 분기별 시드 재투자 (91일, 수익 50%, 최대 $5,000)
  D-2. 물타기 역피라미딩 (1차 2%, 2차 3%, 3차↑ 5%)
  E-2. 거래량 필터 (volume > vol_ma20 × 1.5)
"""

import os
import pickle
import requests
import pandas as pd
import numpy as np
import time
from datetime import datetime, timezone

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


# ── 백테스트 파라미터 (기본값, 시드 변경 시 재계산) ──────────────────────────
INIT_SEED       = 1000.0    # 초기 시드
MAX_SEED        = 5000.0    # 시드 상한 (C-1)
FEE_RATE        = 0.0004    # 0.04% 수수료
LEV             = 5         # 레버리지
LIQ_RATIO       = 0.20      # 청산 비율

ENTRY_LONG_PCT  = 0.965     # H24 × 0.965 이하 → 롱 신호
ENTRY_SHORT_PCT = 1.045     # H24 × 1.045 이상 → 숏 신호
ADD_STEP_PCT    = 0.005     # 물타기 간격 0.5%

MA150_WINDOW    = 150 * 24  # 3600 (B-2)
COOLDOWN_BARS   = 24        # 24시간 쿨다운 (B-1)

TRAILING_PCT    = 0.015     # 트레일링 스탑 -1.5% / +1.5% (A-3)

QUARTER_DAYS    = 91        # 분기 기간 (C-1)

# 역피라미딩 비율 (시드 기준) — D-2
ADD_RATIOS = [0.02, 0.03, 0.05]  # 1차 2%, 2차 3%, 3차 이후 5%


def seed_params(seed):
    """시드 기준으로 마진 파라미터 반환"""
    return {
        "init_margin":    seed * 0.20,
        "max_margin":     seed * 1.00,
        "freeze_margin":  seed * 0.80,
    }


def add_margin_for_count(seed, add_count):
    """물타기 횟수(0-indexed)에 따른 추가 마진 — D-2"""
    if add_count < len(ADD_RATIOS):
        ratio = ADD_RATIOS[add_count]
    else:
        ratio = ADD_RATIOS[-1]  # 3차 이후 5% 고정
    return seed * ratio


# ── 백테스트 엔진 (v3) ──────────────────────────────────────────────────────────
def run_backtest_v3(df):
    df = df.copy()

    # 사전 계산
    df["sma8"]    = df["close"].rolling(8).mean()
    df["sma25"]   = df["close"].rolling(25).mean()
    df["ma150"]   = df["close"].rolling(MA150_WINDOW).mean()   # B-2
    df["h24"]     = df["high"].rolling(24).max().shift(1)
    df["prev_open"]  = df["open"].shift(1)
    df["prev_close"] = df["close"].shift(1)
    df["volume"]  = df["volume"].astype(float)
    df["vol_ma20"] = df["volume"].rolling(20).mean()            # E-2

    # ── 상태 변수 ──────────────────────────────────────────────────────────────
    seed           = INIT_SEED
    pnl_cum        = 0.0
    equity_peak    = seed
    max_dd         = 0.0
    pos            = None
    trades         = []
    cooldown_remaining = 0

    # C-1: 분기 추적
    quarter_start_ts   = None
    quarter_start_pnl  = pnl_cum   # 분기 시작 시점 누적 손익

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

    def open_position(side, price, ts):
        nonlocal pnl_cum
        params = seed_params(seed)
        init_m = params["init_margin"]
        fee = init_m * LEV * FEE_RATE
        pnl_cum -= fee
        entries = [(price, init_m)]
        avg_p = calc_avg_price(entries)
        return {
            "side":            side,
            "entries":         entries,
            "total_margin":    init_m,
            "avg_price":       avg_p,
            "liq_price":       calc_liq(side, avg_p),
            "last_add_price":  price,
            "add_count":       0,       # 물타기 횟수 카운터 (D-2)
            "tp1_done":        False,
            "tp2_done":        False,
            "trail_peak":      price,   # A-3: 트레일링용 피크 가격 (TP1 이후 활성)
            "trailing_active": False,   # A-3: TP1 이후 활성
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
        add_m = add_margin_for_count(seed, pos["add_count"])  # D-2
        add_m = min(add_m, max_m - pos["total_margin"])
        if add_m <= 0:
            return pos
        fee = add_m * LEV * FEE_RATE
        pnl_cum -= fee
        pos["entries"].append((price, add_m))
        pos["total_margin"] += add_m
        pos["realized_pnl"] -= fee
        pos["add_count"] += 1   # 물타기 횟수 증가
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

    def check_quarter(ts):
        """C-1: 분기 종료 체크 및 시드 재투자"""
        nonlocal seed, quarter_start_ts, quarter_start_pnl, equity_peak
        if quarter_start_ts is None:
            return
        elapsed_days = (ts - quarter_start_ts).total_seconds() / 86400
        if elapsed_days >= QUARTER_DAYS:
            # 이번 분기 수익
            quarter_pnl = pnl_cum - quarter_start_pnl
            if quarter_pnl > 0:
                reinvest = quarter_pnl * 0.50
                new_seed = min(seed + reinvest, MAX_SEED)
                if new_seed > seed:
                    seed = new_seed
                    if seed + pnl_cum > equity_peak:
                        equity_peak = seed + pnl_cum
            # 다음 분기 시작
            quarter_start_ts  = ts
            quarter_start_pnl = pnl_cum

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

        # NaN 건너뜀 (초기 구간)
        if (pd.isna(h24) or pd.isna(sma8) or pd.isna(sma25)
                or pd.isna(ma150) or pd.isna(prev_open) or pd.isna(prev_close)
                or pd.isna(vol_ma20)):
            # 분기 시작 초기화 (첫 유효 캔들)
            if quarter_start_ts is None and not pd.isna(h24):
                quarter_start_ts  = ts
                quarter_start_pnl = pnl_cum
            continue

        # 분기 시작 초기화
        if quarter_start_ts is None:
            quarter_start_ts  = ts
            quarter_start_pnl = pnl_cum

        # 쿨다운 감소
        if cooldown_remaining > 0:
            cooldown_remaining -= 1

        # C-1: 분기 종료 체크
        check_quarter(ts)

        # ── 포지션 없음: 진입 탐색 ─────────────────────────────────────────────
        if pos is None:
            if cooldown_remaining > 0:
                pass
            else:
                # B-2: MA150 필터
                trend_bull = (close > ma150)
                trend_bear = (close < ma150)

                # 반등 확인 (v2 유지)
                prev_bullish = (prev_close > prev_open)
                prev_bearish = (prev_close < prev_open)

                # E-2: 거래량 필터
                vol_ok = (volume > vol_ma20 * 1.5)

                long_signal  = (close <= h24 * ENTRY_LONG_PCT)
                short_signal = (close >= h24 * ENTRY_SHORT_PCT)

                if long_signal and trend_bull and prev_bullish and vol_ok:
                    pos = open_position("long", close, ts)
                elif short_signal and trend_bear and prev_bearish and vol_ok:
                    pos = open_position("short", close, ts)

        # ── 포지션 있음 ────────────────────────────────────────────────────────
        else:
            side = pos["side"]
            params = seed_params(seed)

            # 1) 물타기 체크 (D-2: 역피라미딩, 80% 동결)
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
                equity = seed + pnl_cum
                if equity > equity_peak:
                    equity_peak = equity
                dd = (equity_peak - equity) / equity_peak * 100
                if dd > max_dd:
                    max_dd = dd
                continue

            # 3) TP 및 트레일링 스탑 체크
            if not pos["tp1_done"]:
                tp1_hit = ((side == "long" and close > sma8) or
                           (side == "short" and close < sma8))
                if tp1_hit:
                    pos, _ = close_partial(pos, close, 0.5)  # 50% 청산
                    pos["tp1_done"] = True
                    # A-3: 트레일링 스탑 활성화 (breakeven 없음)
                    pos["trailing_active"] = True
                    pos["trail_peak"]      = close  # 기준 피크 초기화

            elif pos["tp1_done"] and not pos["tp2_done"]:
                # A-3: 트레일링 스탑 업데이트
                if pos["trailing_active"]:
                    if side == "long":
                        if close > pos["trail_peak"]:
                            pos["trail_peak"] = close
                        trail_stop = pos["trail_peak"] * (1 - TRAILING_PCT)
                        if close <= trail_stop:
                            close_all(pos, close, reason="trailing_stop")
                            record_trade(pos, ts)
                            pos = None
                            cooldown_remaining = COOLDOWN_BARS
                            # 자산 업데이트 후 continue
                            equity = seed + pnl_cum
                            if equity > equity_peak:
                                equity_peak = equity
                            dd = (equity_peak - equity) / equity_peak * 100
                            if dd > max_dd:
                                max_dd = dd
                            continue
                    else:  # short
                        if close < pos["trail_peak"]:
                            pos["trail_peak"] = close
                        trail_stop = pos["trail_peak"] * (1 + TRAILING_PCT)
                        if close >= trail_stop:
                            close_all(pos, close, reason="trailing_stop")
                            record_trade(pos, ts)
                            pos = None
                            cooldown_remaining = COOLDOWN_BARS
                            equity = seed + pnl_cum
                            if equity > equity_peak:
                                equity_peak = equity
                            dd = (equity_peak - equity) / equity_peak * 100
                            if dd > max_dd:
                                max_dd = dd
                            continue

                # TP2 체크 (SMA25 돌파시 25% 청산)
                if pos is not None:
                    tp2_hit = ((side == "long" and close > sma25) or
                               (side == "short" and close < sma25))
                    if tp2_hit:
                        pos, _ = close_partial(pos, close, 0.5)  # 잔여의 50% = 전체 25%
                        pos["tp2_done"] = True
                        # 트레일링 계속 유지 (잔여 25%도 트레일링으로 관리)

            elif pos["tp1_done"] and pos["tp2_done"]:
                # A-3: 잔여 25% 트레일링 스탑으로 관리
                if pos["trailing_active"]:
                    if side == "long":
                        if close > pos["trail_peak"]:
                            pos["trail_peak"] = close
                        trail_stop = pos["trail_peak"] * (1 - TRAILING_PCT)
                        if close <= trail_stop:
                            close_all(pos, close, reason="trailing_stop_final")
                            record_trade(pos, ts)
                            pos = None
                            cooldown_remaining = COOLDOWN_BARS
                            equity = seed + pnl_cum
                            if equity > equity_peak:
                                equity_peak = equity
                            dd = (equity_peak - equity) / equity_peak * 100
                            if dd > max_dd:
                                max_dd = dd
                            continue
                    else:  # short
                        if close < pos["trail_peak"]:
                            pos["trail_peak"] = close
                        trail_stop = pos["trail_peak"] * (1 + TRAILING_PCT)
                        if close >= trail_stop:
                            close_all(pos, close, reason="trailing_stop_final")
                            record_trade(pos, ts)
                            pos = None
                            cooldown_remaining = COOLDOWN_BARS
                            equity = seed + pnl_cum
                            if equity > equity_peak:
                                equity_peak = equity
                            dd = (equity_peak - equity) / equity_peak * 100
                            if dd > max_dd:
                                max_dd = dd
                            continue

                # SMA25 이탈 시 청산 (잔여 포지션 보호)
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
        equity = seed + pnl_cum
        if equity > equity_peak:
            equity_peak = equity
        dd = (equity_peak - equity) / equity_peak * 100
        if dd > max_dd:
            max_dd = dd

    # 마지막 오픈 포지션 강제 청산
    if pos is not None and pos["remaining_frac"] > 0:
        last_close = df["close"].iloc[-1]
        last_ts    = df.index[-1]
        close_all(pos, last_close, reason="end_of_data")
        record_trade(pos, last_ts)

    return trades, pnl_cum, max_dd, equity_peak, seed


# ── 결과 분석 ─────────────────────────────────────────────────────────────────
def analyze_v3(trades, pnl_cum, max_dd, equity_peak, final_seed):
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


# ── 비교 리포트 출력 ───────────────────────────────────────────────────────────
ORIGINAL = {
    "total_trades": 1108,
    "win_rate":     53.1,
    "liq_cnt":      2,
    "yearly": {2021: -427.01, 2022: -526.53, 2023: 283.89,
               2024: 92.63,   2025: 207.48,  2026: -50.10},
    "pnl_cum":      -419.65,
    "final_equity": 580.35,
    "max_dd":       106.07,
}

V2 = {
    "total_trades": 140,
    "win_rate":     55.7,
    "liq_cnt":      0,
    "yearly": {2021: -14, 2022: 0, 2023: 46, 2024: 23, 2025: 85, 2026: 0},
    "pnl_cum":      139,
    "final_equity": 1139,
    "max_dd":       8.7,
}


def build_report(v3):
    o = ORIGINAL
    v2 = V2
    v3r = v3

    yrs = [2021, 2022, 2023, 2024, 2025, 2026]

    def fmt_pnl(val):
        sign = "+" if val >= 0 else "-"
        return f"{sign}${abs(val):,.0f}"

    lines = []
    lines.append("=" * 68)
    lines.append("   백테스트 비교: 기존 vs v2(5규칙) vs v3(6규칙)")
    lines.append("   기간: 2021-02-28 ~ 2026-02-28 | 시드: $1,000(초기) | 5x")
    lines.append("=" * 68)
    lines.append(f"{'항목':<22} {'기존':>12} {'v2':>12} {'v3':>12}")
    lines.append("─" * 68)
    lines.append(f"{'총 거래 횟수':<22} {o['total_trades']:>10,}회 {v2['total_trades']:>10,}회 {v3r['total_trades']:>10,}회")
    lines.append(f"{'승률':<22} {o['win_rate']:>10.1f}% {v2['win_rate']:>10.1f}% {v3r['win_rate']:>10.1f}%")
    lines.append(f"{'강제청산':<22} {o['liq_cnt']:>11}회 {v2['liq_cnt']:>11}회 {int(v3r['liq_cnt']):>11}회")
    lines.append("─" * 68)

    for yr in yrs:
        o_val  = o["yearly"].get(yr, 0)
        v2_val = v2["yearly"].get(yr, 0)
        v3_val = v3r["yearly"].get(yr, 0)
        lines.append(f"{str(yr) + ' 손익':<22} {fmt_pnl(o_val):>12} {fmt_pnl(v2_val):>12} {fmt_pnl(v3_val):>12}")

    lines.append("─" * 68)
    lines.append(f"{'누적 수익':<22} {fmt_pnl(o['pnl_cum']):>12} {fmt_pnl(v2['pnl_cum']):>12} {fmt_pnl(v3r['pnl_cum']):>12}")
    final_seed_str = "$" + f"{v3r['final_seed']:,.0f}"
    lines.append(f"{'최종 시드':<22} {'$1,000':>12} {'$1,000':>12} {final_seed_str:>12}   ← C-1 효과")
    o_eq  = "$" + f"{o['final_equity']:,.0f}"
    v2_eq = "$" + f"{v2['final_equity']:,.0f}"
    v3_eq = "$" + f"{v3r['final_equity']:,.0f}"
    lines.append(f"{'최종 자산':<22} {o_eq:>12} {v2_eq:>12} {v3_eq:>12}")
    lines.append(f"{'최대낙폭(MDD)':<22} {o['max_dd']:>10.1f}% {v2['max_dd']:>10.1f}% {v3r['max_dd']:>10.1f}%")
    lines.append("=" * 68)

    return "\n".join(lines)


# ── 메인 ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    df = load_data()

    print(f"\n데이터 범위: {df.index[0]} ~ {df.index[-1]}")
    print(f"총 캔들 수 : {len(df)}")
    print("\n[v3] 백테스트 실행 중...")

    trades_v3, pnl_v3, mdd_v3, peak_v3, final_seed_v3 = run_backtest_v3(df)
    v3_stats = analyze_v3(trades_v3, pnl_v3, mdd_v3, peak_v3, final_seed_v3)

    if isinstance(v3_stats, str):
        print(v3_stats)
    else:
        yearly_dict = {int(yr): float(pnl)
                       for yr, pnl in v3_stats["yearly"].items()}
        v3_for_report = {
            "total_trades": v3_stats["total_trades"],
            "win_rate":     v3_stats["win_rate"],
            "liq_cnt":      int(v3_stats["liq_cnt"]),
            "yearly":       yearly_dict,
            "pnl_cum":      v3_stats["pnl_cum"],
            "final_seed":   v3_stats["final_seed"],
            "final_equity": v3_stats["final_equity"],
            "max_dd":       v3_stats["max_dd"],
        }

        report = build_report(v3_for_report)
        print("\n" + report)

        # 저장
        out_path = "/Users/fireant/.openclaw/workspace/backtest_result_v3.txt"
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(report)
            f.write("\n\n[v3 거래 내역 (최근 50건)]\n")
            f.write(v3_stats["df_trades"].tail(50).to_string())
        print(f"\n결과 저장 완료: {out_path}")
