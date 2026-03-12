# 기술 교훈 및 도구 설정
# 검색 키워드: 기술 교훈, 버그, reasoning 누출, API 키, Fireflies,
# 크리덴셜, OpenClaw 설정, 텔레그램 웹뷰, X 수집 제한, 브라우저,
# contextPruning, 서브에이전트, 에러, 장애, 설정, config

## 운영 원칙
- 모든 날짜/요일/시간은 한국시간(KST) 기준으로 표기

## 알려진 이슈
- reasoning/thinking 출력이 텔레그램 메시지로 노출되는 버그 (2026-02-24~25):
  - 원인: openclaw.json에 무효 키(`streaming`, `ownerDisplay`) 사용 → 설정 미적용
  - 해결: (1) 무효 키 제거 (2) 올바른 키 `streamMode: "off"` 적용 (3) AGENTS.md에 `/reasoning off` 매 세션 실행 추가
  - 참고: `reasoning: false`는 config-level 키가 아님 (agents.defaults에도 models에도 Unrecognized). 세션 명령 `/reasoning off`만 유효.
  - 올바른 텔레그램 설정 키: `botToken`, `dmPolicy`, `allowFrom`, `groupPolicy`, `streamMode` (NOT `streaming`)
  - 관련 이슈: GitHub openclaw/openclaw #24626, #24376
- openclaw.json 무효 키 문제 (2026-02-25 수정):
  - `commands.ownerDisplay`, `channels.telegram.streaming`, `gateway.errorHandling`, `gateway.logging` 모두 Unrecognized
  - config reload가 계속 실패하여 설정 변경이 적용되지 않음 → 답변 끊김/failover 실패의 근본 원인
  - 해결: 무효 키 전부 제거
- 텔레그램 공개 웹뷰(t.me/s)는 일부 과거 글만 부분 수집 가능(파라미터 before 활용)
- X는 비로그인/보안정책으로 자동 수집 제한될 수 있음

## 컨텍스트 최적화 (2026-02-24 적용)
- Plan B: contextPruning cache-ttl 60분, keepLastAssistants 6, minPrunableToolChars 2000
- Plan C: 도구 호출 3회+ 예상 시 서브에이전트 위임
- Plan A: MEMORY.md 분리 완료 (style/projects/people/tech)

## 내부 tool 오류 알림 텔레그램 노출 (2026-03-13)
- 증상: Edit 도구 실패 시 "⚠️ 📝 Edit: ... failed" 메시지가 텔레그램으로 전송됨
- 원인: OpenClaw platform이 tool 오류를 채널에 push하는 것으로 보임 (platform 버그)
- 상태: 미해결 (OpenClaw upstream 이슈)
- 대응: 중요 편집은 python 스크립트로 처리해 Edit 도구 실패 최소화
