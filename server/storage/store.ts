import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type {
  DocumentClause,
  DocumentKind,
  DocumentSummary,
  EvidenceRef,
  Finding,
  OverallRisk,
  ParsedDocument,
  ReviewResult,
  ReviewStatus,
  ReviewSummary
} from '../../shared/schemas.js';
import { db } from './database.js';
import { AppError } from '../errors.js';

type Row = Record<string, any>;

function parseJson<T>(value: unknown, fallback: T): T {
  try { return typeof value === 'string' ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}

function mapDocument(row: Row): DocumentSummary {
  return {
    id: row.id,
    kind: row.kind,
    filename: row.original_name,
    mimeType: row.mime_type,
    sha256: row.sha256,
    sizeBytes: row.size_bytes,
    charCount: row.char_count,
    pageCount: row.page_count ?? undefined,
    parserVersion: row.parser_version,
    warnings: parseJson(row.warnings_json, []),
    status: row.status,
    createdAt: row.created_at
  };
}

function mapReview(row: Row): ReviewSummary {
  return {
    id: row.id,
    title: row.title,
    policyDocumentId: row.policy_document_id,
    targetDocumentId: row.target_document_id,
    policyDocName: row.policy_doc_name,
    targetDocName: row.target_doc_name,
    model: row.model,
    status: row.status,
    progress: row.progress,
    processedClauses: row.processed_clauses,
    totalClauses: row.total_clauses,
    overallRisk: row.overall_risk ?? undefined,
    summary: row.summary ?? undefined,
    draftOpinion: row.draft_opinion ?? undefined,
    missingInformation: parseJson(row.missing_information_json, []),
    coverageRate: row.coverage_rate ?? undefined,
    errorCode: row.error_code ?? undefined,
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined
  };
}

export function insertDocument(input: {
  id: string;
  kind: DocumentKind;
  sizeBytes: number;
  storagePath: string;
  parsed: ParsedDocument;
  clauses: DocumentClause[];
}): DocumentSummary {
  const tx = db.transaction(() => {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO documents(id, kind, original_name, mime_type, sha256, size_bytes, char_count,
        page_count, parser_version, full_text, warnings_json, status, storage_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'parsed', ?, ?)
    `).run(
      input.id, input.kind, input.parsed.filename, input.parsed.mimeType, input.parsed.sha256,
      input.sizeBytes, input.parsed.charCount, input.parsed.pageCount ?? null,
      input.parsed.parserVersion, input.parsed.fullText, JSON.stringify(input.parsed.warnings),
      input.storagePath, now
    );
    const insertClause = db.prepare(`
      INSERT INTO document_clauses(id, document_id, sequence, title, text, page_start, page_end,
        start_offset, end_offset, parent_clause_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFts = db.prepare(`INSERT INTO clause_fts(clause_id, document_id, title, text) VALUES (?, ?, ?, ?)`);
    for (const clause of input.clauses) {
      insertClause.run(clause.id, input.id, clause.sequence, clause.title, clause.text,
        clause.pageStart ?? null, clause.pageEnd ?? null, clause.startOffset, clause.endOffset,
        clause.parentClauseId ?? null);
      insertFts.run(clause.id, input.id, clause.title, clause.text);
    }
  });
  tx();
  return getDocument(input.id);
}

export function getDocument(id: string): DocumentSummary {
  const row = db.prepare('SELECT * FROM documents WHERE id=?').get(id) as Row | undefined;
  if (!row) throw new AppError('DOCUMENT_NOT_FOUND', '문서를 찾을 수 없습니다.', 404);
  return mapDocument(row);
}

export function getDocumentInternal(id: string): DocumentSummary & { fullText: string; storagePath: string } {
  const row = db.prepare('SELECT * FROM documents WHERE id=?').get(id) as Row | undefined;
  if (!row) throw new AppError('DOCUMENT_NOT_FOUND', '문서를 찾을 수 없습니다.', 404);
  return { ...mapDocument(row), fullText: row.full_text, storagePath: row.storage_path };
}

export function getClauses(documentId: string): DocumentClause[] {
  return (db.prepare('SELECT * FROM document_clauses WHERE document_id=? ORDER BY sequence').all(documentId) as Row[])
    .map((row) => ({
      id: row.id, documentId: row.document_id, sequence: row.sequence, title: row.title, text: row.text,
      pageStart: row.page_start ?? undefined, pageEnd: row.page_end ?? undefined,
      startOffset: row.start_offset, endOffset: row.end_offset,
      parentClauseId: row.parent_clause_id ?? undefined
    }));
}

export function getClause(id: string): DocumentClause | undefined {
  const row = db.prepare('SELECT * FROM document_clauses WHERE id=?').get(id) as Row | undefined;
  if (!row) return undefined;
  return getClauses(row.document_id).find((clause) => clause.id === id);
}

function queryTerms(text: string): string {
  const tokens = text.normalize('NFKC').match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  const unique = [...new Set(tokens.map((token) => token.replace(/"/g, '')))].slice(0, 12);
  return unique.map((token) => `"${token}"`).join(' OR ');
}

export function searchCandidateClauses(documentId: string, query: string, limit = 5): DocumentClause[] {
  const terms = queryTerms(query);
  if (!terms) return getClauses(documentId).slice(0, limit);
  let rows: Row[] = [];
  try {
    rows = db.prepare(`
      SELECT dc.* FROM clause_fts f JOIN document_clauses dc ON dc.id=f.clause_id
      WHERE clause_fts MATCH ? AND f.document_id=? ORDER BY bm25(clause_fts) LIMIT ?
    `).all(terms, documentId, limit) as Row[];
  } catch {
    rows = [];
  }
  if (rows.length === 0) {
    const tokens = (query.match(/[\p{L}\p{N}]{2,}/gu) ?? []).slice(0, 8);
    return getClauses(documentId)
      .map((clause) => ({ clause, score: tokens.filter((token) => clause.text.includes(token)).length }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => item.clause);
  }
  return rows.map((row) => ({
    id: row.id, documentId: row.document_id, sequence: row.sequence, title: row.title, text: row.text,
    pageStart: row.page_start ?? undefined, pageEnd: row.page_end ?? undefined,
    startOffset: row.start_offset, endOffset: row.end_offset,
    parentClauseId: row.parent_clause_id ?? undefined
  }));
}

export function createReview(input: {
  id: string; title: string; policyDocumentId: string; targetDocumentId: string; model: string;
}): ReviewSummary {
  getDocument(input.policyDocumentId);
  getDocument(input.targetDocumentId);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO reviews(id, title, policy_document_id, target_document_id, model, status,
    created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`)
    .run(input.id, input.title, input.policyDocumentId, input.targetDocumentId, input.model, now, now);
  return getReview(input.id);
}

const reviewSelect = `
  SELECT r.*, p.original_name AS policy_doc_name, t.original_name AS target_doc_name
  FROM reviews r JOIN documents p ON p.id=r.policy_document_id JOIN documents t ON t.id=r.target_document_id
`;

export function listReviews(): ReviewSummary[] {
  return (db.prepare(`${reviewSelect} ORDER BY r.created_at DESC`).all() as Row[]).map(mapReview);
}

export function getReview(id: string): ReviewSummary {
  const row = db.prepare(`${reviewSelect} WHERE r.id=?`).get(id) as Row | undefined;
  if (!row) throw new AppError('REVIEW_NOT_FOUND', '검토를 찾을 수 없습니다.', 404);
  return mapReview(row);
}

export function getFindings(reviewId: string): Finding[] {
  const rows = db.prepare('SELECT * FROM findings WHERE review_id=? ORDER BY rowid').all(reviewId) as Row[];
  const evidenceStmt = db.prepare('SELECT * FROM evidence WHERE finding_id=? ORDER BY id');
  return rows.map((row) => {
    const evidenceRows = evidenceStmt.all(row.id) as Row[];
    const evidence = evidenceRows.map((e): EvidenceRef => ({
      documentId: e.document_id, documentKind: e.document_kind, clauseId: e.clause_id,
      clauseTitle: e.clause_title ?? undefined, page: e.page ?? undefined, excerpt: e.excerpt,
      startOffset: e.start_offset, endOffset: e.end_offset
    }));
    return {
      id: row.id, ruleTitle: row.rule_title, status: row.status, severity: row.severity,
      reason: row.reason, remediation: row.remediation, confidence: row.confidence,
      requiresHumanReview: Boolean(row.requires_human_review),
      policyEvidence: evidence.filter((e) => e.documentKind === 'policy'),
      targetEvidence: evidence.filter((e) => e.documentKind === 'target')
    };
  });
}

export function getReviewResult(id: string): { review: ReviewSummary; findings: Finding[] } {
  return { review: getReview(id), findings: getFindings(id) };
}

export function updateReviewProgress(id: string, status: ReviewStatus, processed: number, total: number): void {
  const progress = total === 0 ? 0 : Math.min(99, Math.round((processed / total) * 90));
  db.prepare(`UPDATE reviews SET status=?, progress=?, processed_clauses=?, total_clauses=?, updated_at=? WHERE id=?`)
    .run(status, progress, processed, total, new Date().toISOString(), id);
}

export function completeReview(id: string, result: ReviewResult): void {
  const tx = db.transaction(() => {
    const now = new Date().toISOString();
    db.prepare(`UPDATE reviews SET status='completed', progress=100, overall_risk=?, summary=?,
      draft_opinion=?, missing_information_json=?, coverage_rate=?, updated_at=?, completed_at=? WHERE id=?`)
      .run(result.overallRisk, result.summary, result.draftOpinion, JSON.stringify(result.missingInformation),
        result.coverageRate, now, now, id);
    const insertFinding = db.prepare(`INSERT INTO findings(id, review_id, rule_title, status, severity,
      reason, remediation, confidence, requires_human_review) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertEvidence = db.prepare(`INSERT INTO evidence(finding_id, document_id, document_kind,
      clause_id, clause_title, page, excerpt, start_offset, end_offset) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const finding of result.findings) {
      insertFinding.run(finding.id, id, finding.ruleTitle, finding.status, finding.severity, finding.reason,
        finding.remediation, finding.confidence, finding.requiresHumanReview ? 1 : 0);
      for (const evidence of [...finding.policyEvidence, ...finding.targetEvidence]) {
        insertEvidence.run(finding.id, evidence.documentId, evidence.documentKind, evidence.clauseId,
          evidence.clauseTitle ?? null, evidence.page ?? null, evidence.excerpt,
          evidence.startOffset, evidence.endOffset);
      }
    }
  });
  tx();
}

export function failReview(id: string, code: string, message: string): void {
  db.prepare(`UPDATE reviews SET status='failed', error_code=?, error_message=?, updated_at=? WHERE id=?`)
    .run(code, message, new Date().toISOString(), id);
}

export function cancelReview(id: string): void {
  db.prepare(`UPDATE reviews SET status='cancelled', error_code=NULL, error_message=NULL, updated_at=? WHERE id=?`)
    .run(new Date().toISOString(), id);
}

export async function deleteReview(id: string): Promise<void> {
  const review = getReview(id);
  db.prepare(`UPDATE reviews SET status='deleting', updated_at=? WHERE id=?`).run(new Date().toISOString(), id);
  const documentIds = [review.policyDocumentId, review.targetDocumentId];
  for (const documentId of documentIds) {
    const usedElsewhere = db.prepare(`SELECT COUNT(*) AS count FROM reviews
      WHERE id<>? AND (policy_document_id=? OR target_document_id=?)`).get(id, documentId, documentId) as { count: number };
    if (usedElsewhere.count === 0) {
      const doc = getDocumentInternal(documentId);
      await fs.rm(doc.storagePath, { recursive: true, force: true });
      db.prepare('DELETE FROM clause_fts WHERE document_id=?').run(documentId);
    }
  }
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM reviews WHERE id=?').run(id);
    for (const documentId of documentIds) {
      const used = db.prepare(`SELECT COUNT(*) AS count FROM reviews
        WHERE policy_document_id=? OR target_document_id=?`).get(documentId, documentId) as { count: number };
      if (used.count === 0) db.prepare('DELETE FROM documents WHERE id=?').run(documentId);
    }
  });
  tx();
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function riskFromFindings(findings: Finding[], coverageRate: number): OverallRisk {
  const critical = findings.some((item) => item.status === '충돌 가능성' && item.severity === 'Critical');
  const highCount = findings.filter((item) => item.status === '충돌 가능성' && item.severity === 'High').length;
  if (critical || highCount >= 2) return 'High';
  const material = findings.some((item) => item.status === '충돌 가능성' || item.status === '일부 보완 필요' ||
    (item.status === '확인 불가' && ['Critical', 'High'].includes(item.severity)));
  return material || coverageRate < 1 ? 'Medium' : 'Low';
}
