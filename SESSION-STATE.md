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
- 현재 제출자: 52명 (DB + 시트 동기화 완료)

### [대기] 로고 시안 확정
- v7 시안 해병님 OK → BotFather에서 @mate_ref_bot 프로필 직접 적용 필요
- 파일: `2026-03-21-referral-bot-logo-v7.png`

### [대기] Gmail 정리
- 재인증 필요 (`gmail.modify` 스코프 누락) — 수동 정리 or 재인증 선택 대기

## DONE (오늘)
- Billions DB ↔ 구글시트 대조 완료 (1건 누락 추가) — 1,285건 일치
- 불개미 게시판 이벤트 페이지: Eigen Cloud 카드 추가, 종료된 이벤트 섹션 분리 (접힘/펼침, 숫자표시)
- 과거 이벤트 6개 종료 섹션 추가 (BlockStreet/한경TV/Virtuals/SaharaAI/Everything/Billions)
- 당첨자 조회 페이지: 시트1+시트2 통합, 이벤트명 수정
- 전체 폰트 Geist + Noto Sans KR로 교체
- 종료된 이벤트 쿠포니봇 아래로 이동

## 에이전트 체제
- 딸수(메인): 오케스트레이터 + 직접 대화
- 참모(chammo): 리서치/콘텐츠
- 공병(ops): 인프라/자동화
