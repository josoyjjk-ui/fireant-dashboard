#!/usr/bin/env python3
"""
Codex OAuth 토큰 자동 갱신 스크립트 v2
~/.codex/auth.json 기반
만료 5일 이내 시 갱신 + 텔레그램 알림
"""
import urllib.request, json, time, sys, base64

AUTH_PATH = '/Users/fireant/.openclaw/.codex/auth.json'
# 실제 경로
import os
POSSIBLE = [
    os.path.expanduser('~/.codex/auth.json'),
    '/Users/fireant/.openclaw/agents/main/agent/auth.json',
]
AUTH_PATH = next((p for p in POSSIBLE if os.path.exists(p)), None)

CLIENT_ID = '***REMOVED***'
THRESHOLD_WARN = 5 * 86400   # 5일 — 알림 발송
THRESHOLD_REFRESH = 3 * 86400  # 3일 — 갱신 실행

BOT_TOKEN = "***REMOVED***"
CHAT_ID = "477743685"

def tg(msg):
    try:
        url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
        data = json.dumps({"chat_id": CHAT_ID, "text": msg}).encode()
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=5)
    except Exception as e:
        print(f"TG 알림 실패: {e}")

def get_expiry_from_jwt(token_str):
    try:
        parts = token_str.split('.')
        if len(parts) < 2:
            return None
        pad = parts[1] + '=='
        payload = json.loads(base64.b64decode(pad))
        return payload.get('exp')
    except:
        return None

def refresh_token(refresh_tok):
    payload = json.dumps({
        "grant_type": "refresh_token",
        "refresh_token": refresh_tok,
        "client_id": CLIENT_ID,
    }).encode()
    req = urllib.request.Request(
        "https://auth.openai.com/oauth/token",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())

def main():
    if not AUTH_PATH:
        print("❌ auth.json 파일을 찾을 수 없습니다")
        tg("⚠️ [Codex 토큰 점검 실패]\nauth.json 파일 없음")
        return 1

    with open(AUTH_PATH) as f:
        auth = json.load(f)

    tokens = auth.get('tokens', {})
    access_token = tokens.get('access_token') or tokens.get('id_token')
    refresh_tok = tokens.get('refresh_token')

    if not access_token:
        print("❌ access_token 없음")
        tg("⚠️ [Codex 토큰 점검 실패]\naccess_token 없음")
        return 1

    exp = get_expiry_from_jwt(access_token)
    if not exp:
        print("⚠️ 만료 시각 파악 불가")
        return 0

    remaining = exp - time.time()
    days = remaining / 86400
    exp_str = time.strftime('%Y-%m-%d %H:%M KST', time.localtime(exp))

    print(f"만료: {exp_str} (남은 시간: {days:.1f}일)")

    if remaining > THRESHOLD_WARN:
        print(f"✅ 갱신 불필요 ({days:.1f}일 남음)")
        return 0

    # 5일 이내 — 알림
    if remaining <= THRESHOLD_WARN and remaining > THRESHOLD_REFRESH:
        tg(f"⚠️ [Codex 토큰 만료 임박]\n만료까지 {days:.1f}일 남았습니다.\n만료일: {exp_str}")
        print(f"⚠️ 알림 발송 완료 ({days:.1f}일 남음)")
        return 0

    # 3일 이내 — 갱신 실행
    if not refresh_tok:
        tg(f"❌ [Codex 토큰 갱신 실패]\nrefresh_token 없음. 수동 재인증 필요.\n만료일: {exp_str}")
        print("❌ refresh_token 없음")
        return 1

    print(f"🔄 갱신 실행 중... ({days:.1f}일 남음)")
    try:
        res = refresh_token(refresh_tok)
        new_access = res['access_token']
        new_refresh = res.get('refresh_token', refresh_tok)
        new_id_token = res.get('id_token', tokens.get('id_token', ''))

        auth['tokens']['access_token'] = new_access
        auth['tokens']['refresh_token'] = new_refresh
        if new_id_token:
            auth['tokens']['id_token'] = new_id_token

        from datetime import datetime, timezone
        auth['last_refresh'] = datetime.now(timezone.utc).isoformat()

        with open(AUTH_PATH, 'w') as f:
            json.dump(auth, f, indent=2)

        new_exp = get_expiry_from_jwt(new_access)
        new_exp_str = time.strftime('%Y-%m-%d %H:%M KST', time.localtime(new_exp)) if new_exp else '알 수 없음'
        tg(f"✅ [Codex 토큰 갱신 완료]\n새 만료일: {new_exp_str}")
        print(f"✅ 갱신 완료 — 새 만료: {new_exp_str}")
        return 0
    except Exception as e:
        tg(f"❌ [Codex 토큰 갱신 실패]\n{str(e)}\n수동 재인증 필요")
        print(f"❌ 갱신 실패: {e}")
        return 1

if __name__ == '__main__':
    sys.exit(main())
