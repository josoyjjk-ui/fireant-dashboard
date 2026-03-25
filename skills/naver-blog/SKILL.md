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

## 발행 최적 절차

### 사전 준비
1. 이미지 파일을 `/tmp/openclaw/uploads/` 하위에 복사
2. openclaw 브라우저 네이버 로그인 확인

### 발행 순서 (엄수)
1. **navigate** → `https://blog.naver.com/PostWriteForm.naver?blogId=fireant_korea`
2. **wait** loadState=networkidle
3. **에디터 준비 확인**: `window.SmartEditor._editors['blogpc001'] ? 'READY' : 'NOT_READY'`
4. **제목 설정**: `ed._documentService.setDocumentTitle('제목')`
5. **이미지 삽입** (텍스트보다 반드시 먼저):
   - snapshot으로 "사진 추가" 버튼 ref 확인 → click
   - wait 500ms
   - `upload selector=input[type=file] paths=[...]`
   - wait 5000ms
   - 이미지 컴포넌트(ctype=image) 생성 확인 필수
6. **텍스트 삽입**:
   - `ed._editingService.insertTextCompAtLast()`
   - `ed._editingService.write('본문')`
7. **글자색 수정** (흰색→검정, 필수):
   ```js
   const data = ed._documentService.getDocumentData();
   const fixed = JSON.stringify(data).replace(/"fontColor":"#ffffff"/g, '"fontColor":"#000000"');
   ed._documentService.setDocumentData(JSON.parse(fixed));
   ```
8. **발행**: 발행 버튼 클릭 → `.confirm_btn__WEaBq` 확인
9. **검증**: iframe #mainFrame에서 텍스트+이미지 노출 확인

### 글 삭제
1. 포스트 뷰 페이지 이동
2. iframe 내 `._open_overflowmenu` 클릭
3. `.btn_del._deletePost` 클릭
4. 확인 다이얼로그 확인 버튼

## 핵심 제약
- `execCommand` / DOM 직접 조작 불가 → SmartEditor JS API만 유효
- `write()` 후 반드시 `setDocumentData()`로 fontColor #ffffff → #000000 교체
- 이미지는 사진 버튼 클릭 후 file input upload 방식 (버튼 클릭 없이 upload만 하면 컴포넌트 미생성)
- 로그인: `browser type` 액션 사용 (evaluate value 직접 세팅 시 봇 차단)
- 파일 업로드 경로: `/tmp/openclaw/uploads/` 하위만 허용
