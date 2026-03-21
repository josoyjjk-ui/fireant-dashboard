#!/usr/bin/env python3
"""Google Sheets → winners.json 동기화"""
import json
from pathlib import Path
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build as gbuild

TOKEN = '/Users/fireant/.openclaw/workspace/secrets/google-token.json'
SHEET1 = '17YubNG1RbcLNBN6wxrh2CcWClSFltRNkEYHyL82xo9E'
SHEET2 = '12GOhLde_pI1gGRQJXWOMzt-yTkxXVo-GrVaYM6B8gqA'
OUT = Path('/Users/fireant/.openclaw/workspace/fireant-dashboard/winners.json')

creds = Credentials.from_authorized_user_file(TOKEN)
service = gbuild('sheets', 'v4', credentials=creds)

winners = []

# 시트1: B열 텔레그램
r1 = service.spreadsheets().values().get(spreadsheetId=SHEET1, range='A:H').execute()
for row in r1.get('values', [])[1:]:
    tg = row[1].strip() if len(row) > 1 else ''
    if tg and tg.startswith('@'):
        winners.append({"event": "블록스트릿 AMA 리캡 캠페인", "telegram": tg.lower(), "prize": "이벤트 당첨"})

# 시트2: C열 텔레그램, F열 이벤트명, I열 상품
r2 = service.spreadsheets().values().get(spreadsheetId=SHEET2, range='A:I').execute()
for row in r2.get('values', [])[1:]:
    tg = row[2].strip() if len(row) > 2 else ''
    event = row[5].strip() if len(row) > 5 else '불개미 이벤트'
    prize = row[8].strip() if len(row) > 8 else ''
    if tg and tg.startswith('@'):
        winners.append({"event": event, "telegram": tg.lower(), "prize": prize})

OUT.write_text(json.dumps(winners, ensure_ascii=False, indent=2))
print(f"✅ winners.json 업데이트: {len(winners)}건")
