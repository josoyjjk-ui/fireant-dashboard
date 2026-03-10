"""
불개미 매매 원칙 5년 백테스트
BTC 선물 (BTCUSDT), $1,000 시드
기간: 2021-02-28 ~ 2026-02-28 UTC
"""

import requests
import pandas as pd
import numpy as np
import time
from datetime import datetime, timezone

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
        
        # 다음 배치는 마지막 캔들 다음 시간부터
        current_start = last_open_time + 3600000  # 1h in ms
        
        if current_start >= end_ts:
            break
        
        time.sleep(0.2)  # rate limit 방지
        print(f"  수집됨: {len(all_data)} 캔들 (마지막: {datetime.fromtimestamp(last_open_time/1000, tz=timezone.utc)})")
    
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


# ── 백테스트 엔진 ──────────────────────────────────────────────────────────────
FEE_RATE = 0.0004          # 0.04% 수수료
SEED      = 1000.0         # 시드 (변하지 않음)
INIT_MARGIN = 200.0        # 첫 진입 마진 = 시드의 20%
ADD_MARGIN  = 20.0         # 물타기 마진 = 시드의 2%
MAX_MARGIN  = 1000.0       # 최대 마진 합계
LEV         = 5            # 레버리지
LIQ_RATIO   = 0.20         # 청산 비율 (avg_price ×(1±0.20))

ENTRY_LONG_PCT  = 0.965    # H24 × 0.965 이하 → 롱
ENTRY_SHORT_PCT = 1.045    # H24 × 1.045 이상 → 숏
ADD_STEP_LONG   = 100.0    # 롱 물타기: $100 하락마다
ADD_STEP_SHORT  = 100.0    # 숏 물타기: $100 상승마다


