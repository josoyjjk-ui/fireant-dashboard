# SESSION-STATE.md — 현재 작업

## Problem-Solving State
- **Goal**: `No tool call found for function call output ...` 오류의 근본 원인 파악 및 재발 방지책 수립
- **Blocker Class**: technical
- **Path Map** (최소 5개):
  1. openclaw 상태/런타임 확인
  2. 게이트웨이/세션 로그에서 call_id 연관 에러 추적
  3. 최근 메시지/툴 호출 이력에서 출력만 도착한 케이스 확인
  4. 모델 전환/세션 리셋 시점과 오류 시점 상관관계 확인
  5. 재발 방지용 운영 규칙(툴호출 형식/재시작/모니터링) 정리
- **Active Paths** (최대 2개 병렬):
  - [ ] 상태+로그 진단
  - [ ] 세션 이력 기반 재현 조건 추정
- **Switch Trigger**: 같은 장벽 3회 → 경로 전환
- **Next Fallback** (2개):
  - gateway 재시작 후 동일 시나리오 재검증
  - 최소 재현 프롬프트로 분리 테스트

- 사용자 신규 선호: failover로 모델 전환 발생 시 즉시 사용자에게 보고
- 사용자 신규 선호: 이미지/자동화 작업은 연결된 API 경로를 최우선으로 사용하고, API 실패 시에만 브라우저 경로로 fallback
- HEARTBEAT 판정 고정: cron list + 해당 job runs 확인 후, run finished=ok && delivered=true면 HEARTBEAT_OK 처리. 완료 증빙 없이 미완료 경고 금지.
- 신규 진행: 텔레그램 대화 정리 정책(저/중/고위험 분류) 실행 — 1단계 보존 스냅샷/체크리스트 생성 후 2단계 기간별 삭제 롤링 적용
