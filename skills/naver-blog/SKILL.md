# naver-blog 스킬

## 개요
네이버 블로그(`fireant_korea`) 포스트 발행/수정/삭제를 자동화한다.
**이 작업은 반드시 참모(chammo)에 위임한다. 딸수가 직접 실행하면 규칙 위반.**

## 위임 방법
```
sessions_spawn(agentId: "chammo", task: "[chammo-prompt.md 내용] + 작업 지시")
```

## 참모 프롬프트 경로
`/Users/fireant/.openclaw/workspace/agents/chammo-prompt.md`

---

## 블로그 정보
- blogId: `fireant_korea`
- 에디터: 네이버 스마트에디터 ONE
- 에디터 접근: `window.SmartEditor._editors['blogpc001']`
- 로그인 계정: `fireant_korea` / PW: `wnFhT9`

---

## 확정된 발행 양식 (일일시황)

### 제목 패턴
```
📌 [불개미 일일시황] YYYY.MM.DD (요일)
```

### 구조 (순서 엄수)
1. **이미지** (시황 카드, 맨 위)
2. **본문 텍스트** (1️⃣~4️⃣ 데이터 + 링크)
3. **불개미 코멘트** (quotation_bubble 박스)

### 본문 포맷
```
1️⃣ BTC ETH 유출입        ← 소제목: fs24, bold, center
• BTC: XXX (순유입/출)   ← 본문: fs15, #000000, center
• ETH: XXX (순유입/출)
• ETF 데이터는 마지막 거래일 기준

2️⃣ 미결제약정 추이 (24시간 기준)   ← 소제목: fs24, bold, center
• BTC 24시간: XX%
• ETH 24시간: XX%

3️⃣ DAT 추이               ← 소제목: fs24, bold, center
• WEEKLY NET INFLOW: $XXX

4️⃣ 코인베이스 프리미엄       ← 소제목: fs24, bold, center
• 현재 지수: XX%

🔗 불개미 CRYPTO 바로가기   ← fs15, center
https://fireantcrypto.com/
```

### 코멘트 박스 (quotation_bubble)
```js
{
  '@ctype': 'quotation',
  layout: 'quotation_bubble',
  value: [
    paragraph('🟰 불개미 코멘트'),
    paragraph(''),
    paragraph(코멘트_텍스트, {fontSizeCode: 'fs15'})
  ]
}
```

---

## 발행 최적 절차 (setDocumentData 방식 — 확정)

### 사전 준비
1. 이미지 파일을 `/tmp/openclaw/uploads/` 하위에 복사
2. openclaw 브라우저 네이버 로그인 확인

### 발행 순서

```
1. navigate → https://blog.naver.com/PostWriteForm.naver?blogId=fireant_korea
2. wait loadState=networkidle
3. 에디터 확인: window.SmartEditor._editors['blogpc001'] ? 'READY' : 'NOT_READY'
4. 제목 설정: ed._documentService.setDocumentTitle('제목')
5. 이미지 먼저 (반드시):
   - snapshot → "사진 추가" 버튼 ref → click → wait 500ms
   - upload selector=input[type=file] paths=["/tmp/openclaw/uploads/파일명"]
   - wait 5000ms
   - ctype=image 컴포넌트 생성 확인 필수
6. setDocumentData()로 텍스트+스타일+quotation 전체 주입 (아래 스크립트 사용)
7. 발행 버튼 클릭 → .confirm_btn__WEaBq
8. logNo 추출 + iframe #mainFrame 노출 확인
```

### 핵심 스크립트 (검증 완료)

```javascript
// 헬퍼 함수 먼저 설정
window._uid = () => 'SE-' + 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = Math.random()*16|0;
  return (c==='x' ? r : (r&0x3|0x8)).toString(16);
});
window._para = (text, align, style) => {
  const node = {id: _uid(), value: text, '@ctype': 'textNode'};
  if (style) node.style = Object.assign({'@ctype': 'nodeStyle'}, style);
  const p = {id: _uid(), nodes: [node], '@ctype': 'paragraph'};
  if (align) p.style = {align: align, '@ctype': 'paragraphStyle'};
  return p;
};

// 본문 구성
const sHead = {fontColor: '#000000', fontSizeCode: 'fs24', bold: true, '@ctype': 'nodeStyle'};
const sBody = {fontColor: '#000000', fontSizeCode: 'fs15', '@ctype': 'nodeStyle'};
const C = 'center';

// 텍스트 컴포넌트 교체
const ed = window.SmartEditor._editors['blogpc001'];
const data = ed._documentService.getDocumentData();
const textComp = data.document.components.find(c => c['@ctype'] === 'text');
textComp.value = [
  _para('1️⃣ BTC ETH 유출입', C, sHead),
  _para('• BTC: {BTC_ETF} (순유입/출)', C, sBody),
  _para('• ETH: {ETH_ETF} (순유입/출)', C, sBody),
  _para('• ETF 데이터는 마지막 거래일 기준', C, sBody),
  _para('', C, sBody),
  _para('2️⃣ 미결제약정 추이 (24시간 기준)', C, sHead),
  _para('• BTC 24시간: {BTC_OI}', C, sBody),
  _para('• ETH 24시간: {ETH_OI}', C, sBody),
  _para('', C, sBody),
  _para('3️⃣ DAT 추이', C, sHead),
  _para('• WEEKLY NET INFLOW: {DAT}', C, sBody),
  _para('', C, sBody),
  _para('4️⃣ 코인베이스 프리미엄', C, sHead),
  _para('• 현재 지수: {CB_PREMIUM}', C, sBody),
  _para('', C, sBody),
  _para('🔗 불개미 CRYPTO 바로가기', C, sBody),
  _para('https://fireantcrypto.com/', C, sBody),
];

// quotation_bubble (코멘트 박스)
const quotation = {
  id: _uid(),
  layout: 'quotation_bubble',
  value: [
    _para('🟰 불개미 코멘트', null, null),
    _para('', null, null),
    _para('{코멘트}', null, {fontSizeCode: 'fs15', '@ctype': 'nodeStyle'})
  ],
  '@ctype': 'quotation'
};
const textIdx = data.document.components.findIndex(c => c['@ctype'] === 'text');
if (!data.document.components.some(c => c['@ctype'] === 'quotation')) {
  data.document.components.splice(textIdx + 1, 0, quotation);
}
ed._documentService.setDocumentData(data);
```

### 핵심 제약
- `write()` 방식 금지 (이모지에서 텍스트 잘림 버그) → `setDocumentData()` 직접 교체만 사용
- 이미지 삽입은 사진 버튼 클릭 → file input upload 순서 (버튼 없이 upload만 하면 컴포넌트 미생성)
- 글자색: fontColor #000000 명시 (기본값이 #ffffff인 경우 있음)
- 로그인: browser type 액션 사용 (evaluate value 세팅은 봇 차단)
- 파일 업로드 경로: `/tmp/openclaw/uploads/` 하위만 허용

### 글 삭제
1. 포스트 뷰 페이지 이동
2. iframe 내 `._open_overflowmenu` 클릭
3. `.btn_del._deletePost` 클릭
4. 확인 다이얼로그 확인 버튼

---

## 자동화 크론
- **17:00 KST**: `daily-naver-blog-post` — 15:00 크론 결과물로 일일시황 자동 발행
- 데이터 소스: `/Users/fireant/.openclaw/workspace/daily-report-data.json`
- 이미지 소스: `/Users/fireant/.openclaw/workspace/daily-report-latest.png`
