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

재실행 가능(idempotent). STATE_PATH에 체인별 마지막 블록과 수집 결과를 저장해 증분 조회한다.
  - explorer 체인: startblock=마지막으로 본 블록-EXPLORER_MARGIN_BLOCKS부터 조회, 해시 기준 병합.
    blockscout 계열 호출은 전역 직렬화(1.2초 간격), 429는 Retry-After 백오프(EXPLORER_TIME_BUDGET 내).
    증분 실행 중 일시 실패하면 그 체인의 직전 캐시를 재사용하고 커서는 유지(다음 실행 재시도).
  - BSC: 마지막 스캔 블록 이후만 스캔(재편성 대비 BSC_REORG_MARGIN 블록 겹침, 해시 기준 중복 제거).
  - 기타 체인 활동 점검은 1시간에 1회만 실제 조회한다.
상태 파일이 없거나 깨졌으면 자동으로 전체 스캔. 소스가 실패한 체인은
`complete: false`와 이유를 남기고 숫자를 임의로 보정하지 않는다.

사용법:
  python3 donate_txs_evm.py [지갑주소] [--full]   # 지갑 생략 시 기본 지갑(WALLET)
  --full: 상태 무시하고 전체 재스캔(상태도 새로 저장)
"""
from __future__ import annotations

import json
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

OUT = Path("/Users/fireant/fireant-dashboard/data/donate_txs_evm.json")
# 증분 상태(레포 밖 — 러너가 추적 파일을 git checkout으로 되돌려도 유지되어야 함)
STATE_PATH = Path("/Users/fireant/.openclaw/state/donate_sync/evm_state.json")
STATE_VERSION = 2
BSC_REORG_MARGIN = 20  # 증분 스캔 시 마지막 스캔 블록보다 이만큼 앞에서 재스캔(해시/로그 키로 중복 제거)
EXPLORER_MARGIN_BLOCKS = 5000  # explorer 증분 조회 시 마지막으로 본 블록보다 이만큼 앞부터 재조회(인덱싱 지연 대비, 해시로 중복 제거)
EXPLORER_TIME_BUDGET = 75  # 증분 실행에서 explorer 조회(429 백오프 포함) 최대 소요 시간(초) — 5분 주기 기준
# 변화 감지 게이트: 매 실행 공개 RPC로 잔고 + 화이트리스트 토큰 Transfer(to=지갑) 로그만 확인하고,
# 변화가 있을 때만 explorer를 호출한다(explorer 공개 API 쿼터 절약). 안전망으로 주기적 강제 재조회.
GATE_MAX_SPAN = 5000  # 게이트 로그 조회 최대 블록 폭 — 더 벌어졌으면(장기 중단 등) 그냥 explorer 조회
EXPLORER_REFRESH_INTERVAL = 6 * 3600  # 변화가 없어도 이 주기(초)마다 explorer 증분 재조회(안전망, 3회 호출)
PENDING_MAX_AGE = 1800  # explorer 인덱싱 대기(pending) 최대 유지 시간(초) — 넘으면 해제(무한 재호출 방지)  # 증분 실행에서 explorer 조회(429 백오프 포함) 최대 소요 시간(초)
EXTRA_CHECK_INTERVAL = 3600  # 기타 체인 활동 점검 최소 주기(초) — 그 사이엔 마지막 결과 재사용
UA = {"User-Agent": "Mozilla/5.0 (compatible; FireantHub-donate-evm/1.0)"}

WALLET = "0x403b5240c372ba850233911854ccc5f6f250e2a1"
START_TS = 1790002800  # 2026-09-22 00:00 KST — 지갑 최초 입금(09-22 19:2x KST)보다 넉넉히 이전

STABLE_MIN = 0.1  # 스테이블코인 최소 인정 수량(그 미만은 먼지로 제외)

# 체인별 explorer API(Etherscan 호환) + 네이티브 심볼/먼지 기준 + 화이트리스트 토큰
# {컨트랙트 주소(소문자): (심볼, decimals, 최소 인정 수량)}
EVM_CHAINS: dict[str, dict[str, Any]] = {
    "ethereum": {
        # routescan이 1순위(blockscout 공개 API는 IP 단위 쿼터가 작아 429가 잦음), blockscout은 폴백
        "api": ["https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api", "https://eth.blockscout.com/api"],
        "rpc": ["https://ethereum-rpc.publicnode.com", "https://1rpc.io/eth"],
        "native": ("ETH", 0.00003),
        "tokens": {
            "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": ("USDC", 6, STABLE_MIN),
            "0xdac17f958d2ee523a2206206994597c13d831ec7": ("USDT", 6, STABLE_MIN),
        },
    },
    "base": {
        "api": ["https://base.blockscout.com/api"],
        "rpc": ["https://base-rpc.publicnode.com", "https://mainnet.base.org"],
        "native": ("ETH", 0.00003),
        "tokens": {
            "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": ("USDC", 6, STABLE_MIN),
            "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2": ("USDT", 6, STABLE_MIN),
        },
    },
    "arbitrum": {
        "api": ["https://arbitrum.blockscout.com/api"],
        "rpc": ["https://arb1.arbitrum.io/rpc"],
        "native": ("ETH", 0.00003),
        "tokens": {
            "0xaf88d065e77c8cc2239327c5edb3a432268e5831": ("USDC", 6, STABLE_MIN),
            "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8": ("USDC.e", 6, STABLE_MIN),
            "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9": ("USDT0", 6, STABLE_MIN),
        },
    },
    "polygon": {
        "api": ["https://polygon.blockscout.com/api"],
        "rpc": ["https://polygon-bor-rpc.publicnode.com"],
        "native": ("POL", 0.5),
        "tokens": {
            "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": ("USDC", 6, STABLE_MIN),
            "0x2791bca1f2de4661ed88a30c99a7a9449aa84174": ("USDC.e", 6, STABLE_MIN),
            "0xc2132d05d31c914a87c6611c10748aeb04b58e8f": ("USDT", 6, STABLE_MIN),
        },
    },
    "optimism": {
        "api": ["https://optimism.blockscout.com/api", "https://explorer.optimism.io/api"],
        "rpc": ["https://optimism-rpc.publicnode.com", "https://mainnet.optimism.io"],
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
        "rpc": ["https://avalanche-c-chain-rpc.publicnode.com", "https://api.avax.network/ext/bc/C/rpc"],
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


def rpc_call(urls: list[str], method: str, params: list, tries: int = 6, timeout: int = 25) -> Any:
    """urls를 돌려가며 JSON-RPC 호출. 오류는 백오프 재시도."""
    last: Any = None
    for i in range(tries):
        url = urls[i % len(urls)]
        try:
            d = http_json(url, {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, timeout=timeout)
            if "error" in d:
                last = d["error"]
            else:
                return d.get("result")
        except Exception as e:  # noqa: BLE001
            last = e
        if i + 1 < tries:
            time.sleep(min(2 * (i + 1), 8))
    raise RuntimeError(f"{method} 실패: {last}")


def fmt_amt(x: float) -> float:
    return float(f"{x:.6g}")


# ───────────────────────── Blockscout/Routescan 계열 explorer ─────────────────────────
class RateGate:
    """호스트 그룹 단위 요청 직렬화 + 최소 간격 보장(스레드 안전)."""

    def __init__(self, min_interval: float) -> None:
        self.lock = threading.Lock()
        self.min_interval = min_interval
        self.last = 0.0

    def call(self, fn):
        with self.lock:
            wait = self.last + self.min_interval - time.time()
            if wait > 0:
                time.sleep(wait)
            try:
                return fn()
            finally:
                self.last = time.time()


# *.blockscout.com(및 blockscout 기반 explorer.optimism.io)은 IP 단위 리미터를 공유하는 것으로 보여
# 체인이 달라도 한 줄로 세운다. routescan(avalanche)은 별도 게이트.
_GATES = {"blockscout": RateGate(1.2), "other": RateGate(1.2)}


def _gate_for(api: str) -> RateGate:
    return _GATES["blockscout"] if ("blockscout" in api or "explorer.optimism.io" in api) else _GATES["other"]


class Deadline(Exception):
    pass


class RateLimited(Exception):
    """429 대기 시간이 이번 실행 예산을 넘음. cooldown(초) 동안 해당 explorer 호출을 쉬어야 함."""

    def __init__(self, msg: str, cooldown: float) -> None:
        super().__init__(msg)
        self.cooldown = cooldown


def explorer_list(apis: list[str], action: str, wallet: str, startblock: int = 0, deadline: float | None = None) -> list:
    """explorer account API 목록 조회. 429는 Retry-After(없으면 지수 백오프)를 따르되 deadline을 넘기면 즉시 실패."""
    last: Any = None

    def pause(sec: float) -> None:
        if deadline is not None and time.time() + sec > deadline:
            raise Deadline(f"{action} 시간 예산 초과(마지막 오류: {str(last)[:120]})")
        time.sleep(sec)

    for api in apis:
        gate = _gate_for(api)
        for attempt in range(4):
            if deadline is not None and time.time() > deadline:
                raise Deadline(f"{action} 시간 예산 초과(마지막 오류: {str(last)[:120]})")
            url = f"{api}?module=account&action={action}&address={wallet}&startblock={startblock}&sort=asc&page=1&offset=10000"
            try:
                d = gate.call(lambda: http_json(url))
            except urllib.error.HTTPError as e:
                last = e
                if e.code == 429:
                    hdr = e.headers or {}
                    wait = 3.0 * (2 ** attempt)
                    try:
                        if hdr.get("Retry-After"):
                            wait = float(hdr["Retry-After"])
                        elif hdr.get("x-ratelimit-reset"):
                            wait = float(hdr["x-ratelimit-reset"]) / 1000.0  # blockscout: 남은 ms
                    except ValueError:
                        pass
                    if wait > 30.0 or (deadline is not None and time.time() + wait > deadline):
                        raise RateLimited(f"{action} 429 — {int(wait)}초 대기 필요", min(max(wait, 60.0), 3600.0))
                    pause(wait)
                else:
                    pause(4 * (attempt + 1))
                continue
            except Exception as e:  # noqa: BLE001
                last = e
                pause(4 * (attempt + 1))
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
            pause(3)
    raise RuntimeError(f"{action} 실패: {str(last)[:160]}")


def collect_evm_explorer(chain: str, cfg: dict, wallet: str, prev: dict | None = None, deadline: float | None = None,
                         actions: list[str] | None = None) -> tuple[list, list, dict]:
    """(counted_txs, excluded_txs, new_chain_state) 반환. 실패 시 예외를 던진다(호출부에서 처리).

    prev(이전 실행의 체인 상태 {last_block, txs})가 있으면 startblock=last_block-EXPLORER_MARGIN_BLOCKS부터만
    조회하고 이전 결과에 해시 기준으로 병합한다(먼저 기록된 레코드 우선 — 전체 조회와 동일한 규칙).
    """
    nat_sym, nat_min = cfg["native"]
    wallet_l = wallet.lower()
    seen: dict[str, dict] = dict(prev["txs"]) if prev else {}
    excluded: list = []
    last_block = int(prev["last_block"]) if prev else 0
    startblock = max(0, last_block - EXPLORER_MARGIN_BLOCKS) if prev else 0
    max_block = last_block

    def add(rec: dict) -> None:
        seen.setdefault(rec["hash"], rec)

    def note_block(t: dict) -> None:
        nonlocal max_block
        try:
            max_block = max(max_block, int(t.get("blockNumber") or 0))
        except (TypeError, ValueError):
            pass

    actions = actions or ["txlist", "txlistinternal", "tokentx"]
    for action in [a for a in ("txlist", "txlistinternal") if a in actions]:
        for t in explorer_list(cfg["api"], action, wallet, startblock, deadline):
            note_block(t)
            if (t.get("to") or "").lower() != wallet_l or str(t.get("isError", "0")) == "1":
                continue
            ts = int(t.get("timeStamp") or 0)
            if ts < START_TS:
                continue
            v = int(t.get("value") or 0) / 1e18
            # Blockscout txlistinternal은 "hash" 대신 "transactionHash"를 준다
            h = (t.get("hash") or t.get("transactionHash") or "").lower()
            frm = (t.get("from") or "").lower()
            if v <= 0:
                continue  # 0원 호출(컨트랙트 상호작용 등)은 입금 아님
            rec = {"chain": chain, "hash": h, "time": ts, "asset": nat_sym, "amount": fmt_amt(v), "from": frm}
            if v < nat_min:
                excluded.append({**rec, "reason": "dust"})
                continue
            add(rec)

    for t in (explorer_list(cfg["api"], "tokentx", wallet, startblock, deadline) if "tokentx" in actions else []):
        note_block(t)
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

    return list(seen.values()), excluded, {"last_block": max_block, "txs": seen}


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


def collect_bsc(wallet: str, state: dict | None, out_state: dict) -> tuple[list, list, list[str]]:
    """(counted_txs, excluded_txs, warnings) 반환.

    state(이전 실행의 BSC 상태)가 있으면 증분 스캔: 토큰 로그/네이티브 잔고 각각 마지막 스캔 블록
    -BSC_REORG_MARGIN부터 최신 블록까지만 훑고, 이전 결과(txs/excl)에 해시·로그 키 기준으로 병합한다.
    None이면 전체 스캔. 진행 상태는 out_state에 단계별로 기록한다 — 네이티브 단계에서 실패해도
    토큰 로그 스캔분은 보존되어 다음 실행이 처음부터 다시 훑지 않는다.
    """
    warnings: list[str] = []
    wallet_l = wallet.lower()
    rpcs = BSC["logs_rpcs"]
    if state:
        start_block = int(state["start_block"])
        logs_done = int(state["logs_block"])
        native_done = int(state["native_block"])
        txs: dict[str, dict] = dict(state["txs"])
        excl: dict[str, dict] = dict(state["excl"])
    else:
        start_block = bsc_block_at(START_TS)
        logs_done = native_done = start_block - 1
        txs = {}
        excl = {}
    out_state.update({"start_block": start_block, "logs_block": logs_done, "native_block": native_done, "txs": txs, "excl": excl})

    def scan_start(done: int) -> int:
        return max(start_block, done + 1 - BSC_REORG_MARGIN) if state else start_block

    latest = int(rpc_call(rpcs, "eth_blockNumber", []), 16) - 3  # 확정 여유
    logs_from = scan_start(logs_done)
    native_from = scan_start(native_done)
    log(f"bsc: {'증분' if state else '전체'} 스캔 — 토큰 로그 {logs_from}~{latest}, 네이티브 {native_from}~{latest} (최대 {max(0, latest - min(logs_from, native_from) + 1)}블록)")

    pad = "0x" + "0" * 24 + wallet_l[2:]

    # 1) 토큰: Transfer(to=지갑) 로그 스캔
    cur = logs_from
    chunk = BSC["logs_chunk"]
    ts_cache: dict[int, int] = {}

    def bts(b: int) -> int:
        if b not in ts_cache:
            ts_cache[b] = int(rpc_call(rpcs, "eth_getBlockByNumber", [hex(b), False])["timestamp"], 16)
        return ts_cache[b]

    while cur <= latest:
        to = min(latest, cur + chunk - 1)
        logs = rpc_call(rpcs, "eth_getLogs", [{"fromBlock": hex(cur), "toBlock": hex(to), "topics": [TRANSFER_TOPIC, None, pad]}])
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
        out_state["logs_block"] = max(out_state["logs_block"], to)

    # 2) 네이티브 BNB: 잔고 변화 블록 이분탐색(nonce=0, 즉 출금 이력 없음을 전제로 한 근사)
    arch = BSC["archive_rpcs"]
    nonce = int(rpc_call(arch, "eth_getTransactionCount", [wallet, hex(latest)]), 16)
    if nonce > 0:
        warnings.append(f"nonce={nonce}: 출금 발생 — 잔고 이분탐색 전제가 깨져 네이티브 BNB 입금이 누락될 수 있음")

    def bal(b: int) -> int:
        return int(rpc_call(arch, "eth_getBalance", [wallet, hex(b)]), 16)

    lo = native_from - 1
    if latest <= lo:  # 공개 RPC 노드 간 높이 차이 — 이번엔 새 블록 없음
        return list(txs.values()), list(excl.values()), warnings
    lo_bal = bal(lo) if lo >= 0 else 0
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

    out_state["native_block"] = max(out_state["native_block"], latest)
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


# ───────────────────────── 상태(증분 캐시) ─────────────────────────
def load_state(wallet: str) -> dict:
    """증분 상태 로드. 없거나 깨졌거나 지갑/버전이 다르면 빈 상태(=전체 재수집)."""
    try:
        st = json.loads(STATE_PATH.read_text())
        if st.get("version") != STATE_VERSION or st.get("wallet") != wallet.lower() or st.get("start_ts") != START_TS:
            log("상태 버전/지갑/START_TS 불일치 — 전체 재수집")
            return {}
        bsc = st.get("bsc")
        if bsc is not None:
            int(bsc["start_block"]), int(bsc["logs_block"]), int(bsc["native_block"])
            if not (isinstance(bsc["txs"], dict) and isinstance(bsc["excl"], dict)):
                raise ValueError("bsc shape")
        for ch, es in (st.get("explorers") or {}).items():
            int(es["last_block"])
            if not isinstance(es["txs"], dict):
                raise ValueError(f"explorer {ch} shape")
        return st
    except FileNotFoundError:
        log("상태 파일 없음 — 전체 재수집")
        return {}
    except Exception as e:  # noqa: BLE001
        log(f"상태 파일 손상({e}) — 전체 재수집")
        return {}


def save_state(st: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(st, ensure_ascii=False))
    tmp.replace(STATE_PATH)


# ───────────────────────── main ─────────────────────────
ALL_ACTIONS = ["txlist", "txlistinternal", "tokentx"]
KIND_ACTIONS = {"native": ["txlist", "txlistinternal"], "token": ["tokentx"]}


def gate_check(cfg: dict, wallet: str, gate: dict | None) -> tuple[dict, int | None, set[str]]:
    """공개 RPC로 변화 감지. (새 gate, 트리거 블록 또는 None, 변화 종류) 반환.
    변화 종류: "token"(화이트리스트 토큰 Transfer 로그) / "native"(잔고 변화) / "all"(조회 폭 초과 등).
    트리거 블록 -1 = 정확한 블록 미상('explorer 결과가 이전보다 앞으로 나아가야 함'). 실패 시 예외."""
    rpcs = cfg["rpc"]
    latest = int(rpc_call(rpcs, "eth_blockNumber", [], tries=3, timeout=8), 16) - 2  # 확정 여유
    bal = rpc_call(rpcs, "eth_getBalance", [wallet, hex(latest)], tries=3, timeout=8)
    new_gate = {"block": latest, "balance": bal}
    if not gate:
        return new_gate, None, set()
    frm = int(gate["block"]) + 1
    if latest < frm:
        return gate, None, set()  # 노드 높이 역전 — 변화 없음으로 보고 기존 게이트 유지
    if latest - frm > GATE_MAX_SPAN:
        return new_gate, -1, {"all"}
    pad = "0x" + "0" * 24 + wallet.lower()[2:]
    logs = rpc_call(rpcs, "eth_getLogs", [{"fromBlock": hex(frm), "toBlock": hex(latest), "address": list(cfg["tokens"]), "topics": [TRANSFER_TOPIC, None, pad]}], tries=3, timeout=8)
    kinds: set[str] = set()
    trig: int | None = None
    if logs:
        kinds.add("token")
        trig = max(int(lg["blockNumber"], 16) for lg in logs)
    if bal != gate.get("balance"):
        kinds.add("native")
        trig = trig if trig is not None else -1
    return new_gate, trig, kinds


def run_explorer(chain: str, cfg: dict, wallet: str, prev: dict | None, deadline: float | None) -> tuple[dict, dict | None]:
    """(결과 entry, 새 체인 상태 또는 None) 반환. None이면 이전 상태 유지.

    공개 blockscout API는 호스트당 시간당 10회 수준이라, 공개 RPC 게이트로 변화가 감지된 경우에만
    필요한 action만 호출한다(토큰 입금→tokentx, 잔고 변화→txlist+txlistinternal).
    """
    now = time.time()
    gate = (prev or {}).get("gate")
    pending = (prev or {}).get("pending")  # {"target": 블록, "since": ts, "kinds": [...]}
    try:
        new_gate, trig, kinds = gate_check(cfg, wallet, gate if prev else None)
        gate_ok = True
    except Exception as e:  # noqa: BLE001
        log(f"WARN {chain} 변화 감지(RPC) 실패 — explorer 조회로 대체: {str(e)[:120]}")
        new_gate, trig, kinds, gate_ok = gate, None, set(), False
    if trig is not None and prev:
        target = trig if trig >= 0 else int(prev["last_block"]) + 1
        old = pending or {}
        pending = {
            "target": max(target, int(old.get("target") or 0)),
            "since": old.get("since", now),
            "kinds": sorted(set(old.get("kinds") or []) | kinds),
        }

    # 체인마다 강제 재조회 시점을 5분씩 어긋나게(한 실행에 explorer 호출이 몰리지 않도록)
    refresh_due = now - float((prev or {}).get("refreshed_at") or 0) >= EXPLORER_REFRESH_INTERVAL + CHAIN_ORDER.index(chain) * 300
    if prev and gate_ok and not pending and not refresh_due:
        cached = sorted(prev["txs"].values(), key=lambda r: r["time"])
        st = {**prev, "gate": new_gate, "pending": None}
        return {"chain": chain, "count": len(cached), "complete": True, "txs": cached}, st
    cooldown_until = float((prev or {}).get("cooldown_until") or 0)
    if prev and now < cooldown_until:
        # 429 쿨다운 중 — explorer는 쉬고 캐시 사용. 감지된 변화(pending)는 유지해 쿨다운 후 반영.
        cached = sorted(prev["txs"].values(), key=lambda r: r["time"])
        log(f"WARN {chain} explorer 429 쿨다운 중({int(cooldown_until - now)}초 남음) — 직전 캐시 {len(cached)}건 사용, pending={pending}")
        st = {**prev, "gate": new_gate, "pending": pending}
        return {"chain": chain, "count": len(cached), "complete": True, "txs": cached}, st

    # 조회할 action 결정
    if not prev or not gate_ok or refresh_due or not pending or "all" in (pending.get("kinds") or []) or not pending.get("kinds"):
        actions = ALL_ACTIONS
    else:
        actions = [a for a in ALL_ACTIONS if any(a in KIND_ACTIONS[k] for k in pending["kinds"])]

    try:
        counted, excluded, new_state = collect_evm_explorer(chain, cfg, wallet, prev, deadline, actions)
        counted.sort(key=lambda r: r["time"])
        if pending:
            if new_state["last_block"] >= int(pending["target"]):
                pending = None
            elif now - float(pending["since"]) > PENDING_MAX_AGE:
                log(f"WARN {chain} explorer가 {PENDING_MAX_AGE // 60}분간 변화(블록 {pending['target']})를 반영하지 않음 — 대기 해제")
                pending = None
            else:
                log(f"{chain}: explorer 인덱싱 대기(목표 블록 {pending['target']}, 현재 {new_state['last_block']}) — 다음 실행 재조회")
        refreshed_at = now if actions == ALL_ACTIONS else float((prev or {}).get("refreshed_at") or 0)
        new_state.update({"gate": new_gate, "pending": pending, "refreshed_at": refreshed_at, "cooldown_until": 0})
        log(f"{chain}: {len(counted)}건 수집 완료({'증분' if prev else '전체'}, {'+'.join(actions)}) (이번 조회 제외 {len(excluded)}건: {[e.get('reason') for e in excluded]})")
        return {"chain": chain, "count": len(counted), "complete": True, "txs": counted}, new_state
    except Exception as e:  # noqa: BLE001
        if prev:
            # 일시 오류(429 등) — 직전 성공 결과를 그대로 쓰고 explorer 커서는 유지해 다음 실행에서 재시도
            cached = sorted(prev["txs"].values(), key=lambda r: r["time"])
            log(f"WARN {chain} explorer 조회 실패 — 직전 캐시 {len(cached)}건 재사용(커서 유지, 다음 실행 재시도): {e}")
            st = {**prev, "gate": new_gate, "pending": pending or {"target": int(prev["last_block"]), "since": now, "kinds": ["all"]}}
            if isinstance(e, RateLimited):
                st["cooldown_until"] = now + e.cooldown
            return {"chain": chain, "count": len(cached), "complete": True, "txs": cached}, st
        log(f"{chain} 수집 실패(캐시 없음): {e}")
        return {"chain": chain, "count": 0, "complete": False, "reason": str(e)[:200], "txs": []}, None


def run_bsc(wallet: str, prev: dict | None) -> tuple[dict, dict | None]:
    new_state: dict = {}
    try:
        counted, excluded, warnings = collect_bsc(wallet, prev, new_state)
        counted.sort(key=lambda r: r["time"])
        entry = {"chain": "bsc", "count": len(counted), "complete": not warnings, "txs": counted}
        if warnings:
            entry["reason"] = "; ".join(warnings)
        log(f"bsc: {len(counted)}건 수집 완료 (제외 {len(excluded)}건: {[e.get('reason') for e in excluded]}) warnings={warnings}")
        return entry, new_state
    except Exception as e:  # noqa: BLE001
        log(f"bsc 수집 실패: {e}")
        # 실패 전까지 끝난 단계의 진행분만 저장(커서는 완료된 구간까지만 전진) — 다음 실행이 이어서 스캔
        return {"chain": "bsc", "count": 0, "complete": False, "reason": str(e)[:200], "txs": []}, (new_state or None)


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    full = "--full" in sys.argv[1:]
    wallet = args[0] if args else WALLET

    st = {} if full else load_state(wallet)
    prev_bsc = st.get("bsc")
    prev_exp: dict = st.get("explorers") or {}
    log(f"mode={'full' if full or not (prev_bsc or prev_exp) else 'incremental'}")
    # 증분 실행은 explorer 조회 시간 예산을 둔다(429 백오프가 길어져도 1분 주기를 넘기지 않도록).
    deadline = None if full else time.time() + EXPLORER_TIME_BUDGET

    results: dict[str, dict] = {}
    new_exp: dict = {}

    now = time.time()
    extra = st.get("extra") or {}
    run_extra = full or not extra.get("result") or now - float(extra.get("checked_at") or 0) >= EXTRA_CHECK_INTERVAL

    # explorer 체인·BSC·기타 체인 점검을 병렬 실행. blockscout 계열 호출은 RateGate로 전역 직렬화된다.
    with ThreadPoolExecutor(max_workers=len(EVM_CHAINS) + 2) as ex:
        futs = {chain: ex.submit(run_explorer, chain, cfg, wallet, prev_exp.get(chain), deadline) for chain, cfg in EVM_CHAINS.items()}
        bsc_fut = ex.submit(run_bsc, wallet, prev_bsc)
        extra_fut = ex.submit(check_extra_chain_activity, wallet) if run_extra else None
        if run_extra:
            log("기타 체인 활동 유무 점검 중(참고용, 실패해도 본 결과에는 영향 없음)...")
        for chain, fut in futs.items():
            results[chain], ns = fut.result()
            if ns is not None:
                new_exp[chain] = ns
            elif not full and chain in prev_exp:
                new_exp[chain] = prev_exp[chain]
        results["bsc"], new_bsc = bsc_fut.result()
        extra_result = extra_fut.result() if extra_fut else None

    if extra_result is not None:
        extra_activity = extra_result
        extra = {"checked_at": now, "result": extra_activity}
    else:
        extra_activity = extra["result"]
        log(f"기타 체인 활동 점검 생략(최근 {int((now - float(extra['checked_at'])) // 60)}분 전 결과 재사용, 주기 {EXTRA_CHECK_INTERVAL // 60}분)")
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

    new_st = {
        "version": STATE_VERSION,
        "wallet": wallet.lower(),
        "start_ts": START_TS,
        "bsc": new_bsc if new_bsc is not None else (None if full else prev_bsc),
        "explorers": new_exp,
        "extra": extra,
    }
    save_state(new_st)

    print(json.dumps({"status": "ok", "count": total, "complete": all_complete, "by_chain": out["by_chain"], "extra_chain_activity": extra_activity}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
