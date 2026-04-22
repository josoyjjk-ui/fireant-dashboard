#!/bin/bash
set -euo pipefail

# Simple script to capture ETF tables from SoSoValue and merge them.
# Requires openclaw CLI and Python (with Pillow) available.  For reliability
# we will also attempt a Playwright-based capture in a local virtualenv.

# ensure we run from the script's directory (workspace)
WD="$(cd "$(dirname "$0")" && pwd)"
cd "$WD" || exit 1

# location of our python virtualenv where playwright & pillow are installed.
VENV="$HOME/.openclaw/workspace/venv"
PYTHON="$VENV/bin/python"

capture() {
    url="$1"
    out="$2"
    echo "Capturing $url -> $out"
    openclaw browser start || true
    openclaw browser open "$url"
    sleep 5

    # try openclaw first with three attempts
    for i in 1 2 3; do
        if openclaw browser screenshot --element 'table' --type png "$out"; then
            echo "Saved $out via openclaw"
            return 0
        else
            echo "screenshot attempt $i failed for $url"
            openclaw browser navigate "$url"
            sleep 5
        fi
    done

    echo "openclaw failed to capture after retries, trying Playwright fallback" >&2
    if "$PYTHON" "$WD/playwright_capture.py" "$url" "$out"; then
        echo "Saved $out via Playwright"
        return 0
    else
        echo "Playwright fallback also failed for $url" >&2
    fi

    echo "WARNING: failed to capture $url after both methods" >&2
    return 1
}

# capture BTC and ETH pages (ignore failures)
capture "https://sosovalue.com/assets/etf/us-btc-spot" btc.png || true
capture "https://sosovalue.com/assets/etf/us-eth-spot" eth.png || true

# merge images if both exist, otherwise just copy whichever exists
if [[ -f btc.png && -f eth.png ]]; then
    python3 combine_images.py btc.png eth.png merged.png || {
        echo "image merge failed" >&2
    }
elif [[ -f btc.png ]]; then
    cp btc.png merged.png
elif [[ -f eth.png ]]; then
    cp eth.png merged.png
else
    echo "no images captured" >&2
fi

echo "Done. merged.png ready if creation succeeded."