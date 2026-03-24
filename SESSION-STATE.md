# SESSION-STATE

## CB_PREMIUM 입력 대기 규칙
- 매일 14:00 크론이 해병님께 프리미엄 지수 입력 요청 메시지 전송
- 해병님이 프리미엄 수치(예: "+0.04%")를 답장하면 → 즉시 아래 실행:
  1. `/Users/fireant/.openclaw/workspace/cb_premium_input.json` 에 {date: 오늘, status: "received", value: "수치"} 저장
  2. 확인 응답: "✅ 코인베이스 프리미엄 +0.04% 저장 완료. 15:00 리포트에 반영됩니다."
- 미입력 시 15:00 크론이 `cb_premium_history.json`에서 전일 값 자동 사용

## ACTIVE

### [진행중] Eigen Cloud 친구초대 이벤트
- 기간: 2026-03-21 ~ 2026-04-03
- 구글시트: `1prtoKycManbOj-HoMnzZ68kl6VEEm3h5vvvTUzK6QHs`
- 봇: @mate_ref_bot / 리더보드: https://fireantcrypto.com/leaderboard/

### [대기] 해병님 직접 처리 필요
- @mate_ref_bot 로고: BotFather에서 v7 이미지 적용 (`2026-03-21-referral-bot-logo-v7.png`)
- ETHGAS 구글폼: 6번 항목 → 파일 업로드 타입으로 변경 (편집 링크에서 수동)

## NEXT (내일 우선순위)
1. 불개미 마켓 지표 배포 — indicators/index.html 실제 데이터 연동
2. Starchild WOOFi Pro 연결 여부 — Ben Yorke 직접 문의
3. kr-exchange 이벤트 업데이트 — 업비트 Tron Week 3/26 종료 후 제거
4. Privy/Ethena 포스트 발행 여부 확인

## 에이전트 체제
- 딸수(메인): 오케스트레이터 + 직접 대화
- 참모(chammo, claude-sonnet-4-6): 리서치/콘텐츠
- 공병(ops, gpt-5.3-codex): 인프라/자동화

## 오늘 완료 요약 (2026-03-25)
- kr-exchange 페이지 신설 — 가나다순 5개 거래소, 이벤트 7개, 카운트다운 타이머, 테마
- 전체 7개 페이지 nav max-width 720px 통일 (nav-inner)
- indicators nav padding 5px 8px 수정
