#!/usr/bin/env node
/**
 * Fireant Memory System
 * SQLite + Ollama bge-m3 + BM25 + Vector Hybrid + RRF + WAL
 * 글: SQLite + 로컬 Ollama 기반 영구 메모리 스택
 */

import Database from 'better-sqlite3';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'memories.db');
const OLLAMA_URL = 'http://localhost:11434';
const EMBED_MODEL = 'bge-m3';
const SUPERSEDE_THRESHOLD = 0.85;
const TOP_K = 5;

// ── DB 초기화 ──────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS memories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    text        TEXT NOT NULL,
    embedding   TEXT NOT NULL,
    category    TEXT DEFAULT 'general',
    tags        TEXT DEFAULT '',
    created_at  INTEGER DEFAULT (unixepoch()),
    superseded  INTEGER DEFAULT 0,
    superseded_by INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_category  ON memories(category);
  CREATE INDEX IF NOT EXISTS idx_superseded ON memories(superseded);
  CREATE INDEX IF NOT EXISTS idx_created   ON memories(created_at DESC);
`);

// ── Ollama 임베딩 ────────────────────────────────────────────
async function embed(text) {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text })
  });
  if (!res.ok) throw new Error(`Ollama embed error: ${res.status}`);
  const { embedding } = await res.json();
  return embedding;
}

// ── 코사인 유사도 ──────────────────────────────────────────
function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ── BM25 키워드 검색 ──────────────────────────────────────
function bm25Search(query, rows, k1 = 1.5, b = 0.75) {
  const tokens = tokenize(query);
  if (!tokens.length) return [];

  const N = rows.length;
  const avgdl = rows.reduce((s, r) => s + tokenize(r.text).length, 0) / N || 1;

  const idf = {};
  for (const t of tokens) {
    const df = rows.filter(r => tokenize(r.text).includes(t)).length;
    idf[t] = Math.log((N - df + 0.5) / (df + 0.5) + 1);
  }

  return rows.map(row => {
    const words = tokenize(row.text);
    const dl = words.length;
    let score = 0;
    for (const t of tokens) {
      const tf = words.filter(w => w === t).length;
      score += idf[t] * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl / avgdl));
    }
    return { ...row, bm25: score };
  }).filter(r => r.bm25 > 0).sort((a, b) => b.bm25 - a.bm25);
}

function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^\w가-힣]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

// ── Reciprocal Rank Fusion ────────────────────────────────
function rrf(vecRanked, bm25Ranked, k = 60) {
  const scores = {};
  vecRanked.forEach((r, i) => {
    scores[r.id] = (scores[r.id] || 0) + 1 / (k + i + 1);
  });
  bm25Ranked.forEach((r, i) => {
    scores[r.id] = (scores[r.id] || 0) + 1 / (k + i + 1);
  });

  const merged = [...new Map(
    [...vecRanked, ...bm25Ranked].map(r => [r.id, r])
  ).values()];

  return merged
    .sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0))
    .slice(0, TOP_K);
}

// ── 메모리 추가 (WAL: 저장 먼저, 응답 나중) ──────────────
export async function addMemory(text, category = 'general', tags = '') {
  const start = Date.now();

  // 1. 임베딩
  const vec = await embed(text);
  const vecJson = JSON.stringify(vec);

  // 2. 기존 항목 중 유사한 것 supersede 처리
  const actives = db.prepare(
    'SELECT id, embedding FROM memories WHERE superseded = 0'
  ).all();

  const supersededIds = [];
  for (const row of actives) {
    const existing = JSON.parse(row.embedding);
    const sim = cosineSim(vec, existing);
    if (sim >= SUPERSEDE_THRESHOLD) {
      supersededIds.push(row.id);
    }
  }

  // 3. 새 항목 저장 (WAL: 이게 먼저)
  const { lastInsertRowid: newId } = db.prepare(
    'INSERT INTO memories (text, embedding, category, tags) VALUES (?, ?, ?, ?)'
  ).run(text, vecJson, category, tags);

  // 4. 구버전 비활성화
  if (supersededIds.length) {
    const placeholders = supersededIds.map(() => '?').join(',');
    db.prepare(
      `UPDATE memories SET superseded = 1, superseded_by = ? WHERE id IN (${placeholders})`
    ).run(newId, ...supersededIds);
  }

  const elapsed = Date.now() - start;
  return {
    id: newId,
    superseded: supersededIds.length,
    elapsed
  };
}

// ── 메모리 검색 (벡터 + BM25 + RRF) ─────────────────────
export async function searchMemory(query, category = null) {
  const start = Date.now();

  // 활성 항목만
  const where = category
    ? 'WHERE superseded = 0 AND category = ?'
    : 'WHERE superseded = 0';
  const rows = category
    ? db.prepare(`SELECT id, text, category, tags, created_at FROM memories ${where}`).all(category)
    : db.prepare(`SELECT id, text, category, tags, created_at FROM memories ${where}`).all();

  if (!rows.length) return { results: [], elapsed: Date.now() - start };

  // 벡터 검색
  const queryVec = await embed(query);
  const allRows = db.prepare(
    `SELECT id, text, embedding, category, tags, created_at FROM memories ${where.replace('SELECT id, text,', 'SELECT id, text, embedding,')}`
  ).all(...(category ? [category] : []));

  const vecRanked = allRows
    .map(r => ({ ...r, sim: cosineSim(queryVec, JSON.parse(r.embedding)) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 20);

  // BM25 검색
  const bm25Ranked = bm25Search(query, rows).slice(0, 20);

  // RRF 합산
  const results = rrf(vecRanked, bm25Ranked);
  const elapsed = Date.now() - start;

  return {
    results: results.map(r => ({
      id: r.id,
      text: r.text,
      category: r.category,
      tags: r.tags,
      score: r.sim?.toFixed(3),
      created_at: new Date(r.created_at * 1000).toISOString().slice(0, 10)
    })),
    elapsed
  };
}

// ── 통계 ────────────────────────────────────────────────
export function stats() {
  const total    = db.prepare('SELECT COUNT(*) as n FROM memories').get().n;
  const active   = db.prepare('SELECT COUNT(*) as n FROM memories WHERE superseded=0').get().n;
  const bycat    = db.prepare(
    'SELECT category, COUNT(*) as n FROM memories WHERE superseded=0 GROUP BY category ORDER BY n DESC'
  ).all();
  return { total, active, superseded: total - active, bycat };
}

// ── 기존 .md 메모리 마이그레이션 ─────────────────────────
export async function migrateMarkdown(memDir) {
  const files = readdirSync(memDir).filter(f => f.endsWith('.md'));
  let imported = 0, skipped = 0;

  for (const file of files) {
    const cat = file.replace('.md', '');
    const content = readFileSync(join(memDir, file), 'utf-8');

    // 섹션/단락 단위로 분리
    const chunks = content
      .split(/\n(?=#{1,3} |\n)/)
      .map(c => c.trim())
      .filter(c => c.length > 30);

    for (const chunk of chunks) {
      try {
        await addMemory(chunk, cat, file);
        imported++;
      } catch (e) {
        skipped++;
      }
    }
    process.stdout.write(`  ${file}: ${chunks.length}개 처리\n`);
  }

  return { imported, skipped };
}

// ── CLI ───────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [,, cmd, ...args] = process.argv;

  if (cmd === 'add') {
    const text     = args[0];
    const category = args[1] || 'general';
    const tags     = args[2] || '';
    if (!text) { console.error('Usage: memory.js add <text> [category] [tags]'); process.exit(1); }
    const r = await addMemory(text, category, tags);
    console.log(JSON.stringify(r));

  } else if (cmd === 'search') {
    const query    = args[0];
    const category = args[1] || null;
    if (!query) { console.error('Usage: memory.js search <query> [category]'); process.exit(1); }
    const r = await searchMemory(query, category);
    console.log(JSON.stringify(r, null, 2));

  } else if (cmd === 'stats') {
    console.log(JSON.stringify(stats(), null, 2));

  } else if (cmd === 'migrate') {
    const dir = args[0] || join(__dirname, '../memory');
    console.log(`마이그레이션 시작: ${dir}`);
    const r = await migrateMarkdown(dir);
    console.log(JSON.stringify({ ...r, ...stats() }, null, 2));

  } else {
    console.log(`
Fireant Memory System
Commands:
  add <text> [category] [tags]  — 메모리 추가 (WAL)
  search <query> [category]     — 하이브리드 검색
  stats                         — 통계
  migrate [dir]                 — .md 파일 마이그레이션
    `);
  }
}
