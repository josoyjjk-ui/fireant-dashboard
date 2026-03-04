#!/usr/bin/env python3
"""
Codex OAuth 토큰 자동 갱신 스크립트
만료 2일 이내일 때만 refresh 실행
"""
import urllib.request, json, time, sys

AUTH_PATH = '/Users/fireant/.openclaw/agents/main/agent/auth.json'
PROF_PATH = '/Users/fireant/.openclaw/agents/main/agent/auth-profiles.json'
CLIENT_ID = '***REMOVED***'
THRESHOLD = 2 * 86400  # 2일 (초)

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
    with open(AUTH_PATH) as f:
        auth = json.load(f)

    expires_ms = auth['openai-codex']['expires']
    expires_sec = expires_ms / 1000
    remaining = expires_sec - time.time()

    print(f'만료까지: {remaining/3600:.1f}시간')

    if remaining > THRESHOLD:
        print(f'✅ 갱신 불필요 (만료까지 {remaining/86400:.1f}일 남음)')
        return 0

    print(f'⚠️ 만료 {remaining/3600:.1f}시간 전 — refresh 실행')
    old_refresh = auth['openai-codex']['refresh']
    res = refresh_token(old_refresh)

    new_access  = res['access_token']
    new_refresh = res['refresh_token']
    new_expires = int((time.time() + res['expires_in']) * 1000)

    # auth.json 업데이트
    auth['openai-codex']['access']  = new_access
    auth['openai-codex']['refresh'] = new_refresh
    auth['openai-codex']['expires'] = new_expires
    with open(AUTH_PATH, 'w') as f:
        json.dump(auth, f, indent=2)

    # auth-profiles.json 업데이트
    with open(PROF_PATH) as f:
        prof = json.load(f)
    prof['profiles']['openai-codex:default']['access']  = new_access
    prof['profiles']['openai-codex:default']['refresh'] = new_refresh
    prof['profiles']['openai-codex:default']['expires'] = new_expires
    with open(PROF_PATH, 'w') as f:
        json.dump(prof, f, indent=2)

    new_exp_str = time.strftime('%Y-%m-%d %H:%M KST', time.localtime(new_expires/1000))
    print(f'✅ refresh 완료 — 새 만료: {new_exp_str}')
    return 0

if __name__ == '__main__':
    sys.exit(main())
