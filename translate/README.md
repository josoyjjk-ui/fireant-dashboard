# 라이브 AMA 통역기 (`/translate/`)

antinfo.io의 **정적 단일 파일** 도구입니다. 빌드 스텝·서버·번들러 없이 브라우저에서 바로 동작합니다.
시스템 오디오(게스트) + 마이크(호스트)를 실시간 STT + 번역해 **OBS 브라우저 소스** 자막으로 송출합니다.

- 파일: `translate/index.html` (자체 완결, 바닐라 JS)
- 동기화: **Supabase Realtime Broadcast** (DB 테이블 아님) — 채널 `translate:<sessionId>`, 이벤트 `caption`
- STT/번역: 브라우저에서 OpenAI/Groq REST를 **직접** 호출 (BYO 키, `localStorage`에만 저장)

---

## 두 가지 모드

| 모드 | URL | 설명 |
|---|---|---|
| **운영자** | `/translate/` | 로그인 게이트 → 화이트리스트 → 캡처·STT·번역·방송·리캡·히스토리 전체 UI |
| **OBS 오버레이** | `/translate/?obs=1&session=<id>` | 자막만 렌더링(구독 전용, 로그인 불필요). 크로마키 그린(#00ff00) 기본 |

### OBS 오버레이 쿼리 파라미터
`session`(필수) 외 선택: `bg`(green|transparent|색상), `font`, `size`(px), `pos`(top|bottom), `outline`(1|0), `opacity`(0~1), `lines`(both|dst).
미지정 값은 `localStorage.translate.overlay`에서 폴백합니다. 예:
```
/translate/?obs=1&session=ab12cd34&bg=transparent&pos=bottom&size=44&lines=both
```

---

## 운영자 사용 순서

1. `/translate/` 접속 → **Google 로그인**. 화이트리스트(`translate_whitelist`)에 이메일이 있어야 진입합니다.
2. **🔑 API 키**: OpenAI 키(필수), Groq 키(선택) 입력 후 저장.
   - 키는 **브라우저 localStorage에만** 저장되고 각 AI 제공사로만 직접 전송됩니다. 우리 서버로는 전송되지 않습니다.
3. **🌐 언어·모델**: 대상 언어(기본 한↔영 자동), STT 제공자, 번역 모델, 품질 힌트 설정.
4. **📖 용어집**: 티커·프로젝트명·불개미 슬랭 등 고정 번역 등록(번역 프롬프트에 주입).
5. **📡 방송 세션**: 세션 ID 확인 → OBS URL 복사 → OBS에 브라우저 소스로 추가 → **▶ 방송 시작**.
6. **🎧 캡처**: `🎤 마이크 시작`(호스트), `🖥️ 시스템 시작`(게스트, 화면공유 시 "오디오 공유" 체크 필수).
   - 기본은 화자 분리(호스트=마이크, 게스트=시스템). "믹스 모드" 체크 시 단일 스트림(화자=unknown).
   - 무음 감지(ms)·임계값(RMS)으로 발화 청킹 민감도 조절.
7. 발화가 STT→번역되어 라이브 자막에 뜨고, OBS 오버레이로 실시간 송출됩니다.
8. 종료: **■ 방송 중지**. **💾 세션 저장**으로 Supabase에 기록.

### 리캡 & 발행
- **📄 로그(.txt)**: 원문/번역/화자/타임스탬프 전체 로그 다운로드.
- **✨ 리캡 생성**: 로그를 LLM에 보내 불개미 스타일(`~습니다`체, 📌 불릿, 결론 먼저) 포스트 초안 생성.
- **✈️ 텔레그램 발행**: 정적 페이지는 봇 토큰을 안전히 보관할 수 없어 **클립보드 복사 + 파일 다운로드**만 수행합니다.
  실제 채널 발행은 아래 운영자 스크립트/기존 파이프라인으로 진행하세요. (코드의 `publishRecap()` 훅에 향후 인증 엔드포인트 연결 지점 표시)

---

## 아카이브(운영자 로컬 단계)

정적 브라우저 페이지는 로컬 파일시스템·`localhost:9621`(LightRAG)에 접근할 수 없습니다. 따라서:

1. 앱에서 **🗂️ 아카이브(.md)** 클릭 → YAML frontmatter(`title`, `date`, `type: report`, `tags`) + 리캡 + 로그가 담긴 마크다운 노트가 다운로드됩니다.
2. 운영자가 로컬에서:
   ```bash
   # 다운로드된 report-ama-YYYY-MM-DD-<session>.md 를 Obsidian vault reports/ 로 이동
   mv ~/Downloads/report-ama-*.md /Users/fireant/.openclaw/wiki/main/reports/
   # 이어서 LightRAG 인덱싱 (MCP lightrag_insert 또는 운영 스크립트)
   ```
3. 이로써 리서치 산출물 흐름(Obsidian `reports/` → LightRAG 인덱싱)에 편입됩니다.

클라이언트 책임 범위는 **올바른 frontmatter 노트 생성**까지입니다.

---

## Supabase 스키마 (앱이 기대하는 정확한 정의)

앱이 하드코딩한 이름:
- 채널: `translate:<sessionId>`, 브로드캐스트 이벤트: `caption`
- 테이블: `translate_whitelist`, `translate_sessions`
- localStorage 키: `translate.openaiKey`, `translate.groqKey`, `translate.glossary`, `translate.overlay`

### 테이블 `translate_whitelist`
```sql
create table if not exists public.translate_whitelist (
  email      text primary key,
  created_at timestamptz not null default now()
);
alter table public.translate_whitelist enable row level security;

-- 로그인된 유저는 목록 조회 가능(자기 이메일 게이트 체크에 필요)
create policy "wl_select_authenticated" on public.translate_whitelist
  for select to authenticated using (true);

-- 추가/삭제는 이미 화이트리스트에 있는 유저만(운영자 관리 패널). 없으면 RLS로 차단되고 앱은 에러만 표시.
create policy "wl_insert_by_members" on public.translate_whitelist
  for insert to authenticated
  with check (exists (select 1 from public.translate_whitelist w
    where lower(w.email) = lower(auth.jwt() ->> 'email')));

create policy "wl_delete_by_members" on public.translate_whitelist
  for delete to authenticated
  using (exists (select 1 from public.translate_whitelist w
    where lower(w.email) = lower(auth.jwt() ->> 'email')));

-- 최초 운영자 시드 (별도로 1회)
insert into public.translate_whitelist (email) values ('josoyjjk@gmail.com') on conflict do nothing;
```

### 테이블 `translate_sessions`
```sql
create table if not exists public.translate_sessions (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null default auth.uid(),
  title      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  lines      jsonb,
  recap      text
);
alter table public.translate_sessions enable row level security;

create policy "sessions_owner_all" on public.translate_sessions
  for all to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid());
```

### Realtime
- 별도 테이블 publication 불필요. **Broadcast 전용**이므로 Realtime이 프로젝트에서 활성화만 되어 있으면 됩니다.
- 오버레이 클라이언트는 anon 키로 **구독만** 합니다(쓰기 없음). OBS URL에는 세션 ID만 노출되고 비밀/쓰기 토큰은 담기지 않습니다.

---

## 구현된 요구사항 ID
ACC-01~04, CAP-01~04, SPK-01~02, STT-01~02, TRN-01~03, LNG-01, SUB-01~02, OBS-01,
GLO-01~02, REC-01~04, HIS-01, ARC-01~02, BRD-01.

### 핵심 정확성 3원칙
1. **단조증가 rev 가드** — 오버레이는 `rev <= lastRev` 캡션을 무시(깜빡임/역순 방지).
2. **읽기/쓰기 분리** — 오버레이는 구독 전용, 운영자 페이지만 브로드캐스트.
3. **직렬화 + 디바운스(~120ms) 송출** — 순서 보존 + 급변 병합.