def run_backtest(df):
    # 사전 계산: SMA
    df = df.copy()
    df["sma8"]  = df["close"].rolling(8).mean()
    df["sma25"] = df["close"].rolling(25).mean()
    df["h24"]   = df["high"].rolling(24).max().shift(1)  # 직전 24h 고가 (현재 캔들 제외)
    
    # 상태 변수
    pnl_cum = 0.0          # 누적 손익
    equity_peak = SEED     # 최고 자산
    max_dd = 0.0           # 최대 낙폭

    pos = None             # 현재 포지션 dict or None

    trades = []            # 완료된 거래 기록
    
    # 포지션 dict 구조:
    # {
    #   "side": "long" | "short",
    #   "entries": [(price, margin), ...],   # 각 진입 레코드
    #   "total_margin": float,
    #   "avg_price": float,
    #   "liq_price": float,
    #   "last_add_price": float,             # 마지막 물타기(또는 첫진입) 가격
    #   "tp1_done": bool,                    # 50% 청산 완료 여부
    #   "tp2_done": bool,                    # 25% 청산 완료 여부
    #   "breakeven": float | None,           # 브레이크이븐 가격
    #   "remaining_frac": float,             # 잔여 포지션 비율 (0~1)
    #   "open_ts": Timestamp,
    #   "realized_pnl": float,               # 이 거래에서 이미 실현된 손익
    # }
    
    def calc_avg_price(entries):
        total_size = sum(m * LEV for _, m in entries)
        wavg = sum(p * m * LEV for p, m in entries) / total_size
        return wavg, total_size
    
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
        avg_p, total_size = calc_avg_price(entries)
        return {
            "side": side,
            "entries": entries,
            "total_margin": INIT_MARGIN,
            "avg_price": avg_p,
            "liq_price": calc_liq(side, avg_p),
            "last_add_price": price,
            "tp1_done": False,
            "tp2_done": False,
            "breakeven": None,
            "remaining_frac": 1.0,
            "open_ts": ts,
            "realized_pnl": -fee,
        }
    
    def add_to_position(pos, price, ts):
        nonlocal pnl_cum
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
        avg_p, _ = calc_avg_price(pos["entries"])
        pos["avg_price"] = avg_p
        pos["liq_price"] = calc_liq(pos["side"], avg_p)
        pos["last_add_price"] = price
        return pos
    
    def close_partial(pos, close_price, frac, ts):
        """포지션의 frac 비율만큼 청산 → 손익 계산, remaining_frac 업데이트"""
        nonlocal pnl_cum
        total_size = pos["total_margin"] * LEV  # 전체 계약 사이즈
        close_size = total_size * pos["remaining_frac"] * frac
        fee = close_size * FEE_RATE
        
        if pos["side"] == "long":
            gross = close_size * (close_price - pos["avg_price"]) / pos["avg_price"]
        else:
            gross = close_size * (pos["avg_price"] - close_price) / pos["avg_price"]
        
        net = gross - fee
        pnl_cum += net
        pos["realized_pnl"] += net
        pos["remaining_frac"] -= pos["remaining_frac"] * frac
        return pos, net
    
    def close_all(pos, close_price, ts, reason=""):
        """전체 청산 (청산 or 손절 등)"""
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
        pos["realized_pnl"] += net
        pos["remaining_frac"] = 0.0
        return net
    
    def record_trade(pos, close_ts, is_liq=False):
        trades.append({
            "open_ts":    pos["open_ts"],
            "close_ts":   close_ts,
            "side":       pos["side"],
            "avg_price":  pos["avg_price"],
            "total_margin": pos["total_margin"],
            "realized_pnl": pos["realized_pnl"],
            "liquidated": is_liq,
        })
    
    # ── 메인 루프 ────────────────────────────────────────────────────────────────
    rows = df.itertuples()
    for row in rows:
        ts    = row.Index
        close = row.close
        low   = row.low
        high  = row.high
        sma8  = row.sma8
        sma25 = row.sma25
        h24   = row.h24
        
        # NaN 건너뜀 (초기 25캔들)
        if pd.isna(h24) or pd.isna(sma8) or pd.isna(sma25):
            continue
        
        # ── 포지션 없음: 진입 탐색 ─────────────────────────────────────────────
        if pos is None:
            if close <= h24 * ENTRY_LONG_PCT:
                pos = open_position("long", close, ts)
            elif close >= h24 * ENTRY_SHORT_PCT:
                pos = open_position("short", close, ts)
        
        # ── 포지션 있음 ────────────────────────────────────────────────────────
        else:
            side = pos["side"]
            
            # 1) 물타기 체크
            if pos["total_margin"] < MAX_MARGIN:
                if side == "long" and close < (pos["last_add_price"] - ADD_STEP_LONG):
                    pos = add_to_position(pos, close, ts)
                elif side == "short" and close > (pos["last_add_price"] + ADD_STEP_SHORT):
                    pos = add_to_position(pos, close, ts)
            
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
                equity = SEED + pnl_cum
                if equity > equity_peak:
                    equity_peak = equity
                dd = (equity_peak - equity) / equity_peak * 100
                if dd > max_dd:
                    max_dd = dd
                continue
            
            # 3) TP 체크
            # 1차 TP: close > sma8, tp1 미완료
            if not pos["tp1_done"]:
                tp1_hit = (side == "long" and close > sma8) or (side == "short" and close < sma8)
                if tp1_hit:
                    pos, _ = close_partial(pos, close, 0.5, ts)  # 50% 청산
                    pos["tp1_done"] = True
                    # breakeven = avg_price + fee
                    if side == "long":
                        pos["breakeven"] = pos["avg_price"] * (1 + FEE_RATE)
                    else:
                        pos["breakeven"] = pos["avg_price"] * (1 - FEE_RATE)
            
            # 2차 TP: close > sma25, tp1 완료, tp2 미완료
            elif pos["tp1_done"] and not pos["tp2_done"]:
                tp2_hit = (side == "long" and close > sma25) or (side == "short" and close < sma25)
                
                # breakeven 손절 먼저 체크
                be_hit = False
                if pos["breakeven"] is not None:
                    be_hit = (side == "long" and close < pos["breakeven"]) or \
                             (side == "short" and close > pos["breakeven"])
                
                if be_hit:
                    close_all(pos, close, ts, reason="breakeven_stop")
                    record_trade(pos, ts)
                    pos = None
                elif tp2_hit:
                    # remaining_frac 현재 0.5 → 0.25 청산 (즉, 잔여의 50% 청산)
                    pos, _ = close_partial(pos, close, 0.5, ts)  # 25% 청산
                    pos["tp2_done"] = True
                    # breakeven 유지 (이미 설정됨)
            
            # 3단계: tp2 완료 후 잔여 25%
            elif pos["tp1_done"] and pos["tp2_done"]:
                # sma25 역방향 돌파 or breakeven 손절
                sma25_exit = (side == "long" and close < sma25) or \
                             (side == "short" and close > sma25)
                be_hit = False
                if pos["breakeven"] is not None:
                    be_hit = (side == "long" and close < pos["breakeven"]) or \
                             (side == "short" and close > pos["breakeven"])
                
                if sma25_exit or be_hit:
                    close_all(pos, close, ts, reason="sma25_exit_or_be")
                    record_trade(pos, ts)
                    pos = None
            
            # 포지션이 완전히 청산된 경우 (remaining_frac ≈ 0)
            if pos is not None and pos["remaining_frac"] < 0.001:
                record_trade(pos, ts)
                pos = None
        
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
        last_ts = df.index[-1]
        close_all(pos, last_close, last_ts, reason="end_of_data")
        record_trade(pos, last_ts)
    
    return trades, pnl_cum, max_dd, equity_peak


