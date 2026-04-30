# SESSION-STATE

## CB_PREMIUM 입력 대기 규칙
- 매일 14:00 크론이 해병님께 프리미엄 지수 입력 요청 메시지 전송
- 해병님이 프리미엄 수치(예: "+0.04%")를 답장하면 → 즉시 아래 실행:
  1. `/Users/fireant/.openclaw/workspace/cb_premium_input.json` 에 {date: 오늘, status: "received", value: "수치"} 저장
  2. 확인 응답: "✅ 코인베이스 프리미엄 +0.04% 저장 완료. 15:00 리포트에 반영됩니다."
- 미입력 시 15:00 크론이 `cb_premium_history.json`에서 전일 값 자동 사용

## ACTIVE

### [완료] MegaETH / 메가이더 친구초대 이벤트 세팅
- 이 항목은 사용자가 명시적으로 다른 임무를 지정하거나 완료 판정이 날 때까지 현재 활성 임무다.
- 사용자가 "진행해라", "계속", "다음 단계", "검수해라", "?"처럼 짧게 답하면 이 임무의 다음 미완료 단계로 해석한다.
- 이벤트명: 메가이더 한국 커뮤니티 친구초대 이벤트 - feat. 불개미
- 봇: @mate_ref_bot
- 초대자: @fireantico
- 기간: 2026-04-29 ~ 2026-05-03 23:59 KST
- 보상: 1500명 이하 150만원, 1500명 초과 300만원 리워드 풀; 포인트 획득 구간별 리워드 배정은 종료 후 안내
- 참여 조건: MegaETH 공지방, MegaETH 대화방, 불개미 채널, 불개미 대화방 입장 후 @mate_ref_bot에서 초대자 등록 및 친구초대
- 데이터 분리 원칙: KGeN 데이터와 섞지 않는다. 리더보드는 event_points.event_id 기준만 사용한다. users 테이블은 누적 사용자 보존용으로만 취급한다.

#### 확인된 상태 (2026-04-30 KST 기준)
- referral DB: /Users/fireant/.openclaw/workspace/bots/referral-bot/referral.db
- events: id=1 MegaETH old is_active=0, id=2 KGeN is_active=0, id=3 MegaETH new is_active=1, sheet_tab=MegaETH_0429
- event_period: 2026-04-29 ~ 2026-05-03
- 기존 KGeN event_points 약 1171건은 보존 대상이며 삭제/초기화 금지
- users 누적 데이터 약 1182명은 보존 대상이며 삭제/초기화 금지
- channels 테이블은 비어 있음. 4개 필수 채널 chat_id 등록이 별도 blocker일 수 있다.
- Google Sheets는 events.sheet_tab 기준 탭 분리. MegaETH_0429 탭을 써야 하며 KGeN 탭과 섞으면 안 된다.
- bot.py /start 메시지에 KGeN 하드코딩이 잔존한다는 점검 결과가 있었으므로, 이벤트 시작 전 MegaETH 문구로 패치/검증해야 한다.

#### 다음 실행 원칙
1. 재계획 반복 금지. 이미 확인된 사실을 다시 묻지 말고 실행 가능한 다음 단계로 넘어간다.
2. bot.py /start 및 기본 이벤트 텍스트를 MegaETH 정보로 교체하고 inspector 검수한다.
3. DB, Google Sheets 탭, 리더보드 export/update, fireantcrypto.com 반영, 봇 재시작 상태를 각각 실제 파일/명령/log로 검증한다.
4. 채널 ID나 MegaETH 공식 링크가 실제로 없으면 가능한 작업을 먼저 끝낸 뒤 blocker로만 보고한다.
5. 완료 보고는 친구초대봇, fireantcrypto.com 리더보드, DB, Google Sheets가 각각 PASS/FAIL인지 나눠서 한다.

### [대기] 해병님 직접 처리 필요
- @mate_ref_bot 로고: BotFather에서 수동 적용 필요 시 별도 지시 대기

## NEXT
1. MegaETH 친구초대 이벤트 봇 시작 가능 상태까지 마무리: bot.py 텍스트 패치 → DB/시트/리더보드 검증 → 봇 재시작 → PASS/FAIL 보고
2. 미해결 채널 chat_id/링크가 있으면 정확한 blocker로만 남기고, 나머지 독립 단계는 선완료

## 에이전트 체제
- 딸수(메인): 오케스트레이터 + 직접 대화
- 참모(chammo, claude-sonnet-4-6): 리서치/콘텐츠
- 공병(ops, gpt-5.3-codex): 인프라/자동화

## 오늘 완료 요약 (2026-03-25)
- kr-exchange 페이지 신설 — 가나다순 5개 거래소, 이벤트 7개, 카운트다운 타이머, 테마
- 전체 7개 페이지 nav max-width 720px 통일 (nav-inner)
- indicators nav padding 5px 8px 수정
