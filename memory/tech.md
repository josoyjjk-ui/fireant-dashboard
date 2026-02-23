# 기술 교훈 및 도구 설정
# 검색 키워드: 기술 교훈, 버그, reasoning 누출, API 키, Fireflies,
# 크리덴셜, OpenClaw 설정, 텔레그램 웹뷰, X 수집 제한, 브라우저,
# contextPruning, 서브에이전트, 에러, 장애, 설정, config

## 운영 원칙
- 모든 날짜/요일/시간은 한국시간(KST) 기준으로 표기

## 알려진 이슈
- reasoning/thinking 출력이 텔레그램 메시지로 노출되는 버그 발생 이력 있음 (2026-02-24). /reasoning off로 해결.
- 텔레그램 공개 웹뷰(t.me/s)는 일부 과거 글만 부분 수집 가능(파라미터 before 활용)
- X는 비로그인/보안정책으로 자동 수집 제한될 수 있음

## 컨텍스트 최적화 (2026-02-24 적용)
- Plan B: contextPruning cache-ttl 60분, keepLastAssistants 6, minPrunableToolChars 2000
- Plan C: 도구 호출 3회+ 예상 시 서브에이전트 위임
- Plan A: MEMORY.md 분리 완료 (style/projects/people/tech)