# ── 결과 분석 ─────────────────────────────────────────────────────────────────
def analyze(trades, pnl_cum, max_dd, equity_peak):
    df_t = pd.DataFrame(trades)
    
    if df_t.empty:
        print("거래 없음")
        return
    
    df_t["year"] = df_t["close_ts"].dt.year
    
    # 연도별 손익
    yearly = df_t.groupby("year")["realized_pnl"].sum()
    yearly_cum = yearly.cumsum()
    
    total_trades = len(df_t)
    wins = (df_t["realized_pnl"] > 0).sum()
    win_rate = wins / total_trades * 100
    liq_cnt = df_t["liquidated"].sum()
    
    final_equity = SEED + pnl_cum
    
    lines = []
    lines.append("=" * 60)
    lines.append("  불개미 매매 원칙 5년 백테스트 결과")
    lines.append("  기간: 2021-02-28 ~ 2026-02-28 (BTC 선물 1h)")
    lines.append("=" * 60)
    lines.append(f"\n[연도별 누적 손익]")
    cum = 0
    for year, pnl in yearly.items():
        cum += pnl
        lines.append(f"  {year}년  연간 손익: ${pnl:>10.2f}   누적: ${cum:>10.2f}")
    
    lines.append(f"\n[전체 통계]")
    lines.append(f"  총 거래 횟수  : {total_trades}회")
    lines.append(f"  승리 거래     : {wins}회")
    lines.append(f"  패배 거래     : {total_trades - wins}회")
    lines.append(f"  승률          : {win_rate:.1f}%")
    lines.append(f"  청산(강제손실): {liq_cnt}회")
    lines.append(f"\n[손익 요약]")
    lines.append(f"  초기 시드     : ${SEED:,.2f}")
    lines.append(f"  총 손익       : ${pnl_cum:+,.2f}")
    lines.append(f"  최종 자산     : ${final_equity:,.2f}")
    lines.append(f"  수익률        : {pnl_cum/SEED*100:+.1f}%")
    lines.append(f"  최대 낙폭(MDD): {max_dd:.2f}%")
    lines.append(f"  자산 최고점   : ${equity_peak:,.2f}")
    lines.append("=" * 60)
    
    report = "\n".join(lines)
    print(report)
    return report, df_t


# ── 메인 ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    # 5년 기간 (UTC)
    START_DT = datetime(2021, 2, 28, tzinfo=timezone.utc)
    END_DT   = datetime(2026, 2, 28, tzinfo=timezone.utc)
    START_MS = int(START_DT.timestamp() * 1000)
    END_MS   = int(END_DT.timestamp() * 1000)
    
    raw = fetch_klines("BTCUSDT", "1h", START_MS, END_MS)
    df  = build_df(raw)
    
    print(f"\n데이터 범위: {df.index[0]} ~ {df.index[-1]}")
    print(f"총 캔들 수 : {len(df)}")
    print("\n백테스트 실행 중...")
    
    trades, pnl_cum, max_dd, equity_peak = run_backtest(df)
    
    result = analyze(trades, pnl_cum, max_dd, equity_peak)
    
    if result:
        report, df_t = result
        # 결과 저장
        out_path = "/Users/fireant/.openclaw/workspace/backtest_result.txt"
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(report)
            f.write("\n\n[거래 내역 (최근 50건)]\n")
            f.write(df_t.tail(50).to_string())
        print(f"\n결과 저장 완료: {out_path}")
