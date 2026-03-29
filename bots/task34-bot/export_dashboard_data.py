#!/usr/bin/env python3
import json
import sqlite3
from datetime import datetime
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "task34.db"
HTML_PATH = Path("/Users/fireant/.openclaw/workspace/fireant-dashboard/task34-dashboard.html")

PROJECT_KEYWORD_MAP = [
    ("eigen", "#EigenCloud"),
    ("d3", "#D3Exchange"),
    ("infinit", "#INFINIT"),
    ("monday", "#MondayTrade"),
    ("ethgas", "#Ethgas"),
    ("blockstreet", "#BlockStreet"),
    ("virtuals", "#Virtuals"),
    ("ethena", "#Ethena"),
    ("everything", "#Everything"),
    ("kgen", "#KGEN"),
    ("pharos", "#Pharos"),
    ("aligned", "#Aligned"),
    ("stable", "#Stable"),
]


def detect_project(task_text: str) -> str:
    lower = (task_text or "").lower()
    for keyword, project in PROJECT_KEYWORD_MAP:
        if keyword in lower:
            return project
    return "#기타"


def load_rows():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT id, chat_id, user_id, username, task, due_date, done, created_at,
                   COALESCE(completed_at, '') as completed_at,
                   COALESCE(project, '') as project,
                   COALESCE(priority, 2) as priority
            FROM todos
            ORDER BY created_at DESC, id DESC
        """)
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


def to_date(iso_text: str) -> str:
    return (iso_text or "")[:10]


def build_data(rows):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    people = {}
    project_stats = {}
    created_daily = {}
    completed_daily = {}
    normalized_tasks = []

    done_count = 0

    for r in rows:
        username = r.get("username") or str(r.get("user_id"))
        task = r.get("task") or ""
        done = int(r.get("done") or 0)
        created_at = r.get("created_at") or ""
        completed_at = r.get("completed_at") or ""
        project = (r.get("project") or "").strip() or detect_project(task)

        if done:
            done_count += 1

        person = people.setdefault(username, {"total": 0, "done": 0, "pending": 0, "tasks": []})
        person["total"] += 1
        if done:
            person["done"] += 1
        else:
            person["pending"] += 1
        person["tasks"].append({
            "id": r["id"],
            "task": task,
            "due_date": r.get("due_date"),
            "done": done,
            "created_at": created_at,
            "completed_at": completed_at,
            "project": project,
            "priority": r.get("priority", 2),
        })

        cdate = to_date(created_at)
        if cdate:
            created_daily[cdate] = created_daily.get(cdate, 0) + 1

        if done:
            done_date = to_date(completed_at) or cdate
            if done_date:
                completed_daily[done_date] = completed_daily.get(done_date, 0) + 1

        p = project_stats.setdefault(project, {"total": 0, "done": 0, "participants": set()})
        p["total"] += 1
        p["done"] += done
        p["participants"].add(username)

        normalized_tasks.append({
            "assignee": username,
            "task": task,
            "due_date": r.get("due_date") or "-",
            "status": "완료" if done else "미완료",
            "created_at": created_at,
            "project": project,
        })

    assignees = []
    for name, p in sorted(people.items(), key=lambda x: x[0].lower()):
        rate = (p["done"] / p["total"] * 100) if p["total"] else 0
        assignees.append({
            "name": name,
            "total": p["total"],
            "done": p["done"],
            "pending": p["pending"],
            "completion_rate": round(rate, 1),
            "tasks": p["tasks"],
        })

    projects = []
    for proj, p in sorted(project_stats.items(), key=lambda x: (-x[1]["total"], x[0])):
        rate = (p["done"] / p["total"] * 100) if p["total"] else 0
        projects.append({
            "project": proj,
            "total": p["total"],
            "done": p["done"],
            "participant_count": len(p["participants"]),
            "participants": sorted(p["participants"]),
            "completion_rate": round(rate, 1),
        })

    total_tasks = len(rows)
    done_rate = round((done_count / total_tasks * 100), 1) if total_tasks else 0

    trend_dates = sorted(set(created_daily.keys()) | set(completed_daily.keys()))
    trends = [
        {
            "date": d,
            "created": created_daily.get(d, 0),
            "completed": completed_daily.get(d, 0),
        }
        for d in trend_dates
    ]

    return {
        "updated_at": now,
        "overall": {
            "total_tasks": total_tasks,
            "done_tasks": done_count,
            "pending_tasks": total_tasks - done_count,
            "done_rate": done_rate,
            "assignee_count": len(assignees),
        },
        "assignees": assignees,
        "projects": projects,
        "trends": trends,
        "tasks": normalized_tasks,
    }


def build_html(data: dict) -> str:
    payload = json.dumps(data, ensure_ascii=False)
    return f"""<!doctype html>
