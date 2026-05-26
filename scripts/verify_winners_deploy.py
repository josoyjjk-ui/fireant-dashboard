#!/usr/bin/env python3
"""Verify that the public winners page is serving the current main branch data."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

REPO_ROOT = Path(__file__).resolve().parents[1]
LOCAL_WINNERS = REPO_ROOT / "winners.json"
RAW_URL = "https://raw.githubusercontent.com/josoyjjk-ui/fireant-dashboard/main/winners.json"
LIVE_JSON_URL = "https://fireantcrypto.com/winners.json"
LIVE_PAGE_URL = "https://fireantcrypto.com/winners/"


def fetch_text(url: str) -> str:
    request = Request(
        url,
        headers={
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "User-Agent": "fireant-winners-deploy-verifier/1.0",
        },
    )
    with urlopen(request, timeout=20) as response:
        return response.read().decode("utf-8")


def load_json(source: str, text: str) -> list[dict]:
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{source} is not valid JSON: {exc}") from exc
    if not isinstance(data, list):
        raise ValueError(f"{source} must be a JSON array")
    return data


def digest(data: list[dict]) -> str:
    payload = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def event_names(data: list[dict]) -> set[str]:
    return {str(item.get("event", "")).strip() for item in data if item.get("event")}


def verify(expect_event: str | None, expect_count: int | None) -> tuple[bool, str]:
    local = load_json(str(LOCAL_WINNERS), LOCAL_WINNERS.read_text(encoding="utf-8"))
    raw = load_json(RAW_URL, fetch_text(f"{RAW_URL}?verify={int(time.time())}"))
    live = load_json(LIVE_JSON_URL, fetch_text(f"{LIVE_JSON_URL}?verify={int(time.time())}"))
    live_page = fetch_text(f"{LIVE_PAGE_URL}?verify={int(time.time())}")

    local_digest = digest(local)
    raw_digest = digest(raw)
    live_digest = digest(live)

    checks = [
        (local_digest == raw_digest, "raw GitHub winners.json does not match local winners.json"),
        (raw_digest == live_digest, "public winners.json does not match main branch yet"),
        ("../winners.json" in live_page, "public winners page is not loading ../winners.json"),
    ]

    if expect_count is not None:
        checks.append((len(live) == expect_count, f"public winners count is {len(live)}, expected {expect_count}"))
    if expect_event:
        checks.append((expect_event in event_names(live), f"public winners event is missing: {expect_event}"))

    failed = [message for ok, message in checks if not ok]
    summary = (
        f"local={len(local)} raw={len(raw)} live={len(live)} "
        f"raw_sha={raw_digest[:12]} live_sha={live_digest[:12]}"
    )
    if failed:
        return False, summary + "\n" + "\n".join(f"- {message}" for message in failed)
    return True, summary


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--expect-event", help="event name that must be present in the public data")
    parser.add_argument("--expect-count", type=int, help="winner count that must be present in the public data")
    parser.add_argument("--max-wait", type=int, default=600, help="seconds to wait for GitHub Pages propagation")
    parser.add_argument("--interval", type=int, default=15, help="seconds between verification attempts")
    args = parser.parse_args()

    deadline = time.time() + args.max_wait
    last_message = ""

    while True:
        try:
            ok, message = verify(args.expect_event, args.expect_count)
        except (OSError, URLError, ValueError) as exc:
            ok = False
            message = str(exc)

        last_message = message
        if ok:
            print("OK: winners deployment verified")
            print(message)
            return 0

        if time.time() >= deadline:
            print("ERROR: winners deployment did not verify", file=sys.stderr)
            print(last_message, file=sys.stderr)
            return 1

        print("Waiting for public winners data to match main branch...")
        print(message)
        time.sleep(args.interval)


if __name__ == "__main__":
    raise SystemExit(main())
