import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { env } from '../config/env.js';

fs.mkdirSync(path.dirname(env.DATABASE_PATH), { recursive: true });

export const db = new Database(env.DATABASE_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

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

export function recoverInterruptedReviews(): void {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE reviews
    SET status='failed', error_code='SERVER_RESTARTED',
        error_message='서버가 재시작되어 진행 중인 검토가 중단되었습니다.', updated_at=?
    WHERE status IN ('queued', 'parsing', 'analyzing', 'merging')
  `).run(now);
}

export function closeDatabase(): void {
  db.close();
}
