# SESSION-STATE

## CB_PREMIUM 입력 대기 규칙
- 매일 14:00 크론이 해병님께 프리미엄 지수 입력 요청 메시지 전송
- 해병님이 프리미엄 수치(예: "+0.04%")를 답장하면 → 즉시 아래 실행:
  1. `/Users/fireant/.openclaw/workspace/cb_premium_input.json` 에 {date: 오늘, status: "received", value: "수치"} 저장
  2. 확인 응답: "✅ 코인베이스 프리미엄 +0.04% 저장 완료. 15:00 리포트에 반영됩니다."
- 미입력 시 15:00 크론이 `cb_premium_history.json`에서 전일 값 자동 사용

## ACTIVE

### 서브에이전트 아키텍처 구현 대기
- 메인(딸수) + 참모(GPT-5.4, 상시) + 공병(Sonnet, 호출형)
- 해병님 최종 "진행" 대기 중


