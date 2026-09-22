#!/usr/bin/env python3
"""
donate_txs_sol.py — Count ALL incoming transfer transactions (full history)
into a Solana wallet, covering native SOL and SPL/Token-2022 token receipts.

Reusable / standalone. Writes:
  /Users/fireant/fireant-dashboard/data/donate_txs_sol.json

Shape:
{
  "updated_at": "<ISO-UTC>",
  "chain": "solana",
  "count": N,                # number of distinct tx signatures counted as incoming
  "complete": true|false,    # false if any tx fetch failed after retries
  "txs": [
    {"hash": "...", "time": 1234567890, "asset": "SOL", "amount": 1.23, "from": "..."},
    ...
  ]
}

Method
------
1. Enumerate the wallet's SOL address + all its SPL Token / Token-2022 accounts
   (getTokenAccountsByOwner) and pull every signature that touches any of
   those addresses (getSignaturesForAddress, paginated with `before`).
2. Fetch each transaction (getTransaction, jsonParsed, maxSupportedTransactionVersion
   starting at 0, auto-escalated on version-mismatch RPC errors).
3. Scan parsed top-level + inner instructions for System Program "transfer"
   and Token/Token-2022 "transfer"/"transferChecked" instructions whose
   destination is the wallet (native SOL) or a token account owned by the
   wallet (SPL). This naturally excludes txs where the wallet only sent /
   paid fees, since no such destination-matching instruction exists there.
4. Filter out zero-amount transfers, SOL dust (< 0.001 SOL) and spoofed /
   no-liquidity tokens (address-poisoning fakes) using a liquidity lookup
   against Jupiter's public token API. Known majors (SOL/USDC/USDT) are
   always kept without a network lookup.
5. One counted "tx" per signature that has >=1 qualifying receipt. If a
   single tx received multiple distinct assets, it appears as multiple
   line items in `txs` (same hash) but is only counted once in `count`.

Only stdlib (urllib) is used for HTTP. Safe to re-run any time.
"""
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

WALLET = "FQASshV6GR8ZGD7XTwsW7TQuz8Jou3GQcZ2HHwC5a8DW"
OUT_PATH = "/Users/fireant/fireant-dashboard/data/donate_txs_sol.json"

RPC_ENDPOINTS = [
    "https://api.mainnet-beta.solana.com",
    "https://solana-rpc.publicnode.com",
    "https://rpc.ankr.com/solana",
]

TOKEN_PROGRAMS = [
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",  # SPL Token
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",  # Token-2022
]

SYSTEM_PROGRAM = "11111111111111111111111111111111111111"

# Always-trusted majors, no liquidity lookup needed.
KNOWN_MINTS = {
    "So11111111111111111111111111111111111111112": "SOL",  # wrapped SOL
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": "USDC",
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": "USDT",
}

DUST_SOL = 0.001
DUST_STABLE_USD = 0.01  # USDC/USDT below this is ~worthless -> address-poisoning "echo" dust
MIN_LIQUIDITY_USD = 500.0  # below this (or unknown) => treat as spam / address-poisoning fake

REQUEST_TIMEOUT = 30
MAX_RETRIES = 6
RETRY_BASE_SLEEP = 2.0
SIG_PAGE_LIMIT = 1000

_token_meta_cache = {}


def log(*a):
    print(*a, file=sys.stderr)


HTTP_HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
}


