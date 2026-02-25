#!/usr/bin/env python3
"""Add phone, twitter, youtube fields to Google Form via Forms API"""
import json
import subprocess
import sys

FORM_ID = "1ogjAxMoOg69zcJdnRjKIR0Ad7AdR2z5FdXlnOpso130"

# Get access token from gcloud
try:
    token = subprocess.check_output(["gcloud", "auth", "print-access-token"], text=True).strip()
except:
    print("ERROR: gcloud not configured")
    sys.exit(1)

import urllib.request

headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}

# First, get current form to see existing questions
req = urllib.request.Request(
    f"https://forms.googleapis.com/v1/forms/{FORM_ID}",
    headers=headers
)
try:
    resp = urllib.request.urlopen(req)
    form = json.loads(resp.read())
    items = form.get("items", [])
    print(f"Current questions: {len(items)}")
    for i, item in enumerate(items):
        print(f"  {i}: {item.get('title', 'N/A')}")
except Exception as e:
    print(f"GET failed: {e}")
    sys.exit(1)

# Add 3 new questions: phone, twitter, youtube
new_questions = [
    {"title": "휴대전화번호", "required": True},
    {"title": "트위터(X) 아이디", "required": True},
    {"title": "유튜브 닉네임", "required": True},
]

requests_list = []
for idx, q in enumerate(new_questions):
    requests_list.append({
        "createItem": {
            "item": {
                "title": q["title"],
                "questionItem": {
                    "question": {
                        "required": q["required"],
                        "textQuestion": {
                            "paragraph": False
                        }
                    }
                }
            },
            "location": {"index": len(items) + idx}
        }
    })

body = json.dumps({"requests": requests_list}).encode()
req = urllib.request.Request(
    f"https://forms.googleapis.com/v1/forms/{FORM_ID}:batchUpdate",
    data=body,
    headers=headers,
    method="POST"
)
try:
    resp = urllib.request.urlopen(req)
    result = json.loads(resp.read())
    print("SUCCESS - added 3 new fields")
    print(json.dumps(result, indent=2, ensure_ascii=False)[:500])
except Exception as e:
    print(f"UPDATE failed: {e}")
    if hasattr(e, 'read'):
        print(e.read().decode())
    sys.exit(1)
