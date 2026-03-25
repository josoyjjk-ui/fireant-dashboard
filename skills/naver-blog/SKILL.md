---
name: naver-blog
description: 네이버 블로그에 글 작성 및 발행. 텍스트 + 이미지 포함 포스팅 자동화. 네이버 스마트에디터 ONE의 Virtual DOM 우회, CDP 키보드 입력, 파일 업로드까지 처리. 트리거: "블로그 써줘", "네이버에 올려줘", "블로그 발행해줘", "블로그 포스팅".
---

# Naver Blog

## 전제 조건

- OpenClaw 브라우저(openclaw profile)에 네이버 로그인 필요
- 로그인 확인: `blog.naver.com/{blogId}` 접속 후 NID_AUT 쿠키 존재 여부 확인
- 미로그인 시: `https://nid.naver.com/nidlogin.login` 열고 해병님 직접 로그인 요청

## 최적 워크플로우

### 1. 에디터 진입

```
browser navigate → https://blog.naver.com/PostWriteForm.naver?blogId=fireant_korea
wait 4000ms
```

### 2. 제목 입력 (CDP insertText)

```python
# 제목 영역 클릭 (y≈248)
Input.dispatchMouseEvent: mousePressed/mouseReleased x=285 y=248
sleep 0.5s
Input.insertText: "제목 텍스트"
```

### 3. 이미지 업로드 (제목 입력 직후)

이미지는 **본문 텍스트 전에** 삽입해야 에디터 포커스 리셋 방지.

```
# 이미지 파일을 /tmp/openclaw/uploads/ 로 복사
cp <소스> /tmp/openclaw/uploads/<파일명>

# 사진 추가 버튼 클릭 (snapshot ref: 사진 추가)
browser act → click "사진 추가" 버튼

# file input에 업로드
browser upload → selector: input[type=file], path: /tmp/openclaw/uploads/<파일명>
wait 3000ms
```

### 4. 본문 텍스트 입력

이미지 업로드 후 라이브러리 패널 닫기 → iframe body 포커스 → insertText.

```python
# iframe 내부 body 포커스
Runtime.evaluate:
  const iframe = document.querySelector('iframe');
  iframe.contentDocument.body.focus();

# CDP insertText
Input.insertText: "본문 내용"
```

### 5. 검증

```python
Runtime.evaluate:
  const iframe = document.querySelector('iframe');
  return iframe.contentDocument.body.innerText;
# → 본문 텍스트 확인

# snapshot에서 article 내 img 태그 확인 → 이미지 삽입 여부
```

### 6. 발행

```
browser act → click "발행" 버튼 (ref: 발행)
wait 2000ms

# 발행 확인 버튼 (CSS 클래스)
Runtime.evaluate: document.querySelector('.confirm_btn__WEaBq').click()
wait 3000ms

# URL 확인 → PostView.naver 로 이동했으면 성공
Runtime.evaluate: location.href
```

## 핵심 제약 & 알려진 이슈

| 이슈 | 원인 | 해결 |
|------|------|------|
| 텍스트박스 disabled | 에디터 초기화 중 | wait 4000ms 후 재시도 |
| 본문 에디터에 안 보임 | Virtual DOM (DOM 직접 조작 불가) | iframe body.focus() 후 CDP insertText |
| 이미지 후 본문 사라짐 | 사진 버튼 클릭 시 포커스 리셋 | 이미지 먼저, 본문 나중에 |
| 중복 입력 | insertText 중복 호출 | 입력 전 iframe 내용 확인 후 필요시 innerHTML 초기화 |
| 발행 버튼 클래스명 변경 | 네이버 배포 | `.confirm_btn__WEaBq` → snapshot으로 재확인 |
| 수정 모드 접근 불가 | 세션 인증 부족 | PostModifyForm 대신 새 글로 작성 |

## CDP WebSocket 직접 호출 패턴

```python
import asyncio, json, websockets

TARGET_ID = "857E7869809C74158558E367C190DCEA"  # blog.naver.com 탭 ID
WS_URL = f"ws://127.0.0.1:18800/devtools/page/{TARGET_ID}"

async def cdp_call():
    async with websockets.connect(WS_URL) as ws:
        # 마우스 클릭
        await ws.send(json.dumps({"id": 1, "method": "Input.dispatchMouseEvent",
            "params": {"type": "mousePressed", "x": 285, "y": 248, "button": "left", "clickCount": 1}}))
        await ws.recv()
        # 텍스트 입력
        await ws.send(json.dumps({"id": 2, "method": "Input.insertText", "params": {"text": "내용"}}))
        await ws.recv()

asyncio.run(cdp_call())
```

탭 ID는 `browser tabs profile=openclaw` 로 확인.

## 참고

- 블로그 ID: `fireant_korea`
- 블로그 URL: https://blog.naver.com/fireant_korea
- 네이버 스마트에디터 ONE: API 폐쇄됨, DOM 직접 조작 불가, CDP insertText만 유효
- 파일 업로드 경로 제한: `/tmp/openclaw/uploads/` 내부만 허용
