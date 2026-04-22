#!/usr/bin/env python3
"""Capture an element screenshot using Playwright.

Usage: playwright_capture.py URL OUTPUT
"""
import sys
from pathlib import Path
import os


def capture(url: str, out: str) -> None:
    # attempt to reuse the user's Chrome profile so any Cloudflare challenge
    # cookies are already present. this mirrors how the OpenClaw extension
    # works in the regular browser.
    from playwright.sync_api import sync_playwright

    user_data = os.path.expanduser(
        "~/Library/Application Support/Google/Chrome/Default"
    )
    chrome_exe = (
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    )

    with sync_playwright() as p:
        # persistent context will load the existing data directory. headless
        # may still work but we explicitly set it to True so cron jobs can run
        # without a display.
        context = p.chromium.launch_persistent_context(
            user_data_dir=user_data,
            executable_path=chrome_exe,
            headless=True,
        )
        page = context.new_page()
        page.goto(url)
        page.wait_for_timeout(8000)  # wait for dynamic data to render
        element = page.query_selector("table")
        if element is None:
            # Maybe the site uses a canvas instead of table; capture full page
            # as a fallback.
            page.screenshot(path=out, full_page=True)
            context.close()
            return
        element.screenshot(path=out)
        context.close()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: playwright_capture.py URL OUTPUT", file=sys.stderr)
        sys.exit(1)
    capture(sys.argv[1], sys.argv[2])
