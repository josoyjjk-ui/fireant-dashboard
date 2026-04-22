"""
불개미 매매 원칙 개선판 5년 백테스트 (v2)
BTC 선물 (BTCUSDT), $1,000 시드
기간: 2021-02-28 ~ 2026-02-28 UTC

개선 규칙:
  ① 일봉 MA200 추세 필터 (4800개 1h SMA 근사)
  ② 물타기 기준 % 통일 (직전 물타기가 대비 0.5%)
  ③ 48시간 쿨다운
  ④ 반등 확인 후 진입 (직전 캔들 방향 확인)
  ⑤ 80% 소진시 물타기 동결
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

# ── 바이낸스 선물 캔들 데이터 수집 ─────────────────────────────────────────────
def fetch_klines(symbol="BTCUSDT", interval="1h", start_ts=None, end_ts=None):
    url = "https://fapi.binance.com/fapi/v1/klines"
    all_data = []
    current_start = start_ts

    print("데이터 수집 중...")
    while True:
        params = {
            "symbol": symbol,
            "interval": interval,
            "startTime": current_start,
            "endTime": end_ts,
            "limit": 1000
        }
        resp = requests.get(url, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()

        if not data:
            break

        all_data.extend(data)
        last_open_time = data[-1][0]

        if len(data) < 1000:
            break

        current_start = last_open_time + 3600000  # 1h in ms

        if current_start >= end_ts:
            break

        time.sleep(0.2)
        print(f"  수집됨: {len(all_data)} 캔들 "
              f"(마지막: {datetime.fromtimestamp(last_open_time/1000, tz=timezone.utc)})")

    print(f"총 {len(all_data)} 캔들 수집 완료")
    return all_data


def build_df(raw):
    df = pd.DataFrame(raw, columns=[
        "open_time", "open", "high", "low", "close",
        "volume", "close_time", "qav", "num_trades",
        "tbbav", "tbqav", "ignore"
    ])
    df["open_time"] = pd.to_datetime(df["open_time"], unit="ms", utc=True)
    for col in ["open", "high", "low", "close"]:
        df[col] = df[col].astype(float)
    df = df.set_index("open_time").sort_index()
    return df


def load_data():
    """캐시가 있으면 재사용, 없으면 다운로드 후 저장"""
    if os.path.exists(CACHE_FILE):
        print(f"캐시 로드: {CACHE_FILE}")
        with open(CACHE_FILE, "rb") as f:
            df = pickle.load(f)
        print(f"캐시 로드 완료: {len(df)} 캔들 ({df.index[0]} ~ {df.index[-1]})")
        return df

    START_DT = datetime(2021, 2, 28, tzinfo=timezone.utc)
    END_DT   = datetime(2026, 2, 28, tzinfo=timezone.utc)
    START_MS = int(START_DT.timestamp() * 1000)
    END_MS   = int(END_DT.timestamp() * 1000)

    raw = fetch_klines("BTCUSDT", "1h", START_MS, END_MS)
    df  = build_df(raw)

    with open(CACHE_FILE, "wb") as f:
        pickle.dump(df, f)
    print(f"캐시 저장: {CACHE_FILE}")
    return df


# ── 백테스트 파라미터 ──────────────────────────────────────────────────────────
FEE_RATE        = 0.0004    # 0.04% 수수료
SEED            = 1000.0    # 고정 시드
INIT_MARGIN     = 200.0     # 첫 진입 마진 (20%)
ADD_MARGIN      = 20.0      # 물타기 마진 (2%)
MAX_MARGIN      = 1000.0    # 최대 총 마진
FREEZE_MARGIN   = 800.0     # 물타기 동결 임계값 (80%) ← 규칙⑤
LEV             = 5         # 레버리지
LIQ_RATIO       = 0.20      # 청산 비율

ENTRY_LONG_PCT  = 0.965     # H24 × 0.965 이하 → 롱 신호
ENTRY_SHORT_PCT = 1.045     # H24 × 1.045 이상 → 숏 신호
ADD_STEP_PCT    = 0.005     # 물타기 간격 0.5% ← 규칙②
MA200_WINDOW    = 4800      # 일봉 MA200 근사 (200일 × 24h) ← 규칙①
COOLDOWN_BARS   = 48        # 48시간 쿨다운 ← 규칙③


# ── 백테스트 엔진 (v2) ──────────────────────────────────────────────────────────
def run_backtest_v2(df):
    df = df.copy()

    # 사전 계산
    df["sma8"]   = df["close"].rolling(8).mean()
    df["sma25"]  = df["close"].rolling(25).mean()
    df["ma200"]  = df["close"].rolling(MA200_WINDOW).mean()   # 규칙①
    df["h24"]    = df["high"].rolling(24).max().shift(1)       # 직전 24h 고가
    df["prev_open"]  = df["open"].shift(1)                     # 규칙④: 직전 캔들 open
    df["prev_close"] = df["close"].shift(1)                    # 규칙④: 직전 캔들 close

    pnl_cum    = 0.0
    equity_peak = SEED
    max_dd     = 0.0
    pos        = None
    trades     = []
    cooldown_remaining = 0  # 남은 쿨다운 캔들 수 ← 규칙③

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
        fee = INIT_MARGIN * LEV * FEE_RATE
        pnl_cum -= fee
        entries = [(price, INIT_MARGIN)]
        avg_p = calc_avg_price(entries)
        return {
            "side":           side,
            "entries":        entries,
            "total_margin":   INIT_MARGIN,
            "avg_price":      avg_p,
            "liq_price":      calc_liq(side, avg_p),
            "last_add_price": price,
            "tp1_done":       False,
            "tp2_done":       False,
            "breakeven":      None,
            "remaining_frac": 1.0,
            "open_ts":        ts,
            "realized_pnl":   -fee,
        }

    def add_to_position(pos, price):
        nonlocal pnl_cum
        # 규칙⑤: 80% 이상이면 물타기 금지
        if pos["total_margin"] >= FREEZE_MARGIN:
            return pos
        if pos["total_margin"] >= MAX_MARGIN:
            return pos
        add_m = min(ADD_MARGIN, MAX_MARGIN - pos["total_margin"])
        if add_m <= 0:
            return pos
        fee = add_m * LEV * FEE_RATE
        pnl_cum -= fee
        pos["entries"].append((price, add_m))
        pos["total_margin"] += add_m
        pos["realized_pnl"] -= fee
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
        })

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
        ma200      = row.ma200
        h24        = row.h24
        prev_open  = row.prev_open
        prev_close = row.prev_close

        # NaN 건너뜀 (초기 구간)
        if (pd.isna(h24) or pd.isna(sma8) or pd.isna(sma25)
                or pd.isna(ma200) or pd.isna(prev_open) or pd.isna(prev_close)):
            continue

        # 쿨다운 감소
        if cooldown_remaining > 0:
            cooldown_remaining -= 1

        # ── 포지션 없음: 진입 탐색 ─────────────────────────────────────────────
        if pos is None:
            # 쿨다운 중이면 진입 불가 (규칙③)
            if cooldown_remaining > 0:
                pass
            else:
                # 규칙①: MA200 추세 필터
                trend_bull = (close > ma200)  # 롱 신호 유효
                trend_bear = (close < ma200)  # 숏 신호 유효

                # 규칙④: 반등 확인 (직전 캔들 방향)
                prev_bullish = (prev_close > prev_open)  # 직전 양봉
                prev_bearish = (prev_close < prev_open)  # 직전 음봉

                long_signal  = (close <= h24 * ENTRY_LONG_PCT)
                short_signal = (close >= h24 * ENTRY_SHORT_PCT)

                if long_signal and trend_bull and prev_bullish:
                    pos = open_position("long", close, ts)
                elif short_signal and trend_bear and prev_bearish:
                    pos = open_position("short", close, ts)

        # ── 포지션 있음 ────────────────────────────────────────────────────────
        else:
            side = pos["side"]

            # 1) 물타기 체크 (규칙②: 0.5% 간격, 규칙⑤: 80% 동결)
            if pos["total_margin"] < FREEZE_MARGIN:
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
                cooldown_remaining = COOLDOWN_BARS  # 규칙③
                equity = SEED + pnl_cum
                if equity > equity_peak:
                    equity_peak = equity
                dd = (equity_peak - equity) / equity_peak * 100
                if dd > max_dd:
                    max_dd = dd
                continue

            # 3) TP 체크
            if not pos["tp1_done"]:
                tp1_hit = ((side == "long" and close > sma8) or
                           (side == "short" and close < sma8))
                if tp1_hit:
                    pos, _ = close_partial(pos, close, 0.5)  # 50% 청산
                    pos["tp1_done"] = True
                    if side == "long":
                        pos["breakeven"] = pos["avg_price"] * (1 + FEE_RATE)
                    else:
                        pos["breakeven"] = pos["avg_price"] * (1 - FEE_RATE)

            elif pos["tp1_done"] and not pos["tp2_done"]:
                be_hit = False
                if pos["breakeven"] is not None:
                    be_hit = ((side == "long" and close < pos["breakeven"]) or
                              (side == "short" and close > pos["breakeven"]))

                tp2_hit = ((side == "long" and close > sma25) or
                           (side == "short" and close < sma25))

                if be_hit:
                    close_all(pos, close, reason="breakeven_stop")
                    record_trade(pos, ts)
                    pos = None
                    cooldown_remaining = COOLDOWN_BARS  # 규칙③
                elif tp2_hit:
                    pos, _ = close_partial(pos, close, 0.5)  # 25% 청산
                    pos["tp2_done"] = True

            elif pos["tp1_done"] and pos["tp2_done"]:
                sma25_exit = ((side == "long" and close < sma25) or
                              (side == "short" and close > sma25))
                be_hit = False
                if pos["breakeven"] is not None:
                    be_hit = ((side == "long" and close < pos["breakeven"]) or
                              (side == "short" and close > pos["breakeven"]))

                if sma25_exit or be_hit:
                    close_all(pos, close, reason="sma25_exit_or_be")
                    record_trade(pos, ts)
                    pos = None
                    cooldown_remaining = COOLDOWN_BARS  # 규칙③

            # 포지션 완전 청산 처리
            if pos is not None and pos["remaining_frac"] < 0.001:
                record_trade(pos, ts)
                pos = None
                cooldown_remaining = COOLDOWN_BARS  # 규칙③

        # 자산 고점/낙폭 업데이트
        equity = SEED + pnl_cum
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

    return trades, pnl_cum, max_dd, equity_peak


# ── 결과 분석 ─────────────────────────────────────────────────────────────────
def analyze_v2(trades, pnl_cum, max_dd, equity_peak):
    if not trades:
        return "거래 없음", None

    df_t = pd.DataFrame(trades)
    df_t["year"] = df_t["close_ts"].dt.year

    yearly    = df_t.groupby("year")["realized_pnl"].sum()
    total_trades = len(df_t)
    wins      = (df_t["realized_pnl"] > 0).sum()
    win_rate  = wins / total_trades * 100
    liq_cnt   = df_t["liquidated"].sum()
    final_eq  = SEED + pnl_cum

    return {
        "total_trades": total_trades,
        "win_rate":     win_rate,
        "liq_cnt":      liq_cnt,
        "yearly":       yearly,
        "pnl_cum":      pnl_cum,
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


def build_report(v2):
    o = ORIGINAL
    v = v2

    yrs = [2021, 2022, 2023, 2024, 2025, 2026]

    def fmt_pnl(val):
        sign = "+" if val >= 0 else "-"
        return f"{sign}${abs(val):,.0f}"

    lines = []
    lines.append("=" * 56)
    lines.append("   백테스트 비교: 기존 vs 개선")
    lines.append("   기간: 2021-02-28 ~ 2026-02-28 | 시드: $1,000 | 레버리지: 5x")
    lines.append("=" * 56)
    lines.append(f"{'항목':<20} {'기존 규칙':>12} {'개선 규칙':>12}")
    lines.append("-" * 56)
    lines.append(f"{'총 거래 횟수':<20} {o['total_trades']:>10,}회 {v['total_trades']:>10,}회")
    lines.append(f"{'승률':<20} {o['win_rate']:>10.1f}% {v['win_rate']:>10.1f}%")
    lines.append(f"{'강제청산 횟수':<20} {o['liq_cnt']:>11}회 {v['liq_cnt']:>11}회")
    lines.append("-" * 56)

    for yr in yrs:
        o_val = o["yearly"].get(yr, 0)
        v_val = v["yearly"].get(yr, 0)
        lines.append(f"{str(yr) + ' 손익':<20} {fmt_pnl(o_val):>12} {fmt_pnl(v_val):>12}")

    lines.append("─" * 56)
    lines.append(f"{'누적 수익':<20} {fmt_pnl(o['pnl_cum']):>12} {fmt_pnl(v['pnl_cum']):>12}")
    o_eq = "$" + f"{o['final_equity']:,.0f}"
    v_eq = "$" + f"{v['final_equity']:,.0f}"
    lines.append(f"{'최종 자산':<20} {o_eq:>12} {v_eq:>12}")
    lines.append(f"{'최대낙폭(MDD)':<20} {o['max_dd']:>10.1f}% {v['max_dd']:>10.1f}%")
    lines.append("=" * 56)

    return "\n".join(lines)


# ── 메인 ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    df = load_data()

    print(f"\n데이터 범위: {df.index[0]} ~ {df.index[-1]}")
    print(f"총 캔들 수 : {len(df)}")
    print("\n[개선 v2] 백테스트 실행 중...")

    trades_v2, pnl_v2, mdd_v2, peak_v2 = run_backtest_v2(df)
    v2_stats = analyze_v2(trades_v2, pnl_v2, mdd_v2, peak_v2)

    if isinstance(v2_stats, str):
        print(v2_stats)
    else:
        # v2 yearly dict 변환
        yearly_dict = {int(yr): float(pnl)
                       for yr, pnl in v2_stats["yearly"].items()}
        v2_for_report = {
            "total_trades": v2_stats["total_trades"],
            "win_rate":     v2_stats["win_rate"],
            "liq_cnt":      int(v2_stats["liq_cnt"]),
            "yearly":       yearly_dict,
            "pnl_cum":      v2_stats["pnl_cum"],
            "final_equity": v2_stats["final_equity"],
            "max_dd":       v2_stats["max_dd"],
        }

        report = build_report(v2_for_report)
        print("\n" + report)

        # 저장
        out_path = "/Users/fireant/.openclaw/workspace/backtest_result_v2.txt"
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(report)
            f.write("\n\n[개선판 거래 내역 (최근 50건)]\n")
            f.write(v2_stats["df_trades"].tail(50).to_string())
        print(f"\n결과 저장 완료: {out_path}")