<html lang=\"ko\">
<head>
  <meta charset=\"utf-8\" />
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
  <title>Bridge34 업무 성과 대시보드</title>
  <style>
    :root {{ --bg:#0f1115; --panel:#171a21; --panel2:#1d212b; --text:#f3f5f7; --muted:#a1a8b3; --accent:#ff7a1a; --ok:#29c477; --warn:#ffcc45; --line:#2a3040; }}
    * {{ box-sizing:border-box; }}
    body {{ margin:0; background:var(--bg); color:var(--text); font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }}
    .wrap {{ max-width:1280px; margin:0 auto; padding:24px; }}
    h1 {{ margin:0 0 8px; font-size:28px; }}
    .sub {{ color:var(--muted); margin-bottom:20px; }}
    .kpi-grid {{ display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-bottom:18px; }}
    .card {{ background:linear-gradient(180deg,var(--panel),var(--panel2)); border:1px solid var(--line); border-radius:14px; padding:14px; }}
    .k {{ color:var(--muted); font-size:12px; }} .v {{ font-size:30px; font-weight:700; margin-top:8px; }}
    .accent {{ color:var(--accent); }}
    .assignee-grid {{ display:grid; grid-template-columns:repeat(2,1fr); gap:14px; margin:18px 0; }}
    .bar {{ height:10px; border-radius:999px; background:#2d3445; overflow:hidden; margin:10px 0; }}
    .fill {{ height:100%; background:linear-gradient(90deg,var(--accent),#ffa45f); }}
    .small {{ color:var(--muted); font-size:13px; }}
    table {{ width:100%; border-collapse:collapse; }}
    th,td {{ padding:10px 8px; border-bottom:1px solid var(--line); text-align:left; font-size:14px; }}
    th {{ color:#ffd2ad; font-weight:600; }}
    .section-title {{ margin:18px 0 10px; font-size:18px; }}
    .filters {{ display:flex; gap:10px; margin:10px 0 8px; }}
    select {{ background:#0f131a; color:#fff; border:1px solid var(--line); border-radius:8px; padding:8px 10px; }}
    .tag-done {{ color:var(--ok); }} .tag-pending {{ color:var(--warn); }}
    @media (max-width:980px) {{ .kpi-grid{{grid-template-columns:repeat(2,1fr)}} .assignee-grid{{grid-template-columns:1fr}} }}
  </style>
</head>
<body>
<div class=\"wrap\">
  <h1>Bridge34 업무 성과 대시보드</h1>
  <div class=\"sub\">마지막 업데이트: <span id=\"updated\"></span></div>

  <div class=\"kpi-grid\" id=\"kpi\"></div>

  <div class=\"section-title\">담당자별 성과</div>
  <div class=\"assignee-grid\" id=\"assignees\"></div>

  <div class=\"section-title\">프로젝트별 업무 분포</div>
  <div class=\"card\"><table><thead><tr><th>프로젝트</th><th>업무수</th><th>참여 인원</th><th>완료율</th></tr></thead><tbody id=\"projectRows\"></tbody></table></div>

  <div class=\"section-title\">날짜별 생성/완료 추이</div>
  <div class=\"card\"><table><thead><tr><th>날짜</th><th>생성</th><th>완료</th></tr></thead><tbody id=\"trendRows\"></tbody></table></div>

  <div class=\"section-title\">업무 전체 목록</div>
  <div class=\"filters\">
    <select id=\"assigneeFilter\"><option value=\"\">담당자 전체</option></select>
    <select id=\"statusFilter\"><option value=\"\">상태 전체</option><option value=\"완료\">완료</option><option value=\"미완료\">미완료</option></select>
  </div>
  <div class=\"card\"><table><thead><tr><th>담당자</th><th>업무</th><th>마감일</th><th>상태</th><th>등록일</th></tr></thead><tbody id=\"taskRows\"></tbody></table></div>
</div>
<script>
const DATA = {payload};
const el = (id)=>document.getElementById(id);
el('updated').textContent = DATA.updated_at;

const kpis = [
  ['전체 업무수', DATA.overall.total_tasks],
  ['완료율', DATA.overall.done_rate + '%'],
  ['미완료', DATA.overall.pending_tasks],
  ['담당자수', DATA.overall.assignee_count],
];
el('kpi').innerHTML = kpis.map(([k,v])=>`<div class="card"><div class="k">${{k}}</div><div class="v accent">${{v}}</div></div>`).join('');

el('assignees').innerHTML = DATA.assignees.map(a=>{{
  const pending = a.tasks.filter(t=>!t.done).slice(0,5).map(t=>`<div class=\"small\">• ${{t.task}}</div>`).join('') || '<div class="small">미완료 없음</div>';
  return `<div class="card"><div style="display:flex;justify-content:space-between"><strong>${{a.name}}</strong><span class="small">${{a.done}}/${{a.total}}</span></div><div class="bar"><div class="fill" style="width:${{a.completion_rate}}%"></div></div><div class="small">완료율 ${{a.completion_rate}}%</div><div style="margin-top:8px">${{pending}}</div></div>`;
}}).join('');

el('projectRows').innerHTML = DATA.projects.map(p=>`<tr><td>${{p.project}}</td><td>${{p.total}}</td><td>${{p.participant_count}}</td><td>${{p.completion_rate}}%</td></tr>`).join('');
el('trendRows').innerHTML = DATA.trends.map(t=>`<tr><td>${{t.date}}</td><td>${{t.created}}</td><td>${{t.completed}}</td></tr>`).join('');

const assignees = [...new Set(DATA.tasks.map(t=>t.assignee))].sort();
el('assigneeFilter').innerHTML += assignees.map(a=>`<option value="${{a}}">${{a}}</option>`).join('');

function renderTasks() {{
  const af = el('assigneeFilter').value;
  const sf = el('statusFilter').value;
  const rows = DATA.tasks.filter(t => (!af || t.assignee===af) && (!sf || t.status===sf));
  el('taskRows').innerHTML = rows.map(t=>`<tr><td>${{t.assignee}}</td><td>${{t.task}}</td><td>${{t.due_date}}</td><td class="${{t.status==='완료'?'tag-done':'tag-pending'}}">${{t.status}}</td><td>${{(t.created_at||'').slice(0,16).replace('T',' ')}}</td></tr>`).join('');
}}

el('assigneeFilter').addEventListener('change', renderTasks);
el('statusFilter').addEventListener('change', renderTasks);
renderTasks();
</script>
</body>
</html>
"""


def main():
    data = build_data(load_rows())
    print(json.dumps(data, ensure_ascii=False, indent=2))
    HTML_PATH.write_text(build_html(data), encoding="utf-8")


if __name__ == "__main__":
    main()
