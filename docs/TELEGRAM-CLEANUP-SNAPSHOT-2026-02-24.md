# Telegram Cleanup Snapshot — 2026-02-24 (KST)

## 보호 규칙
- ETF 포스트: 이미지+캡션 한 메시지 고정
- failover/failback 모델 전환 즉시 보고
- HEARTBEAT 판정: cron run 증빙 기반

## 자동화 상태
- daily-telegram-archive-50-to-notion: enabled
- daily-x-archive-10-to-notion: enabled

## 오늘 완료 증빙
- job: daily-telegram-archive-50-to-notion
- status: finished=ok, delivered=true
- summary: 중복 제외 50건 적재 완료 (포스트ID 39845~39816)

## 비고
- 채팅 정리는 Low Risk부터 롤링 삭제
- 운영 규칙/자동화 지시는 삭제 전 반드시 보존
