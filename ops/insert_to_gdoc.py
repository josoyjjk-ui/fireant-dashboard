#!/usr/bin/env python3
"""Orderly 계획서 → Google Docs 삽입"""
import subprocess, json, urllib.request, urllib.parse

DOC_ID = "1qmvLbzAVpcYqQDj4xxufRUWOmh2nAm-JtOm7ZSHPVU4"

def get_token():
    r = subprocess.run(["gcloud","auth","print-access-token"], capture_output=True, text=True)
    return r.stdout.strip()

def api(method, endpoint, body=None, token=None):
    url = f"https://docs.googleapis.com/v1/{endpoint}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method,
          headers={"Authorization":f"Bearer {token}","Content-Type":"application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"error": e.read().decode()}

token = get_token()
print(f"Token: {token[:20]}...")

# 현재 문서 상태 확인
doc = api("GET", f"documents/{DOC_ID}", token=token)
if "error" in doc:
    print("GET error:", doc)
    exit(1)

print(f"Doc title: {doc.get('title')}")

# 기존 내용 전체 삭제
body_content = doc.get("body", {}).get("content", [])
end_index = body_content[-1].get("endIndex", 2) if body_content else 2

requests = []

# 기존 내용 삭제 (index 1 ~ end_index-1)
if end_index > 2:
    requests.append({
        "deleteContentRange": {
            "range": {"startIndex": 1, "endIndex": end_index - 1}
        }
    })

# 삽입할 텍스트 블록 정의 (역순으로 삽입 - 앞에서부터 삽입하면 index 밀림)
# 텍스트 먼저 하나로 합쳐서 삽입 후 스타일 적용

full_text = """Orderly Network 한국 커뮤니티 활동 계획서
작성일: 2026년 3월 1일  |  작성자: 불개미 (Fireant)  |  대상: Orderly Network 내부 팀  |  문서 유형: 내부 보고용

1. 배경 및 목적
Orderly Network의 한국 시장 확대를 위해 로컬 KOL 파트너십을 통한 커뮤니티 구축 및 콘텐츠 현지화를 추진한다. 본 문서는 활동 시작 시점부터 초기 90일간의 실행 계획과 필요 리소스를 정리한 내부 보고용 계획서다.

2. 활동 계획

2-1. 텔레그램 채널 및 그룹 인수인계 (1순위)
• 대상: 기존 Orderly 한국 텔레그램 채널 및 그룹
• 요청 사항: 채널·그룹 Owner 권한 이전
• 목적: 직접 운영을 통한 빠른 콘텐츠 업데이트 및 커뮤니티 관리
• 담당 팀 요청: 현재 Owner 계정으로부터 권한 이전 처리

2-2. 네이버 블로그 운영 권한 확보 (1순위)
• 대상 블로그: https://blog.naver.com/orderlykr/224136627511
• 요청 사항: 블로그 포스팅 작성 권한 부여
• 목적: 한국어 검색 유입 확보 및 콘텐츠 허브 운영
• 담당 팀 요청: 블로그 계정 공유 또는 공동 운영자 등록 처리

2-3. 공식 합류 공지 (온보딩 이후 즉시)
• 채널: 트위터(X) + 텔레그램 동시 발행
• 내용: Orderly 팀 합류 공식 어나운스
• 형식: 팀 소개 + 앞으로의 활동 방향 + 커뮤니티 참여 CTA
• 목적: 기존 팔로워 유입, 한국 커뮤니티 신뢰 확보

2-4. 블로그 및 텔레그램 콘텐츠 현지화 (1개월 이내)
현재 네이버 블로그에는 Orderly Network 기본 소개까지만 작성된 상태. 아래 항목을 신규 작성한다.
• Orderly One: 서비스 개요, 주요 기능, 사용 방법 한국어 안내
• Orderly Vault: 구조 설명, 수익 구조, 리스크 안내
• 최신 업데이트: 최근 주요 업데이트 내역 정리 및 의미 해석
• 텔레그램 연계: 블로그 발행 즉시 TG 채널·그룹 공지로 연결

2-5. 초기 1개월 운영 방향 (별도 예산 없이 진행)
3월 한 달은 인프라 세팅 및 콘텐츠 현지화에 집중. 별도 캠페인·이벤트 예산 없이 자체 역량으로 진행한다.
3월 우선 과제:
• TG 채널·그룹 Owner 권한 인수인계 완료
• 네이버 블로그 작성 권한 확보
• 합류 공지 발행 (트위터 + 텔레그램)
• 블로그 콘텐츠 3편 이상 발행 (Orderly One / Vault / 최신 업데이트)
• TG 커뮤니티 운영 정상화 (공지 주기 확립, 질문 응답 체계 구축)

2-6. 4월 이후 예산 및 리소스 요청 예정
4월부터 활동 규모 확대를 위해 팀에 예산 및 추가 리소스를 요청할 예정.
예상 요청 항목:
• 커뮤니티 이벤트·에어드랍 예산
• 한국 KOL 협업 예산
• 번역·디자인 리소스

3. 타임라인
• 3월 1주차: TG/블로그 권한 인수인계, 합류 공지 발행
• 3월 2주차: 블로그 콘텐츠 1차 발행 (Orderly One)
• 3월 3주차: 블로그 콘텐츠 2차 발행 (Orderly Vault)
• 3월 4주차: 블로그 최신 업데이트 발행, 1개월 성과 정리
• 4월 초: 팀에 2분기 예산·리소스 요청

4. 팀 측 즉시 처리 요청 사항
아래 2가지는 활동 시작을 위해 팀 측에서 먼저 처리가 필요한 항목이다.
① 텔레그램 채널 및 그룹 Owner 권한 이전 (현 TG 관리자)
② 네이버 블로그(orderlykr) 작성 권한 부여 (마케팅 팀)

5. 기대 효과
• 단기 (1개월): 한국 커뮤니티 활성화 기반 구축, 블로그 신규 콘텐츠 4편 이상 확보
• 중기 (3개월): 네이버 검색 유입 증가, TG 한국 멤버 증가, 정기 콘텐츠 사이클 확립
• 장기: 국내 Orderly 유저 확보, 한국 시장 내 브랜드 인지도 제고

본 계획서는 내부 보고용이며, 활동 진행에 따라 내용이 업데이트될 수 있습니다."""

# 텍스트 삽입
requests.append({
    "insertText": {
        "location": {"index": 1},
        "text": full_text
    }
})

# batchUpdate 실행
result = api("POST", f"documents/{DOC_ID}:batchUpdate", {"requests": requests}, token=token)
if "error" in result:
    print("batchUpdate error:", result)
    exit(1)
print("텍스트 삽입 완료")

# 이제 스타일 적용 - 문서 다시 조회해서 인덱스 파악
doc2 = api("GET", f"documents/{DOC_ID}", token=token)
content = doc2.get("body", {}).get("content", [])

# 헤딩 스타일 적용할 단락 찾기
style_requests = []
headings = {
    "Orderly Network 한국 커뮤니티 활동 계획서": "HEADING_1",
    "1. 배경 및 목적": "HEADING_2",
    "2. 활동 계획": "HEADING_2",
    "2-1. 텔레그램 채널 및 그룹 인수인계 (1순위)": "HEADING_3",
    "2-2. 네이버 블로그 운영 권한 확보 (1순위)": "HEADING_3",
    "2-3. 공식 합류 공지 (온보딩 이후 즉시)": "HEADING_3",
    "2-4. 블로그 및 텔레그램 콘텐츠 현지화 (1개월 이내)": "HEADING_3",
    "2-5. 초기 1개월 운영 방향 (별도 예산 없이 진행)": "HEADING_3",
    "2-6. 4월 이후 예산 및 리소스 요청 예정": "HEADING_3",
    "3. 타임라인": "HEADING_2",
    "4. 팀 측 즉시 처리 요청 사항": "HEADING_2",
    "5. 기대 효과": "HEADING_2",
}

for element in content:
    para = element.get("paragraph")
    if not para:
        continue
    para_text = "".join(
        e.get("textRun", {}).get("content", "")
        for e in para.get("elements", [])
    ).strip()
    
    for heading_text, heading_style in headings.items():
        if para_text == heading_text:
            start = element.get("startIndex", 0)
            end = element.get("endIndex", 0)
            style_requests.append({
                "updateParagraphStyle": {
                    "range": {"startIndex": start, "endIndex": end},
                    "paragraphStyle": {"namedStyleType": heading_style},
                    "fields": "namedStyleType"
                }
            })
            break

if style_requests:
    r3 = api("POST", f"documents/{DOC_ID}:batchUpdate", {"requests": style_requests}, token=token)
    if "error" in r3:
        print("Style error:", r3)
    else:
        print(f"헤딩 스타일 {len(style_requests)}개 적용 완료")
else:
    print("스타일 적용할 헤딩 없음")

print(f"\n✅ 완료: https://docs.google.com/document/d/{DOC_ID}/edit")
