#!/usr/bin/env python3
"""Google Forms API로 Block Street AMA 사전질문 폼 생성"""

import json
import subprocess
import sys

# Google Forms API는 OAuth2가 필요하므로, 
# API Key(Gemini)로는 접근 불가. 
# 대신 Apps Script Execution API를 사용하거나,
# 서비스 계정이 필요함.

# 가장 빠른 방법: Google Forms API + API key는 안 됨
# OAuth 없이 가능한 방법: Google Apps Script Web App

# Apps Script를 배포하고 웹앱으로 호출하는 게 가장 현실적
# 하지만 그것도 초기 설정이 필요...

# 결론: Selenium/Playwright로 직접 폼 생성이 제일 빠름

try:
    from playwright.sync_api import sync_playwright
    HAS_PLAYWRIGHT = True
except ImportError:
    HAS_PLAYWRIGHT = False

if not HAS_PLAYWRIGHT:
    print("playwright 설치 중...")
    subprocess.run([sys.executable, "-m", "pip", "install", "playwright"], check=True)
    subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"], check=True)
    from playwright.sync_api import sync_playwright

print("Google Forms 생성 시작...")
