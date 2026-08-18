import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { env } from '../config/env.js';

fs.mkdirSync(path.dirname(env.DATABASE_PATH), { recursive: true });

export const db = new DatabaseSync(env.DATABASE_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

export function withTransaction<T>(callback: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('policy', 'target')),
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      char_count INTEGER NOT NULL,
      page_count INTEGER,
      parser_version TEXT NOT NULL,
      full_text TEXT NOT NULL,
      warnings_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'parsed',
      storage_path TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_documents_sha256 ON documents(sha256);

    CREATE TABLE IF NOT EXISTS document_clauses (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      title TEXT NOT NULL,
      text TEXT NOT NULL,
      page_start INTEGER,
      page_end INTEGER,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL,
      parent_clause_id TEXT,
      UNIQUE(document_id, sequence)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS clause_fts USING fts5(
      clause_id UNINDEXED,
      document_id UNINDEXED,
      title,
      text,
      tokenize='unicode61'
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      policy_document_id TEXT NOT NULL REFERENCES documents(id),
      target_document_id TEXT NOT NULL REFERENCES documents(id),
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      processed_clauses INTEGER NOT NULL DEFAULT 0,
      total_clauses INTEGER NOT NULL DEFAULT 0,
      overall_risk TEXT,
      summary TEXT,
      draft_opinion TEXT,
      missing_information_json TEXT NOT NULL DEFAULT '[]',
      coverage_rate REAL,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_reviews_created_at ON reviews(created_at DESC);

    CREATE TABLE IF NOT EXISTS findings (
      id TEXT PRIMARY KEY,
      review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
      rule_title TEXT NOT NULL,
      status TEXT NOT NULL,
      severity TEXT NOT NULL,
      reason TEXT NOT NULL,
      remediation TEXT NOT NULL,
      confidence REAL NOT NULL,
      requires_human_review INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
      document_id TEXT NOT NULL REFERENCES documents(id),
      document_kind TEXT NOT NULL,
      clause_id TEXT NOT NULL,
      clause_title TEXT,
      page INTEGER,
      excerpt TEXT NOT NULL,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL
    );
  `);

  db.prepare(`INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, ?)`).run(new Date().toISOString());
}

export interface RecoverableReviewJob {
  reviewId: string;
  model: string;
  policyDocumentId: string;
  targetDocumentId: string;
}

/**
 * 서버가 죽은 직후 재시작한 경우에만 검토를 이어서 실행합니다.
 * 오래 전에 중단된 검토까지 되살리면 사용자가 이미 잊은 작업이 동시 실행 슬롯을 차지해
 * 새로 누른 검토가 기약 없이 'queued' 상태로 대기하게 됩니다.
 */
const resumeWindowMs = 10 * 60 * 1000;

export function recoverInterruptedReviews(): RecoverableReviewJob[] {
  const interrupted = db.prepare(`
    SELECT id AS review_id, model, policy_document_id, target_document_id, updated_at
    FROM reviews
    WHERE status IN ('queued', 'parsing', 'analyzing', 'merging')
    ORDER BY created_at
  `).all() as Array<{
    review_id: string;
    model: string;
    policy_document_id: string;
    target_document_id: string;
    updated_at: string;
  }>;
  if (interrupted.length === 0) return [];

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const resumable = interrupted.filter((row) => {
    const updatedAt = Date.parse(row.updated_at);
    return Number.isFinite(updatedAt) && now - updatedAt <= resumeWindowMs;
  });
  const resumableIds = new Set(resumable.map((row) => row.review_id));

  const markResumed = db.prepare(`
    UPDATE reviews SET status='queued', progress=0, processed_clauses=0, total_clauses=0,
      error_code=NULL, error_message=NULL, updated_at=? WHERE id=?
  `);
  const markStale = db.prepare(`
    UPDATE reviews SET status='failed', error_code='SERVER_RESTARTED',
      error_message='서버가 재시작되어 검토가 중단되었습니다. 다시 실행해 주세요.', updated_at=? WHERE id=?
  `);
  for (const row of interrupted) {
    if (resumableIds.has(row.review_id)) markResumed.run(nowIso, row.review_id);
    else markStale.run(nowIso, row.review_id);
  }

  return resumable.map((row) => ({
    reviewId: row.review_id,
    model: row.model,
    policyDocumentId: row.policy_document_id,
    targetDocumentId: row.target_document_id
  }));
}

export function closeDatabase(): void {
  db.close();
}
