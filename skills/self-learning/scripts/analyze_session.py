#!/usr/bin/env python3
"""
자기학습 분석기 - 딸수의 세션 히스토리를 분석해서 반복 실수 패턴을 감지하고
memory/lessons.md에 학습 후보를 저장한다.
"""

from __future__ import annotations

import datetime
import json
import os
import subprocess
import sys
from typing import Any

WORKSPACE = "/Users/fireant/.openclaw/workspace"
LESSONS_FILE = f"{WORKSPACE}/memory/lessons.md"
AGENTS_FILE = f"{WORKSPACE}/AGENTS.md"


def get_recent_sessions() -> list[dict[str, Any]]:
    """최근 세션 목록을 가져온다."""
    result = subprocess.run(
        ["openclaw", "sessions", "--json"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"sessions 조회 실패: {result.stderr.strip()}", file=sys.stderr)
        return []
    try:
        data = json.loads(result.stdout)
        if isinstance(data, dict) and isinstance(data.get("sessions"), list):
            return data["sessions"]
        if isinstance(data, list):
            return data
        return []
    except Exception as e:
        print(f"sessions JSON 파싱 실패: {e}", file=sys.stderr)
        return []


def get_session_messages(session_id: str, max_lines: int = 500) -> str:
    """세션 JSONL 파일을 읽어 텍스트를 추출한다."""
    path = f"/Users/fireant/.openclaw/agents/main/sessions/{session_id}.jsonl"
    if not os.path.exists(path):
        return ""

    chunks: list[str] = []
    try:
        with open(path, "r", encoding="utf-8") as f:
            for i, line in enumerate(f):
                if i >= max_lines:
                    break
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue

                def walk(x: Any) -> None:
                    if isinstance(x, dict):
                        for key in ("text", "content", "message", "body"):
                            value = x.get(key)
                            if isinstance(value, str):
                                chunks.append(value)
                        for v in x.values():
                            walk(v)
                    elif isinstance(x, list):
                        for item in x:
                            walk(item)

                walk(obj)
    except Exception as e:
        print(f"세션 파일 읽기 실패({session_id}): {e}", file=sys.stderr)
        return ""

    return "\n".join(chunks)


def load_recent_history_text() -> str:
    """최근 24시간 세션 텍스트를 모은다. 실패 시 오늘 메모리 로그로 fallback."""
    now = datetime.datetime.now(datetime.timezone.utc)
    since = now - datetime.timedelta(hours=24)

    merged: list[str] = []
    for sess in get_recent_sessions():
        created_raw = (
            sess.get("createdAt")
            or sess.get("created_at")
            or sess.get("updatedAt")
            or sess.get("updated_at")
        )
        sid = str(sess.get("id") or sess.get("sessionId") or "").strip()
        if not sid:
            continue

        include = True
        if isinstance(created_raw, str):
            try:
                dt = datetime.datetime.fromisoformat(created_raw.replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=datetime.timezone.utc)
                include = dt >= since
            except Exception:
                include = True
        elif isinstance(created_raw, (int, float)):
            try:
                dt = datetime.datetime.fromtimestamp(float(created_raw) / 1000.0, tz=datetime.timezone.utc)
                include = dt >= since
            except Exception:
                include = True

        if include:
            text = get_session_messages(sid)
            if text:
                merged.append(text)

    if merged:
        return "\n\n".join(merged)

    # fallback: 오늘 메모리 로그
    today = datetime.date.today().strftime("%Y-%m-%d")
    log_file = f"{WORKSPACE}/memory/{today}.md"
    if os.path.exists(log_file):
        with open(log_file, "r", encoding="utf-8") as f:
            return f.read()
    return ""


def analyze_patterns(history_text: str) -> list[dict[str, Any]]:
    """
    히스토리 텍스트에서 실수 패턴을 감지한다.
    반환: [{"pattern": str, "count": int, "rule_candidate": str}]
    """
    patterns: list[dict[str, Any]] = []

    followup_keywords = ["다 됐냐", "완료됐냐", "됐냐", "진행현황", "다 했냐", "어떻게됐어"]
    count = sum(history_text.count(kw) for kw in followup_keywords)
    if count > 0:
        patterns.append(
            {
                "pattern": "완료보고 누락 - 사용자가 먼저 상태를 물어봄",
                "count": count,
                "rule_candidate": "서브에이전트 완료 이벤트 수신 즉시 완료보고. 사용자가 먼저 묻는 것 = 규칙 위반.",
            }
        )

    retry_keywords = ["다시", "재시도", "또", "왜 또", "아직도"]
    count = sum(history_text.count(kw) for kw in retry_keywords)
    if count > 2:
        patterns.append(
            {
                "pattern": f"같은 작업 반복 재요청 ({count}회)",
                "count": count,
                "rule_candidate": "같은 방법 3회 실패 시 즉시 전략 전환. 재시도는 다른 방법으로.",
            }
        )

    quality_keywords = ["품질", "깨졌", "이상하다", "별로", "다시 해", "제대로"]
    count = sum(history_text.count(kw) for kw in quality_keywords)
    if count > 0:
        patterns.append(
            {
                "pattern": f"품질 불만 ({count}회)",
                "count": count,
                "rule_candidate": "작업 완료 전 결과물 직접 검증 필수. 브라우저 스크린샷 또는 API 응답 확인 후 보고.",
            }
        )

    timeout_keywords = ["timeout", "타임아웃", "시간 초과"]
    history_lower = history_text.lower()
    count = sum(history_lower.count(kw.lower()) for kw in timeout_keywords)
    if count > 1:
        patterns.append(
            {
                "pattern": f"타임아웃 반복 ({count}회)",
                "count": count,
                "rule_candidate": "동일 작업 타임아웃 2회 이상 시 작업 단위 축소 또는 도구 전환.",
            }
        )

    return patterns


def load_lessons() -> str:
    if not os.path.exists(LESSONS_FILE):
        return ""
    with open(LESSONS_FILE, "r", encoding="utf-8") as f:
        return f.read()


def save_lessons(new_patterns: list[dict[str, Any]], session_date: str) -> bool:
    existing = load_lessons()
    if not new_patterns:
        return False

    new_entries = f"\n## {session_date} 분석 결과\n\n"
    for p in new_patterns:
        new_entries += f"### 패턴: {p['pattern']}\n"
        new_entries += f"- 감지 횟수: {p['count']}회\n"
        new_entries += f"- 규칙 후보: {p['rule_candidate']}\n"
        new_entries += "- 상태: 검토 대기\n\n"

    if not existing:
        header = "# 자기학습 로그\n\n딸수의 반복 실수 패턴 분석 결과.\n승인된 항목만 AGENTS.md에 반영.\n"
        content = header + new_entries
    else:
        content = existing + new_entries

    os.makedirs(os.path.dirname(LESSONS_FILE), exist_ok=True)
    with open(LESSONS_FILE, "w", encoding="utf-8") as f:
        f.write(content)
    return True


def main() -> None:
    today = datetime.date.today().strftime("%Y-%m-%d")
    print(f"[{today}] 자기학습 분석 시작...")

    history_text = load_recent_history_text()
    if not history_text:
        print("세션/메모리 로그 없음. 종료.")
        return

    patterns = analyze_patterns(history_text)
    if not patterns:
        print("감지된 패턴 없음. 정상 운영 중.")
        return

    if save_lessons(patterns, today):
        print(f"✅ {len(patterns)}개 패턴 감지 → lessons.md 저장 완료")
        for p in patterns:
            print(f"  - {p['pattern']} ({p['count']}회)")
    else:
        print("저장 실패")


if __name__ == "__main__":
    main()
