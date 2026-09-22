#!/usr/bin/env python3
"""후원 지갑 2개 입금 tx 집계(donate_txs_sol/evm.json) → data/donations.json donor_count 갱신.

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

by_chain = {"solana": sol["count"], **evm["by_chain"]}
total = sum(by_chain.values())

d = json.loads(DON.read_text())
prev = d.get("donor_count")
if prev is not None and total < prev:
    # 입금 tx는 줄어들 수 없다 — 소스 누락으로 보고 반영하지 않는다
    print(f"skip: count decreased {prev} -> {total}")
    sys.exit(0)

d["donor_count"] = total
d["donor_count_by_chain"] = by_chain
d["donor_count_updated_at"] = datetime.now(timezone(timedelta(hours=9))).isoformat(timespec="seconds")
DON.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
print(f"ok: donor_count {prev} -> {total} {by_chain}")
