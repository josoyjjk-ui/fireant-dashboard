#!/bin/bash
cd /Users/fireant/.openclaw/workspace
export VIRTUAL_ENV=/Users/fireant/.openclaw/workspace/venv
export PATH="$VIRTUAL_ENV/bin:$PATH"
exec python3 /Users/fireant/.openclaw/workspace/giyulbot.py
