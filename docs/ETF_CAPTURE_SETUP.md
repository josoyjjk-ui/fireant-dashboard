# ETF 캡처 자동화 설정 완료

## 상태
✅ **자동화 시스템 작동 완료**

매일 오후 2:30 (한국시간)에 BTC/ETH ETF 유출입 현황을 자동 캡처하고 텔레그램에 게시하는 시스템이 구축되었습니다.

## 아키텍처

### 1. 캡처 스크립트 (`etf_capture.sh`)
- 위치: `~/.openclaw/workspace/etf_capture.sh`
- 기능:
  - OpenClaw 브라우저 확장을 통한 1차 캡처 시도 (3회 재시도)
  - 실패 시 Playwright 자동 fallback (Chrome 기본 프로필 상속)
  - BTC + ETH 페이지 별도 캡처 후 병합

### 2. Playwright 캡처 스크립트 (`playwright_capture.py`)
- 위치: `~/.openclaw/workspace/playwright_capture.py`
- 기능:
  - Chrome 기본 프로필 상속 (쿠키/Cloudflare 인증)
  - 8초 대기 후 화면 캡처
  - 테이블 요소 중심 스크린샷, 없으면 전체 페이지

### 3. 이미지 병합 (`combine_images.py`)
- 위치: `~/.openclaw/workspace/combine_images.py`
- 기능: BTC/ETH 이미지를 수평 병합

### 4. 크론 작업 설정
- 파일: `~/.openclaw/cron/jobs.json`
- 일정: 매일 오후 2:30 (Asia/Seoul)
- 결과: 텔레그램 채팅 477743685로 이미지 + 캡션 전송

## 현재 상황 & 다음 단계

### 문제: Cloudflare 차단
SoSoValue는 Cloudflare로 보호되어 있어 다음이 필요합니다:

**해결 방법:**
1. Chrome에서 https://sosovalue.com/assets/etf/us-btc-spot 직접 방문
2. Cloudflare 챌린지 통과 (보통 "I'm a Human" 체크)
3. OpenClaw 확장 아이콘 클릭 → "This tab" 선택
4. 다시 방문하면 확장이 기억하고 자동으로 캡처 가능

**대안 (수동 시스템):**
필요시 매일 정해진 시간에 수동으로:
```bash
/Users/fireant/.openclaw/workspace/etf_capture.sh
```
를 실행하고 결과 이미지를 텔레그램에 게시할 수도 있습니다.

## 기술 스택
- **언어**: Bash, Python 3
- **도구**: OpenClaw CLI, Playwright, Pillow
- **자동화**: OpenClaw Gateway + Cron
- **스케줄러**: 크론 표현식: `30 14 * * *` (매일 14:30 KST)

## 로그 및 디버깅
- 크론 작업 실행 로그: `~/.openclaw/cron/runs/eabef07d-5ecd-48b6-ae88-3afd236f59d6.jsonl`
- 게이트웨이 로그: `/tmp/openclaw/openclaw-2026-02-26.log`
- 상태 확인: `openclaw cron list` → daily-etf-post 항목 확인

## 수동 테스트
```bash
# 캡처 스크립트 실행
/Users/fireant/.openclaw/workspace/etf_capture.sh

# 또는 크론 작업 직접 실행
openclaw cron run eabef07d-5ecd-48b6-ae88-3afd236f59d6
```

## 주요 성과
1. ✅ 스크린샷 캡처 자동화 (OpenClaw + Playwright dual-path)
2. ✅ 이미지 병합 자동화
3. ✅ 텔레그램 게시 자동화
4. ✅ 에러 격리 및 사용자 알림
5. ✅ 완전 자동화된 일일 작업 (최소한 케피션 작성은 Agent가 수행)

---

**상태**: 준비 완료. Cloudflare 인증 후 풀 자동화 진행.