def rpc_call(method, params):
    last_err = None
    for endpoint in RPC_ENDPOINTS:
        for attempt in range(MAX_RETRIES):
            try:
                payload = json.dumps(
                    {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
                ).encode()
                req = urllib.request.Request(endpoint, data=payload, headers=HTTP_HEADERS)
                with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
                    body = json.load(resp)
                if "error" in body:
                    err = body["error"]
                    code = err.get("code") if isinstance(err, dict) else None
                    msg = str(err)
                    if code == 429 or "429" in msg or "Too many requests" in msg:
                        time.sleep(RETRY_BASE_SLEEP * (attempt + 1))
                        continue
                    return None, msg  # non-retryable RPC error (e.g. bad params)
                return body.get("result"), None
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    time.sleep(RETRY_BASE_SLEEP * (attempt + 1))
                    continue
                last_err = f"HTTP {e.code}: {e.reason}"
                time.sleep(RETRY_BASE_SLEEP)
            except Exception as e:  # noqa: BLE001
                last_err = str(e)
                time.sleep(RETRY_BASE_SLEEP)
        # exhausted retries on this endpoint, try next one
    return None, last_err or "unknown error"


def get_token_accounts(owner):
    accounts = set()
    for program in TOKEN_PROGRAMS:
        result, err = rpc_call(
            "getTokenAccountsByOwner",
            [owner, {"programId": program}, {"encoding": "jsonParsed"}],
        )
        if err:
            log(f"WARN getTokenAccountsByOwner({program}) failed: {err}")
            continue
        for item in (result or {}).get("value", []):
            accounts.add(item["pubkey"])
    return accounts


def get_all_signatures(address):
    sigs = {}
    before = None
    while True:
        opts = {"limit": SIG_PAGE_LIMIT}
        if before:
            opts["before"] = before
        result, err = rpc_call("getSignaturesForAddress", [address, opts])
        if err:
            log(f"WARN getSignaturesForAddress({address}) failed: {err}")
            break
        if not result:
            break
        for item in result:
            sigs[item["signature"]] = item
        if len(result) < SIG_PAGE_LIMIT:
            break
        before = result[-1]["signature"]
        time.sleep(0.15)
    return sigs


def combined_account_keys(tx):
    msg = tx["transaction"]["message"]
    keys = [k["pubkey"] if isinstance(k, dict) else k for k in msg.get("accountKeys", [])]
    meta = tx.get("meta") or {}
    loaded = meta.get("loadedAddresses") or {}
    keys += loaded.get("writable", []) or []
    keys += loaded.get("readonly", []) or []
    return keys


def token_account_info_map(tx):
    """pubkey -> {owner, mint, decimals} for every token account referenced in the tx."""
    keys = combined_account_keys(tx)
    meta = tx.get("meta") or {}
    m = {}
    for b in (meta.get("preTokenBalances") or []) + (meta.get("postTokenBalances") or []):
        idx = b.get("accountIndex")
        if idx is None or idx >= len(keys):
            continue
        pubkey = keys[idx]
        m[pubkey] = {
            "owner": b.get("owner"),
            "mint": b.get("mint"),
            "decimals": (b.get("uiTokenAmount") or {}).get("decimals"),
        }
    return m


def flatten_instructions(tx):
    msg = tx["transaction"]["message"]
    instrs = list(msg.get("instructions") or [])
    meta = tx.get("meta") or {}
    for grp in meta.get("innerInstructions") or []:
        instrs.extend(grp.get("instructions") or [])
    return instrs


def lookup_token_meta(mint):
    """Return (symbol, liquidity_usd) using Jupiter's public token API, cached."""
    if mint in _token_meta_cache:
        return _token_meta_cache[mint]
    symbol, liquidity = None, 0.0
    url = f"https://lite-api.jup.ag/tokens/v2/search?query={mint}"
    req = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": HTTP_HEADERS["User-Agent"]},
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.load(resp)
            for item in data or []:
                if item.get("id") == mint:
                    symbol = item.get("symbol") or mint[:6]
                    liquidity = float(item.get("liquidity") or 0.0)
                    break
            break
        except Exception as e:  # noqa: BLE001
            log(f"WARN token meta lookup failed for {mint} (attempt {attempt + 1}): {e}")
            time.sleep(1.5)
    _token_meta_cache[mint] = (symbol, liquidity)
    return symbol, liquidity


def classify_asset(mint):
    """Return (keep: bool, symbol: str, reason: str)."""
    if mint in KNOWN_MINTS:
        return True, KNOWN_MINTS[mint], "known major"
    symbol, liquidity = lookup_token_meta(mint)
    if symbol and liquidity >= MIN_LIQUIDITY_USD:
        return True, symbol, f"liquidity ${liquidity:,.0f}"
    return False, symbol or mint[:8], "no/low liquidity - likely spam or spoof"


def extract_receipts(sig, tx):
    """Return list of (asset, amount, from_addr) qualifying receipts, and list of excluded (asset, amount, reason)."""
    receipts = []
    excluded = []
    tok_map = token_account_info_map(tx)

    for instr in flatten_instructions(tx):
        parsed = instr.get("parsed")
        if not isinstance(parsed, dict):
            continue
        program = instr.get("program")
        itype = parsed.get("type")
        info = parsed.get("info") or {}

        if program == "system" and itype in ("transfer", "transferWithSeed"):
            destination = info.get("destination")
            source = info.get("source")
            lamports = info.get("lamports")
            if destination == WALLET and lamports:
                amount = lamports / 1e9
                if amount < DUST_SOL:
                    excluded.append(("SOL", amount, f"dust < {DUST_SOL} SOL"))
                else:
                    receipts.append(("SOL", amount, source or "unknown"))

        elif program in ("spl-token", "spl-token-2022") and itype in ("transfer", "transferChecked"):
            destination = info.get("destination")
            source = info.get("source")
            dest_info = tok_map.get(destination)
            if not dest_info or dest_info.get("owner") != WALLET:
                continue
            mint = info.get("mint") or dest_info.get("mint") or (tok_map.get(source) or {}).get("mint")
            if not mint:
                continue
            if itype == "transferChecked":
                ui_amount = (info.get("tokenAmount") or {}).get("uiAmount")
                amount = float(ui_amount) if ui_amount is not None else 0.0
            else:
                decimals = dest_info.get("decimals")
                if decimals is None:
                    decimals = (tok_map.get(source) or {}).get("decimals") or 0
                raw = info.get("amount")
                amount = (float(raw) / (10 ** decimals)) if raw is not None else 0.0

            if amount <= 0:
                excluded.append((mint, amount, "zero amount"))
                continue

            from_addr = (tok_map.get(source) or {}).get("owner") or "unknown"
            keep, symbol, reason = classify_asset(mint)
            if keep and symbol in ("USDC", "USDT") and amount < DUST_STABLE_USD:
                # Sub-cent stablecoin "echo" transfers are the classic Solana
                # address-poisoning pattern: attacker sends a near-zero amount
                # of a REAL mint from a vanity address that visually mimics a
                # genuine sender/wallet address, hoping the victim later
                # copies the wrong address from tx history. Real mint, fake intent.
                keep = False
                reason = f"sub-cent stablecoin dust (< ${DUST_STABLE_USD}) - likely address-poisoning echo"
            if keep:
                receipts.append((symbol, amount, from_addr))
            else:
                excluded.append((symbol, amount, reason))

    return receipts, excluded


def get_transaction(sig):
    """getTransaction, jsonParsed, auto-escalating maxSupportedTransactionVersion
    if the RPC reports a higher tx version than requested."""
    last_err = None
    for version in (0, 1, 2, 3):
        result, err = rpc_call(
            "getTransaction",
            [sig, {"encoding": "jsonParsed", "maxSupportedTransactionVersion": version}],
        )
        if err is None:
            return result, None
        last_err = err
        if "not supported by the requesting client" in err or "-32015" in err:
            continue  # bump version and retry
        break
    return None, last_err


def main():
    log(f"Collecting token accounts for {WALLET} ...")
    token_accounts = get_token_accounts(WALLET)
    log(f"Found {len(token_accounts)} token account(s): {sorted(token_accounts)}")

    addresses = [WALLET] + sorted(token_accounts)
    all_sigs = {}
    for addr in addresses:
        sigs = get_all_signatures(addr)
        log(f"  {addr}: {len(sigs)} signature(s)")
        all_sigs.update(sigs)

    log(f"Total unique signatures: {len(all_sigs)}")

    ordered_sigs = sorted(all_sigs.items(), key=lambda kv: kv[1].get("blockTime") or 0)

    complete = True
    failed_sigs = []
    counted_txs = []
    excluded_report = []
    seen_signatures = set()

    for i, (sig, meta) in enumerate(ordered_sigs, 1):
        result, err = get_transaction(sig)
        if err or result is None:
            log(f"FAIL getTransaction {sig}: {err}")
            failed_sigs.append(sig)
            complete = False
            time.sleep(0.2)
            continue

        receipts, excluded = extract_receipts(sig, result)
        block_time = result.get("blockTime") or meta.get("blockTime")

        # aggregate by asset within this signature
        agg = {}
        for asset, amount, from_addr in receipts:
            key = asset
            if key not in agg:
                agg[key] = {"amount": 0.0, "froms": []}
            agg[key]["amount"] += amount
            if from_addr not in agg[key]["froms"]:
                agg[key]["froms"].append(from_addr)

        if agg:
            seen_signatures.add(sig)
            for asset, d in agg.items():
                counted_txs.append(
                    {
                        "hash": sig,
                        "time": block_time,
                        "asset": asset,
                        "amount": round(d["amount"], 9),
                        "from": ",".join(d["froms"]),
                    }
                )

        for asset, amount, reason in excluded:
            excluded_report.append({"hash": sig, "asset": asset, "amount": amount, "reason": reason})

        if i % 10 == 0 or i == len(ordered_sigs):
            log(f"  processed {i}/{len(ordered_sigs)}")
        time.sleep(0.12)

    counted_txs.sort(key=lambda t: (t["time"] or 0))

    out = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "chain": "solana",
        "count": len(seen_signatures),
        "complete": complete,
        "txs": counted_txs,
    }

    with open(OUT_PATH, "w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)

    log(f"Wrote {OUT_PATH}")
    log(f"count={out['count']} complete={out['complete']} failed_sigs={len(failed_sigs)}")
    if excluded_report:
        log(f"Excluded {len(excluded_report)} spam/dust entries:")
        for e in excluded_report:
            log(f"  {e['hash'][:12]}... {e['asset']} {e['amount']} - {e['reason']}")

    return out, excluded_report, failed_sigs


if __name__ == "__main__":
    main()
