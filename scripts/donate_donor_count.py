#!/usr/bin/env python3
"""후원 지갑 2개 입금 tx 집계(donate_txs_sol/evm.json) → data/donations.json donor_count 갱신.

donor_count = 입금한 고유 지갑 주소 수(같은 지갑의 여러 입금은 1명). tx 수는 donor_tx_count에 따로 둔다.

두 집계가 모두 complete일 때만 숫자를 바꾼다. 하나라도 불완전하면 이전 값을 유지한다(임의 보정 금지).
donations 배열(수동 입력분)은 건드리지 않는다.
"""
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

DATA = Path("/Users/fireant/fireant-dashboard/data")
DON = DATA / "donations.json"

sol = json.loads((DATA / "donate_txs_sol.json").read_text())
evm = json.loads((DATA / "donate_txs_evm.json").read_text())

if not (sol.get("complete") and evm.get("complete")):
    print(f"skip: incomplete sol={sol.get('complete')} evm={evm.get('complete')}")
    sys.exit(0)

txs = [("solana", t) for t in sol["txs"]] + [(c["chain"], t) for c in evm["chains"] for t in c["txs"]]
tx_count = len(txs)

# 체인별 수 = 그 체인에서 처음 등장한 고유 지갑 수 (합계 = 전체 고유 지갑 수)
by_chain = {"solana": 0, **{c: 0 for c in evm["by_chain"]}}
seen = set()
for chain, t in txs:
    # 발신자 불명(BSC 내부 tx 잔고 탐색분)은 tx 단위로 1명 처리
    addr = t.get("from") or f"{chain}:{t['hash']}"
    if chain != "solana":
        addr = addr.lower()
    if addr in seen:
        continue
    seen.add(addr)
    by_chain[chain] += 1
total = len(seen)

d = json.loads(DON.read_text())
prev = d.get("donor_count")
prev_tx = d.get("donor_tx_count")
if prev_tx is not None and tx_count < prev_tx:
    # 입금 tx는 줄어들 수 없다 — 소스 누락으로 보고 반영하지 않는다
    print(f"skip: tx count decreased {prev_tx} -> {tx_count}")
    sys.exit(0)

d["donor_count"] = total
d["donor_tx_count"] = tx_count
d["donor_count_by_chain"] = by_chain
d["donor_count_updated_at"] = datetime.now(timezone(timedelta(hours=9))).isoformat(timespec="seconds")
DON.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
print(f"ok: donor_count {prev} -> {total} {by_chain}")
