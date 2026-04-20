# fireant-dashboard 탐색 결과

## 1. 클론 성공
- 위치: `/tmp/fireant-dashboard`
- 최신 커밋: `9179e009 feat: Blockstreet yap event 4/20-4/27`

## 2. JSON 파일 목록 (find . -name "*.json")
1. `./memory-system/package-lock.json`
2. `./memory-system/package.json`
3. `./events.json` ← **events.json 위치**
4. `./leaderboard/past-events/billions-leaderboard.json`
5. `./cb_premium_history.json`
6. `./leaderboard.json`
7. `./.openclaw/workspace-state.json`
8. `./package-lock.json`
9. `./package.json`
10. `./cb_premium_input.json`
11. `./.vscode/tasks.json`
12. `./winners.json`
13. `./feed.json`

## 3. events.json 내용
- 리포 루트에 위치
- 1개의 live 이벤트 포함: Blockstreet 야핑 (2026-04-20~27, 총 100만원 상당)

## 4. ls -la 주요 항목
- 디렉토리: agents/, bots/, scripts/, events/, leaderboard/, memory-system/, ops/, skills/, proposals/, feed/, winners/, kr-exchange/, indicators/, assets/ 등
- HTML: index.html, events.html, indicators.html, 다수 배너 HTML
- Python: backtest_*.py, giyulbot.py, fireantagent_bot.py 등
- JSON: events.json, leaderboard.json, feed.json, winners.json 등
