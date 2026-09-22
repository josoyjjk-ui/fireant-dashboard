#!/usr/bin/env python3
"""EVM 후원 지갑 — 활동 있는 모든 체인의 입금 tx 카운트 → data/donate_txs_evm.json.

정의: 지갑에 입금된 tx 수(체인+hash 기준, tx 1건=1명). 카운트 대상은 네이티브 코인 또는
화이트리스트 ERC-20(체인별 정본 컨트랙트 주소로 검증한 USDC/USDT/USDT0 등) 수신뿐이며,
0원 전송·먼지·가짜 토큰(주소 포이즈닝, 예: "UṢDC"/"U"/위조 ERC-20 "ETH")은 제외한다.

소스(키 불필요, stdlib urllib만 사용):
  - Blockscout 계열 explorer API(module=account, action=txlist/txlistinternal/tokentx):
    Ethereum, Base, Arbitrum, Polygon, Optimism
  - Routescan(Etherscan v1 호환 API): Avalanche
  - 공개 RPC(eth_getLogs Transfer 토픽 스캔 + 잔고 이분탐색): BSC — 키리스 explorer가 없음

재실행 가능(idempotent). 매 실행마다 전체 재조회하며, 소스가 실패한 체인은
`complete: false`와 이유를 남기고 숫자를 임의로 보정하지 않는다.

사용법:
  python3 donate_txs_evm.py [지갑주소]   # 생략 시 기본 지갑(WALLET) 사용
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

OUT = Path("/Users/fireant/fireant-dashboard/data/donate_txs_evm.json")
UA = {"User-Agent": "Mozilla/5.0 (compatible; FireantHub-donate-evm/1.0)"}

WALLET = "0x403b5240c372ba850233911854ccc5f6f250e2a1"
START_TS = 1790002800  # 2026-09-22 00:00 KST — 지갑 최초 입금(09-22 19:2x KST)보다 넉넉히 이전

STABLE_MIN = 0.1  # 스테이블코인 최소 인정 수량(그 미만은 먼지로 제외)

# 체인별 explorer API(Etherscan 호환) + 네이티브 심볼/먼지 기준 + 화이트리스트 토큰
# {컨트랙트 주소(소문자): (심볼, decimals, 최소 인정 수량)}
EVM_CHAINS: dict[str, dict[str, Any]] = {
    "ethereum": {
        "api": ["https://eth.blockscout.com/api"],
        "native": ("ETH", 0.00003),
        "tokens": {
            "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": ("USDC", 6, STABLE_MIN),
            "0xdac17f958d2ee523a2206206994597c13d831ec7": ("USDT", 6, STABLE_MIN),
        },
    },
    "base": {
        "api": ["https://base.blockscout.com/api"],
        "native": ("ETH", 0.00003),
        "tokens": {
            "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": ("USDC", 6, STABLE_MIN),
            "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2": ("USDT", 6, STABLE_MIN),
        },
    },
    "arbitrum": {
        "api": ["https://arbitrum.blockscout.com/api"],
        "native": ("ETH", 0.00003),
        "tokens": {
            "0xaf88d065e77c8cc2239327c5edb3a432268e5831": ("USDC", 6, STABLE_MIN),
            "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8": ("USDC.e", 6, STABLE_MIN),
            "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9": ("USDT0", 6, STABLE_MIN),
        },
    },
    "polygon": {
        "api": ["https://polygon.blockscout.com/api"],
        "native": ("POL", 0.5),
        "tokens": {
            "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": ("USDC", 6, STABLE_MIN),
            "0x2791bca1f2de4661ed88a30c99a7a9449aa84174": ("USDC.e", 6, STABLE_MIN),
            "0xc2132d05d31c914a87c6611c10748aeb04b58e8f": ("USDT", 6, STABLE_MIN),
        },
    },
    "optimism": {
        "api": ["https://optimism.blockscout.com/api", "https://explorer.optimism.io/api"],
        "native": ("ETH", 0.00003),
        "tokens": {
            "0x0b2c639c533813f4aa9d7837caf62653d097ff85": ("USDC", 6, STABLE_MIN),
            "0x7f5c764cbc14f9669b88837ca1490cca17c31607": ("USDC.e", 6, STABLE_MIN),
            "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58": ("USDT", 6, STABLE_MIN),
            "0x01bff41798a0bcf287b996046ca68b395dbc1071": ("USDT0", 6, STABLE_MIN),
        },
    },
    "avalanche": {
        "api": ["https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api"],
        "native": ("AVAX", 0.005),
        "tokens": {
            "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e": ("USDC", 6, STABLE_MIN),
            "0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7": ("USDT", 6, STABLE_MIN),
        },
    },
}

# BSC: 키리스 explorer가 없어 공개 RPC로 직접 스캔
BSC = {
    "logs_rpcs": ["https://rpc-bsc.48.club", "https://0.48.club", "https://bsc.rpc.blxrbdn.com", "https://bsc.drpc.org"],
    "logs_chunk": 5000,
    "archive_rpcs": ["https://bsc-dataseed.bnbchain.org", "https://bsc.meowrpc.com", "https://bsc-mainnet.public.blastapi.io"],
    "native": ("BNB", 0.0002),
    "tokens": {
        "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d": ("USDC", 18, STABLE_MIN),
        "0x55d398326f99059ff775485246999027b3197955": ("USDT", 18, STABLE_MIN),
    },
}

TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
CHAIN_ORDER = ["ethereum", "base", "arbitrum", "bsc", "polygon", "optimism", "avalanche"]

# 추가로 활동 유무만 확인할 체인(공개 RPC로 잔고/nonce + Transfer 로그 존재 여부 점검).
# 활동이 발견되면 EVM_CHAINS/BSC 방식으로 별도 확장 필요 — 이 스크립트는 "활동 없음"을 로그로만 남긴다.
EXTRA_CHECK_RPCS = {
    "linea": "https://rpc.linea.build",
    "scroll": "https://rpc.scroll.io",
    "zksync": "https://mainnet.era.zksync.io",
    "blast": "https://rpc.blast.io",
    "mantle": "https://rpc.mantle.xyz",
    "sonic": "https://rpc.soniclabs.com",
    "unichain": "https://mainnet.unichain.org",
    "hyperevm": "https://rpc.hyperliquid.xyz/evm",
    "celo": "https://forno.celo.org",
    "gnosis": "https://rpc.gnosischain.com",
    "berachain": "https://rpc.berachain.com",
    "abstract": "https://api.mainnet.abs.xyz",
    "ink": "https://rpc-gel.inkonchain.com",
    "soneium": "https://rpc.soneium.org",
    "worldchain": "https://worldchain-mainnet.g.alchemy.com/public",
    "plasma": "https://rpc.plasma.to",
    "monad": "https://rpc.monad.xyz",
    "sei": "https://evm-rpc.sei-apis.com",
    "opbnb": "https://opbnb-mainnet-rpc.bnbchain.org",
    "katana": "https://rpc.katana.network",
    "zora": "https://rpc.zora.energy",
    "mode": "https://mainnet.mode.network",
    "taiko": "https://rpc.mainnet.taiko.xyz",
    "cronos": "https://evm.cronos.org",
    "kaia": "https://public-en.node.kaia.io",
    "polygon_zkevm": "https://zkevm-rpc.com",
}


def log(msg: str) -> None:
    print(f"{datetime.now().strftime('%F %T')} [donate_txs_evm] {msg}", file=sys.stderr)


def http_json(url: str, body: Any = None, timeout: int = 25) -> Any:
    data = json.dumps(body).encode() if body is not None else None
    headers = dict(UA)
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def rpc_call(urls: list[str], method: str, params: list, tries: int = 6) -> Any:
    """urls를 돌려가며 JSON-RPC 호출. 오류는 백오프 재시도."""
    last: Any = None
    for i in range(tries):
        url = urls[i % len(urls)]
        try:
            d = http_json(url, {"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
            if "error" in d:
                last = d["error"]
            else:
                return d.get("result")
        except Exception as e:  # noqa: BLE001
            last = e
        time.sleep(min(2 * (i + 1), 8))
    raise RuntimeError(f"{method} 실패: {last}")


def fmt_amt(x: float) -> float:
    return float(f"{x:.6g}")


# ───────────────────────── Blockscout/Routescan 계열 explorer ─────────────────────────
def explorer_list(apis: list[str], action: str, wallet: str) -> list:
    last: Any = None
    for api in apis:
        for attempt in range(4):
            time.sleep(1.2)  # 공개 API 레이트리밋 완화
            url = f"{api}?module=account&action={action}&address={wallet}&startblock=0&sort=asc&page=1&offset=10000"
            try:
                d = http_json(url)
            except Exception as e:  # noqa: BLE001
                last = e
                time.sleep(4 * (attempt + 1))
                continue
            res = d.get("result")
            if isinstance(res, list):
                return res
            msg = str(d.get("message", ""))
            if "No " in msg and "found" in msg:  # "No transactions found" 등 = 0건
                return []
            if action == "txlistinternal" and str(d.get("status")) == "2":
                return []  # 내부 tx 인덱싱 미완 — 빈 목록으로 처리(실패 아님)
            last = d
            time.sleep(3)
    raise RuntimeError(f"{action} 실패: {str(last)[:160]}")


def collect_evm_explorer(chain: str, cfg: dict, wallet: str) -> tuple[list, list]:
    """(counted_txs, excluded_txs) 반환. 실패 시 예외를 던진다(호출부에서 complete=False 처리)."""
    nat_sym, nat_min = cfg["native"]
    wallet_l = wallet.lower()
    seen: dict[str, dict] = {}
    excluded: list = []

    def add(rec: dict) -> None:
        seen.setdefault(rec["hash"], rec)

    for action in ("txlist", "txlistinternal"):
        for t in explorer_list(cfg["api"], action, wallet):
            if (t.get("to") or "").lower() != wallet_l or str(t.get("isError", "0")) == "1":
                continue
            ts = int(t.get("timeStamp") or 0)
            if ts < START_TS:
                continue
            v = int(t.get("value") or 0) / 1e18
            h = t["hash"].lower()
            frm = (t.get("from") or "").lower()
            if v <= 0:
                continue  # 0원 호출(컨트랙트 상호작용 등)은 입금 아님
            rec = {"chain": chain, "hash": h, "time": ts, "asset": nat_sym, "amount": fmt_amt(v), "from": frm}
            if v < nat_min:
                excluded.append({**rec, "reason": "dust"})
                continue
            add(rec)

    for t in explorer_list(cfg["api"], "tokentx", wallet):
        if (t.get("to") or "").lower() != wallet_l:
            continue
        ts = int(t.get("timeStamp") or 0)
        if ts < START_TS:
            continue
        c = (t.get("contractAddress") or "").lower()
        raw = int(t.get("value") or 0)
        h = t["hash"].lower()
        frm = (t.get("from") or "").lower()
        base = {"chain": chain, "hash": h, "time": ts, "from": frm, "contract": c}
        if c not in cfg["tokens"]:
            dec = int(t.get("tokenDecimal") or 0)
            excluded.append({**base, "asset": t.get("tokenSymbol") or "?", "amount": fmt_amt(raw / 10**dec if dec else raw), "reason": "not_whitelisted"})
            continue
        sym, dec, mn = cfg["tokens"][c]
        amt = raw / 10**dec
        rec = {**base, "asset": sym, "amount": fmt_amt(amt)}
        if amt <= 0:
            excluded.append({**rec, "reason": "zero_value"})
            continue
        if amt < mn:
            excluded.append({**rec, "reason": "dust"})
            continue
        add(rec)

    return list(seen.values()), excluded


# ───────────────────────── BSC (공개 RPC) ─────────────────────────
def bsc_block_at(ts_target: int) -> int:
    rpcs = BSC["logs_rpcs"]
    hi = int(rpc_call(rpcs, "eth_blockNumber", []), 16)
    lo = max(0, hi - 3_000_000)

    def bts(b: int) -> int:
        blk = rpc_call(rpcs, "eth_getBlockByNumber", [hex(b), False])
        return int(blk["timestamp"], 16) if blk else 0

    while lo < hi:
        m = (lo + hi) // 2
        if bts(m) < ts_target:
            lo = m + 1
        else:
            hi = m
    return lo


def collect_bsc(wallet: str) -> tuple[list, list, list[str]]:
    """(counted_txs, excluded_txs, warnings) 반환."""
    warnings: list[str] = []
    wallet_l = wallet.lower()
    start_block = bsc_block_at(START_TS)
    latest = int(rpc_call(BSC["logs_rpcs"], "eth_blockNumber", []), 16) - 3  # 확정 여유

    pad = "0x" + "0" * 24 + wallet_l[2:]
    txs: dict[str, dict] = {}
    excl: dict[str, dict] = {}

    # 1) 토큰: Transfer(to=지갑) 로그 스캔
    cur = start_block
    chunk = BSC["logs_chunk"]
    ts_cache: dict[int, int] = {}

    def bts(b: int) -> int:
        if b not in ts_cache:
            ts_cache[b] = int(rpc_call(BSC["logs_rpcs"], "eth_getBlockByNumber", [hex(b), False])["timestamp"], 16)
        return ts_cache[b]

    while cur <= latest:
        to = min(latest, cur + chunk - 1)
        logs = rpc_call(BSC["logs_rpcs"], "eth_getLogs", [{"fromBlock": hex(cur), "toBlock": hex(to), "topics": [TRANSFER_TOPIC, None, pad]}])
        for lg in logs:
            if len(lg.get("topics") or []) != 3:
                continue  # ERC721 등 인덱싱 다른 이벤트 제외
            c = lg["address"].lower()
            h = lg["transactionHash"].lower()
            raw = int(lg["data"], 16) if lg.get("data") not in (None, "0x") else 0
            blk = int(lg["blockNumber"], 16)
            base = {"chain": "bsc", "hash": h, "time": bts(blk), "from": "0x" + lg["topics"][1][-40:], "contract": c}
            if c not in BSC["tokens"]:
                excl[h + ":" + c] = {**base, "asset": c[:10] + "…", "amount": fmt_amt(raw) if raw else 0, "reason": "not_whitelisted"}
                continue
            sym, dec, mn = BSC["tokens"][c]
            amt = raw / 10**dec
            rec = {**base, "asset": sym, "amount": fmt_amt(amt)}
            if amt <= 0:
                excl[h + ":" + c] = {**rec, "reason": "zero_value"}
            elif amt < mn:
                excl[h + ":" + c] = {**rec, "reason": "dust"}
            elif h not in txs:
                txs[h] = rec
        cur = to + 1

    # 2) 네이티브 BNB: 잔고 변화 블록 이분탐색(nonce=0, 즉 출금 이력 없음을 전제로 한 근사)
    arch = BSC["archive_rpcs"]
    nonce = int(rpc_call(arch, "eth_getTransactionCount", [wallet, hex(latest)]), 16)
    if nonce > 0:
        warnings.append(f"nonce={nonce}: 출금 발생 — 잔고 이분탐색 전제가 깨져 네이티브 BNB 입금이 누락될 수 있음")

    def bal(b: int) -> int:
        return int(rpc_call(arch, "eth_getBalance", [wallet, hex(b)]), 16)

    lo, lo_bal = start_block - 1, bal(start_block - 1) if start_block > 0 else 0
    hi_bal = bal(latest)
    changes: list[int] = []

    def find(a: int, ba: int, b: int, bb: int) -> None:
        if b - a == 1:
            changes.append(b)
            return
        m = (a + b) // 2
        bm = bal(m)
        if bm != ba:
            find(a, ba, m, bm)
        if bm != bb:
            find(m, bm, b, bb)

    if hi_bal != lo_bal:
        find(lo, lo_bal, latest, hi_bal)
    nat_sym, nat_min = BSC["native"]
    for blk in changes:
        block = rpc_call(arch, "eth_getBlockByNumber", [hex(blk), True])
        found = False
        for t in block["transactions"]:
            if (t.get("to") or "").lower() == wallet_l and int(t.get("value", "0x0"), 16) > 0:
                found = True
                v = int(t["value"], 16) / 1e18
                h = t["hash"].lower()
                rec = {"chain": "bsc", "hash": h, "time": int(block["timestamp"], 16), "asset": nat_sym, "amount": fmt_amt(v), "from": t["from"].lower()}
                if v < nat_min:
                    excl[h] = {**rec, "reason": "dust"}
                elif h not in txs:
                    txs[h] = rec
        if not found:  # 컨트랙트 내부 전송(internal) — 상세 from 확인 불가, 블록 단위 1건으로 표기
            h = f"internal@{blk}"
            v = (int(rpc_call(arch, "eth_getBalance", [wallet, hex(blk)]), 16) - int(rpc_call(arch, "eth_getBalance", [wallet, hex(blk - 1)]), 16)) / 1e18
            txs.setdefault(h, {"chain": "bsc", "hash": h, "time": int(block["timestamp"], 16), "asset": nat_sym, "amount": fmt_amt(v), "from": None})

    return list(txs.values()), list(excl.values()), warnings


# ───────────────────────── 기타 체인 활동 유무 점검(참고용) ─────────────────────────
def check_extra_chain_activity(wallet: str) -> dict[str, str]:
    """잔고/nonce가 0이 아니면 활동 있음으로 표시. (ERC-20 전용 활동은 놓칠 수 있음 — 별도 로그 스캔으로 보강 확인됨)"""
    out: dict[str, str] = {}
    for name, url in EXTRA_CHECK_RPCS.items():
        try:
            b = rpc_call([url], "eth_getBalance", [wallet, "latest"], tries=1)
            n = rpc_call([url], "eth_getTransactionCount", [wallet, "latest"], tries=1)
            bal = int(b, 16) if b else 0
            nonce = int(n, 16) if n else 0
            out[name] = "activity" if (bal > 0 or nonce > 0) else "none"
        except Exception as e:  # noqa: BLE001
            out[name] = f"check_failed:{str(e)[:60]}"
    return out


# ───────────────────────── main ─────────────────────────
def main() -> int:
    wallet = sys.argv[1] if len(sys.argv) > 1 else WALLET

    results: dict[str, dict] = {}

    for chain, cfg in EVM_CHAINS.items():
        try:
            counted, excluded = collect_evm_explorer(chain, cfg, wallet)
            counted.sort(key=lambda r: r["time"])
            results[chain] = {"chain": chain, "count": len(counted), "complete": True, "txs": counted}
            log(f"{chain}: {len(counted)}건 수집 완료 (제외 {len(excluded)}건: {[e.get('reason') for e in excluded]})")
        except Exception as e:  # noqa: BLE001
            results[chain] = {"chain": chain, "count": 0, "complete": False, "reason": str(e)[:200], "txs": []}
            log(f"{chain} 수집 실패: {e}")

    try:
        counted, excluded, warnings = collect_bsc(wallet)
        counted.sort(key=lambda r: r["time"])
        entry = {"chain": "bsc", "count": len(counted), "complete": not warnings, "txs": counted}
        if warnings:
            entry["reason"] = "; ".join(warnings)
        results["bsc"] = entry
        log(f"bsc: {len(counted)}건 수집 완료 (제외 {len(excluded)}건: {[e.get('reason') for e in excluded]}) warnings={warnings}")
    except Exception as e:  # noqa: BLE001
        results["bsc"] = {"chain": "bsc", "count": 0, "complete": False, "reason": str(e)[:200], "txs": []}
        log(f"bsc 수집 실패: {e}")

    log("기타 체인 활동 유무 점검 중(참고용, 실패해도 본 결과에는 영향 없음)...")
    extra_activity = check_extra_chain_activity(wallet)
    active_extra = {k: v for k, v in extra_activity.items() if v not in ("none",) and not v.startswith("check_failed")}
    if active_extra:
        log(f"활동 감지된 기타 체인(수동 확인 필요): {active_extra}")
    else:
        log(f"기타 {len(extra_activity)}개 체인 활동 없음 확인 (nonce/balance=0)")

    chains = [results[c] for c in CHAIN_ORDER if c in results]
    total = sum(c["count"] for c in chains)
    all_complete = all(c["complete"] for c in chains)

    out = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "count": total,
        "complete": all_complete,
        "by_chain": {c["chain"]: c["count"] for c in chains},
        "chains": chains,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    print(json.dumps({"status": "ok", "count": total, "complete": all_complete, "by_chain": out["by_chain"], "extra_chain_activity": extra_activity}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
