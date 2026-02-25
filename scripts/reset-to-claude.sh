#!/bin/bash
# 매일 오전 9시 KST: cooldown 초기화 + 기본 모델 클로드로 리셋
AUTH_FILE="$HOME/.openclaw/agents/main/agent/auth-profiles.json"

python3 -c "
import json, time
with open('$AUTH_FILE') as f:
    data = json.load(f)

# Clear all cooldowns and error counts
for profile_id in data.get('usageStats', {}):
    stats = data['usageStats'][profile_id]
    stats.pop('cooldownUntil', None)
    stats.pop('disabledUntil', None)
    stats.pop('disabledReason', None)
    stats['errorCount'] = 0
    stats.pop('failureCounts', None)

with open('$AUTH_FILE', 'w') as f:
    json.dump(data, f, indent=4)

print('Cooldowns cleared at', time.strftime('%Y-%m-%d %H:%M:%S'))
"
