# claw-node.com Google Ads 전환 추적 설정 가이드

## 현재 상태 (2026-03-18 확인)

✅ GA4 (G-LCYQQE3T5B) — 사이트에 이미 적용됨  
✅ reserve_submit 이벤트 — 예약 폼 제출 시 자동 발동  
✅ kakao_chat_click 이벤트 — 카카오 채팅 버튼 클릭 시 자동 발동  
❌ Google Ads (AW-17999714736) — 아직 연결 안됨  
❌ GA4 ↔ Google Ads 링크 — 생성 필요  

## 방법 A: GA4 UI에서 직접 연결 (권장, 30분 내 완료)

### Step 1: GA4에서 Google Ads 연결

1. https://analytics.google.com 접속 (josoyjjk@gmail.com으로 로그인)
2. 속성 선택: G-LCYQQE3T5B (ClawNode 속성)
3. 좌측 하단 **관리(톱니바퀴)** → **속성 설정**
4. **Google Ads 연결** 클릭
5. **연결 만들기** → Google Ads 계정 `676-009-5668` 선택
6. 연결 확인

### Step 2: Google Ads에서 GA4 전환 import

1. https://ads.google.com 접속
2. **도구** (렌치 아이콘) → **측정** → **전환**
3. **+ 새 전환 액션** 클릭
4. **Google Analytics 4 속성** 선택
5. GA4 속성 목록에서 claw-node.com 속성 선택
6. 다음 이벤트 import:
   - `reserve_submit` → 이름: "예약 신청" / 값: 설정 가능 / 카테고리: 구매
   - `kakao_chat_click` → 이름: "카카오 채팅 클릭" / 카테고리: 문의

### Step 3: 확인 (48시간 후)

- Google Ads 전환 열에서 데이터 수신 확인
- GA4 → 실시간 → 이벤트에서 테스트 이벤트 확인 가능

---

## 방법 B: Google Ads 전환 태그 직접 삽입 (코드 접근 필요)

claw-node.com 소스코드 위치를 확인해야 함 (로컬에서 찾지 못함).  
Vercel 대시보드에서 배포된 프로젝트를 확인하세요:  
→ https://vercel.com/dashboard

사이트 소스에 다음 추가 필요:
```javascript
// layout.tsx 또는 _app.tsx에 추가
gtag('config', 'AW-17999714736');

// 전환 이벤트 (이미 구현된 코드에 추가)
// reserve_submit:
gtag('event', 'conversion', {
  'send_to': 'AW-17999714736/[전환_라벨]',
  'value': 1.0,
  'currency': 'KRW'
});

// kakao_chat_click:
gtag('event', 'conversion', {
  'send_to': 'AW-17999714736/[전환_라벨]',
});
```

---

## API 자동화 스크립트 (선택사항)

GA4 Admin API 인증 후 자동 링크 생성:

```bash
cd /Users/fireant/.openclaw/workspace
python3 secrets/ga4_auth.py  # 브라우저 인증 (analytics.edit scope)
python3 ga4_ads_link.py       # GA4-Google Ads 링크 생성
```

