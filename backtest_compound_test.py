"""
복리 파라미터 최적화 비교 (v4-fix 기반)
BTC 선물 (BTCUSDT), $1,000 초기 시드
기간: 2021-02-28 ~ 2026-02-28 UTC

5개 변형 비교:
  v4-fix(현재):  재투자비율 50%, 주기 30일, 시드상한 $10,000
  변형A:         재투자비율 80%, 주기 30일, 시드상한 $20,000
  변형B:         재투자비율 80%, 주기 14일, 시드상한 $20,000
  변형C:         재투자비율 80%, 주기 14일, 시드상한 무제한
  변형D:         재투자비율 70%, 주기 21일, 시드상한 $30,000
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


# ── 고정 파라미터 ─────────────────────────────────────────────────────────────
INIT_SEED       = 1000.0
FEE_RATE        = 0.0004
LEV             = 5
LIQ_RATIO       = 0.20

ENTRY_LONG_PCT  = 0.965
ENTRY_SHORT_PCT = 1.045
ADD_STEP_PCT    = 0.005

MA150_WINDOW    = 150 * 24
COOLDOWN_BARS   = 24

ATR_WINDOW      = 14
ATR_MULT        = 1.0

ADD_RATIOS      = [0.02, 0.03, 0.05]

RR_MIN          = 1.5
VOL_SPIKE_THRESH = 0.05


# ── 비교 변형 정의 ─────────────────────────────────────────────────────────────
VARIANTS = [
    {"name": "v4-fix(현재)", "ratio": 0.50, "days": 30, "max_seed": 10000},
    {"name": "변형A(비율↑+상한↑)", "ratio": 0.80, "days": 30, "max_seed": 20000},
    {"name": "변형B(비율↑+주기↓+상한↑)", "ratio": 0.80, "days": 14, "max_seed": 20000},
    {"name": "변형C(상한없음)", "ratio": 0.80, "days": 14, "max_seed": 999999},
    {"name": "변형D(균형)", "ratio": 0.70, "days": 21, "max_seed": 30000},
]


def seed_params(seed):
    return {
        "init_margin":   seed * 0.20,
        "max_margin":    seed * 1.00,
        "freeze_margin": seed * 0.80,
    }


def add_margin_for_count(seed, add_count):
    if add_count < len(ADD_RATIOS):
        ratio = ADD_RATIOS[add_count]
    else:
        ratio = ADD_RATIOS[-1]
    return seed * ratio


# ── 백테스트 엔진 (파라미터화) ─────────────────────────────────────────────────
def run_backtest(df, reinvest_ratio=0.50, reinvest_days=30, max_seed=10000.0):
    """
    v4-fix 백테스트 엔진.
    reinvest_ratio: 수익의 몇 %를 재투자할지 (0.0~1.0)
    reinvest_days:  재투자 주기 (일)
    max_seed:       시드 상한 ($)
    """
    df = df.copy()

    # 사전 계산
    df["sma8"]       = df["close"].rolling(8).mean()
    df["sma25"]      = df["close"].rolling(25).mean()
    df["ma150"]      = df["close"].rolling(MA150_WINDOW).mean()
    df["h24"]        = df["high"].rolling(24).max().shift(1)
    df["prev_open"]  = df["open"].shift(1)
    df["prev_close"] = df["close"].shift(1)
    df["volume"]     = df["volume"].astype(float)
    df["vol_ma20"]   = df["volume"].rolling(20).mean()
    df["atr14"]      = (df["high"] - df["low"]).rolling(ATR_WINDOW).mean()
    df["tp_dist"]    = abs(df["sma25"] - df["close"]) / df["close"]
    df["sl_dist"]    = df["atr14"] / df["close"]
    df["rr_ratio"]   = df["tp_dist"] / df["sl_dist"]

    # F-3: 고점·저점 구조 (직전 2캔들)
    df["low_1"]  = df["low"].shift(1)
    df["low_2"]  = df["low"].shift(2)
    df["high_1"] = df["high"].shift(1)
    df["high_2"] = df["high"].shift(2)
    df["hl_structure"] = df["low_1"] > df["low_2"]
    df["lh_structure"] = df["high_1"] < df["high_2"]

    # I-1: 변동성 폭발 감지 (직전 2캔들, 5%)
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

    # 재투자 추적
    last_reinvest_ts  = None
    pnl_at_last_reinvest = pnl_cum

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
        total_size = pos["total_margin"] * LEV
        close_size = total_size * pos["remaining_frac"] * frac
        fee = close_size * FEE_RATE
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
        fee = close_size * FEE_RATE
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
            "open_ts":      pos["open_ts"],
            "close_ts":     close_ts,
            "side":         pos["side"],
            "avg_price":    pos["avg_price"],
            "total_margin": pos["total_margin"],
            "realized_pnl": pos["realized_pnl"],
            "liquidated":   is_liq,
            "seed_at_open": seed,
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
        """재투자 주기 체크 — 파라미터화된 버전"""
        nonlocal seed, last_reinvest_ts, pnl_at_last_reinvest, equity_peak
        if last_reinvest_ts is None:
            return
        elapsed_days = (ts - last_reinvest_ts).total_seconds() / 86400
        if elapsed_days >= reinvest_days:
            period_pnl = pnl_cum - pnl_at_last_reinvest
            if period_pnl > 0:
                reinvest_amt = period_pnl * reinvest_ratio
                new_seed = min(seed + reinvest_amt, max_seed)
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
                last_reinvest_ts  = ts
                pnl_at_last_reinvest = pnl_cum
            continue

        # 재투자 초기화
        if last_reinvest_ts is None:
            last_reinvest_ts  = ts
            pnl_at_last_reinvest = pnl_cum

        # 쿨다운 감소
        if cooldown_remaining > 0:
            cooldown_remaining -= 1

        # 재투자 체크
        check_reinvest(ts)

        # ── 포지션 없음: 진입 탐색 ─────────────────────────────────────────────
        if pos is None:
            if cooldown_remaining > 0:
                pass
            else:
                trend_bull   = (close > ma150)
                trend_bear   = (close < ma150)
                prev_bullish = (prev_close > prev_open)
                prev_bearish = (prev_close < prev_open)
                vol_ok       = (volume > vol_ma20 * 1.5)

                long_signal  = (close <= h24 * ENTRY_LONG_PCT)
                short_signal = (close >= h24 * ENTRY_SHORT_PCT)

                no_spike = not bool(vol_spike)
                rr_ok    = (not pd.isna(rr_ratio)) and (rr_ratio >= RR_MIN)
                hl_ok    = bool(hl_struct)
                lh_ok    = bool(lh_struct)

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

            # 1) 물타기
            if pos["total_margin"] < params["freeze_margin"]:
                last_p = pos["last_add_price"]
                if side == "long" and close <= last_p * (1 - ADD_STEP_PCT):
                    pos = add_to_position(pos, close)
                elif side == "short" and close >= last_p * (1 + ADD_STEP_PCT):
                    pos = add_to_position(pos, close)

            # 2) 청산 체크
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

            # 3) TP1 / TP2 / 트레일링
            if not pos["tp1_done"]:
                tp1_hit = ((side == "long" and close > sma8) or
                           (side == "short" and close < sma8))
                if tp1_hit:
                    pos, _ = close_partial(pos, close, 0.5)
                    pos["tp1_done"] = True
                    pos["trailing_active"] = True
                    pos["trail_peak"] = close

            elif pos["tp1_done"] and not pos["tp2_done"]:
                if pos["trailing_active"]:
                    if side == "long":
                        if close > pos["trail_peak"]:
                            pos["trail_peak"] = close
                        trail_stop = pos["trail_peak"] - pos["trail_dist"]
                        if close <= trail_stop:
                            close_all(pos, close, reason="trailing_stop")
                            record_trade(pos, ts)
                            pos = None
                            cooldown_remaining = COOLDOWN_BARS
                            update_equity_dd()
                            continue
                    else:
                        if close < pos["trail_peak"]:
                            pos["trail_peak"] = close
                        trail_stop = pos["trail_peak"] + pos["trail_dist"]
                        if close >= trail_stop:
                            close_all(pos, close, reason="trailing_stop")
                            record_trade(pos, ts)
                            pos = None
                            cooldown_remaining = COOLDOWN_BARS
                            update_equity_dd()
                            continue

                if pos is not None:
                    tp2_hit = ((side == "long" and close > sma25) or
                               (side == "short" and close < sma25))
                    if tp2_hit:
                        pos, _ = close_partial(pos, close, 0.5)
                        pos["tp2_done"] = True

            elif pos["tp1_done"] and pos["tp2_done"]:
                if pos["trailing_active"]:
                    if side == "long":
                        if close > pos["trail_peak"]:
                            pos["trail_peak"] = close
                        trail_stop = pos["trail_peak"] - pos["trail_dist"]
                        if close <= trail_stop:
                            close_all(pos, close, reason="trailing_stop_final")
                            record_trade(pos, ts)
                            pos = None
                            cooldown_remaining = COOLDOWN_BARS
                            update_equity_dd()
                            continue
                    else:
                        if close < pos["trail_peak"]:
                            pos["trail_peak"] = close
                        trail_stop = pos["trail_peak"] + pos["trail_dist"]
                        if close >= trail_stop:
                            close_all(pos, close, reason="trailing_stop_final")
                            record_trade(pos, ts)
                            pos = None
                            cooldown_remaining = COOLDOWN_BARS
                            update_equity_dd()
                            continue

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
        return None
    df_t = pd.DataFrame(trades)
    df_t["year"] = df_t["close_ts"].dt.year
    yearly   = df_t.groupby("year")["realized_pnl"].sum()
    wins     = (df_t["realized_pnl"] > 0).sum()
    win_rate = wins / len(df_t) * 100
    liq_cnt  = df_t["liquidated"].sum()
    return {
        "total_trades": len(df_t),
        "win_rate":     win_rate,
        "liq_cnt":      int(liq_cnt),
        "yearly":       {int(y): float(p) for y, p in yearly.items()},
        "pnl_cum":      pnl_cum,
        "final_seed":   final_seed,
        "final_equity": final_seed + pnl_cum,
        "max_dd":       max_dd,
    }


# ── 보고서 출력 ───────────────────────────────────────────────────────────────
def build_report(results):
    yrs = [2021, 2022, 2023, 2024, 2025, 2026]
    names = [v["name"] for v in VARIANTS]

    def fmt_pnl(val):
        sign = "+" if val >= 0 else "-"
        return f"{sign}${abs(val):,.0f}"

    def fmt_seed(val):
        if val >= 1_000_000:
            return f"${val/1_000_000:.1f}M"
        elif val >= 1000:
            return f"${val/1000:.0f}k" if val < 10000 else f"${val:,.0f}"
        return f"${val:.0f}"

    # 헤더 정보
    col_w = 13
    header_items = ["v4-fix", "변형A", "변형B", "변형C", "변형D"]

    lines = []
    lines.append("=" * 78)
    lines.append("   복리 파라미터 최적화 비교 (v4-fix 기반)")
    lines.append("   기간: 2021-02-28 ~ 2026-02-28 | 초기시드: $1,000 | 5x")
    lines.append("=" * 78)

    # 파라미터 행
    lines.append(f"{'항목':<14} " + " ".join(f"{h:>{col_w}}" for h in header_items))
    lines.append(f"{'재투자비율':<14} " + " ".join(
        f"{int(v['ratio']*100)}%".rjust(col_w) for v in VARIANTS))
    lines.append(f"{'재투자주기':<14} " + " ".join(
        f"{v['days']}일".rjust(col_w) for v in VARIANTS))
    lines.append(f"{'시드상한':<14} " + " ".join(
        ("무제한" if v["max_seed"] >= 999999 else f"${v['max_seed']//1000}k").rjust(col_w)
        for v in VARIANTS))
    lines.append("─" * 78)

    # 연도별 손익
    for yr in yrs:
        row_vals = []
        for r in results:
            val = r["yearly"].get(yr, 0) if r else 0
            row_vals.append(fmt_pnl(val))
        lines.append(f"{str(yr):<14} " + " ".join(v.rjust(col_w) for v in row_vals))

    lines.append("─" * 78)

    # 누적수익
    row_pnl = [fmt_pnl(r["pnl_cum"]) if r else "N/A" for r in results]
    lines.append(f"{'누적수익':<14} " + " ".join(v.rjust(col_w) for v in row_pnl))

    # 최종시드
    row_seed = [fmt_seed(r["final_seed"]) if r else "N/A" for r in results]
    lines.append(f"{'최종시드':<14} " + " ".join(v.rjust(col_w) for v in row_seed))

    # 최종자산
    row_eq = [fmt_seed(r["final_equity"]) if r else "N/A" for r in results]
    lines.append(f"{'최종자산':<14} " + " ".join(v.rjust(col_w) for v in row_eq))

    # MDD
    row_mdd = []
    for r in results:
        if r:
            mdd_str = f"{r['max_dd']:.1f}%"
            if r["max_dd"] > 10:
                mdd_str += " ⚠"
            row_mdd.append(mdd_str)
        else:
            row_mdd.append("N/A")
    lines.append(f"{'MDD':<14} " + " ".join(v.rjust(col_w) for v in row_mdd))

    lines.append("─" * 78)

    # 거래횟수 / 승률
    row_trades = [f"{r['total_trades']}회" if r else "N/A" for r in results]
    lines.append(f"{'거래횟수':<14} " + " ".join(v.rjust(col_w) for v in row_trades))
    row_wr = [f"{r['win_rate']:.1f}%" if r else "N/A" for r in results]
    lines.append(f"{'승률':<14} " + " ".join(v.rjust(col_w) for v in row_wr))

    lines.append("=" * 78)

    # 최적 변형 선정
    best_idx = 0
    best_eq  = results[0]["final_equity"] if results[0] else -999999
    for i, r in enumerate(results):
        if r and r["final_equity"] > best_eq:
            best_eq  = r["final_equity"]
            best_idx = i

    best_variant = VARIANTS[best_idx]
    lines.append(f"★ 최적 변형: {best_variant['name']} (최종자산 기준: {fmt_seed(best_eq)})")
    lines.append("=" * 78)

    return "\n".join(lines), best_idx


# ── 텔레그램 메시지 생성 ───────────────────────────────────────────────────────
def build_telegram_msg(results, report, best_idx):
    VARIANTS_KR = [
        ("v4-fix(현재)", "50%", "30일", "$10k"),
        ("변형A", "80%", "30일", "$20k"),
        ("변형B", "80%", "14일", "$20k"),
        ("변형C", "80%", "14일", "무제한"),
        ("변형D", "70%", "21일", "$30k"),
    ]

    def fmt_pnl(val):
        sign = "+" if val >= 0 else "-"
        return f"{sign}${abs(val):,.0f}"

    def fmt_eq(val):
        if val >= 10000:
            return f"${val:,.0f}"
        return f"${val:,.0f}"

    lines = []
    lines.append("📊 *복리 파라미터 최적화 비교 결과*")
    lines.append("기간: 2021-02-28 ~ 2026-02-28 | 초기: $1,000 | 5x")
    lines.append("")

    headers = ["v4fix", "변형A", "변형B", "변형C", "변형D"]
    yrs = [2021, 2022, 2023, 2024, 2025, 2026]

    lines.append("```")
    lines.append(f"{'항목':<8} {'v4fix':>8} {'변형A':>8} {'변형B':>8} {'변형C':>8} {'변형D':>8}")
    lines.append("-" * 48)
    for yr in yrs:
        row = f"{yr:<8}"
        for r in results:
            val = r["yearly"].get(yr, 0) if r else 0
            row += f" {fmt_pnl(val):>8}"
        lines.append(row)
    lines.append("-" * 48)
    pnl_row = f"{'누적':8}"
    for r in results:
        pnl_row += f" {fmt_pnl(r['pnl_cum'] if r else 0):>8}"
    lines.append(pnl_row)
    eq_row = f"{'최종자산':8}"
    for r in results:
        eq_row += f" {fmt_eq(r['final_equity'] if r else 0):>8}"
    lines.append(eq_row)
    mdd_row = f"{'MDD':8}"
    for r in results:
        mdd_val = r['max_dd'] if r else 0
        mdd_str = f"{mdd_val:.1f}%"
        mdd_row += f" {mdd_str:>8}"
    lines.append(mdd_row)
    lines.append("```")
    lines.append("")

    # MDD 경고
    for i, r in enumerate(results):
        if r and r["max_dd"] > 10:
            lines.append(f"⚠️ {VARIANTS[i]['name']}: MDD {r['max_dd']:.1f}% 초과 위험")

    lines.append("")
    best = VARIANTS[best_idx]
    best_r = results[best_idx]
    lines.append(f"🏆 *최적 변형: {best['name']}*")
    max_seed_str = "무제한" if best["max_seed"] >= 999999 else f"${best['max_seed']:,}"
    lines.append(f"재투자 {int(best['ratio']*100)}% / {best['days']}일 주기 / 시드상한 {max_seed_str}")
    lines.append("")
    lines.append(f"선정 이유: 테스트 기간 전체에서 최고 최종자산 {fmt_eq(best_r['final_equity'])}을 달성.")
    lines.append(f"MDD {best_r['max_dd']:.1f}%로 리스크 관리 수준을 유지하면서 복리 효과 극대화.")

    return "\n".join(lines)


# ── 메인 ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    df = load_data()
    print(f"\n데이터 범위: {df.index[0]} ~ {df.index[-1]}")
    print(f"총 캔들 수 : {len(df)}\n")

    all_results = []
    for v in VARIANTS:
        max_s = "무제한" if v["max_seed"] >= 999999 else f"${v['max_seed']:,}"
        print(f"[실행] {v['name']} — 비율:{v['ratio']*100:.0f}% / 주기:{v['days']}일 / 상한:{max_s}")
        trades, pnl, mdd, peak, final_seed = run_backtest(
            df,
            reinvest_ratio=v["ratio"],
            reinvest_days=v["days"],
            max_seed=v["max_seed"],
        )
        stats = analyze(trades, pnl, mdd, peak, final_seed)
        all_results.append(stats)
        if stats:
            print(f"  → 누적수익: ${pnl:+,.0f} | 최종시드: ${final_seed:,.0f} | 최종자산: ${stats['final_equity']:,.0f} | MDD: {mdd:.1f}%")
        else:
            print("  → 거래 없음")

    report, best_idx = build_report(all_results)
    print("\n" + report)

    # 파일 저장
    out_path = "/Users/fireant/.openclaw/workspace/backtest_compound_result.txt"
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(report)
        f.write("\n\n[각 변형 상세]\n")
        for i, (v, r) in enumerate(zip(VARIANTS, all_results)):
            f.write(f"\n--- {v['name']} ---\n")
            if r:
                f.write(f"거래횟수: {r['total_trades']}회 | 승률: {r['win_rate']:.1f}% | 청산: {r['liq_cnt']}회\n")
                f.write(f"누적수익: ${r['pnl_cum']:+,.2f} | 최종시드: ${r['final_seed']:,.2f} | 최종자산: ${r['final_equity']:,.2f} | MDD: {r['max_dd']:.2f}%\n")
                f.write(f"연도별 손익: {r['yearly']}\n")
            else:
                f.write("거래 없음\n")
    print(f"\n결과 저장 완료: {out_path}")

    # 텔레그램 전송용 메시지 출력
    tg_msg = build_telegram_msg(all_results, report, best_idx)
    print("\n[텔레그램 메시지 미리보기]")
    print(tg_msg)
