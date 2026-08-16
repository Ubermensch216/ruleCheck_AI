import { z } from 'zod';

export const documentKindSchema = z.enum(['policy', 'target']);
export const reviewStatusSchema = z.enum([
  'queued', 'parsing', 'analyzing', 'merging', 'completed', 'failed', 'cancelled', 'deleting'
]);
export const grcStatusSchema = z.enum(['적합', '일부 보완 필요', '충돌 가능성', '확인 불가']);
export const severitySchema = z.enum(['Critical', 'High', 'Medium', 'Low']);
export const overallRiskSchema = z.enum(['High', 'Medium', 'Low']);

export const evidenceRefSchema = z.object({
  documentId: z.string(),
  documentKind: documentKindSchema,
  clauseId: z.string(),
  clauseTitle: z.string().optional(),
  page: z.number().int().positive().optional(),
  excerpt: z.string().min(1),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().positive()
});

export const findingSchema = z.object({
  id: z.string(),
  ruleTitle: z.string().min(1),
  status: grcStatusSchema,
  severity: severitySchema,
  reason: z.string(),
  remediation: z.string(),
  policyEvidence: z.array(evidenceRefSchema),
  targetEvidence: z.array(evidenceRefSchema),
  confidence: z.number().min(0).max(1),
  requiresHumanReview: z.boolean()
});

export const reviewResultSchema = z.object({
  summary: z.string(),
  overallRisk: overallRiskSchema,
  coverageRate: z.number().min(0).max(1),
  findings: z.array(findingSchema),
  missingInformation: z.array(z.string()),
  draftOpinion: z.string()
});

export const createReviewSchema = z.object({
  policyDocumentId: z.string().min(1),
  targetDocumentId: z.string().min(1),
  model: z.string().min(1),
  title: z.string().trim().min(1).max(200)
});

export type DocumentKind = z.infer<typeof documentKindSchema>;
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;
export type GrcStatus = z.infer<typeof grcStatusSchema>;
export type Severity = z.infer<typeof severitySchema>;
export type OverallRisk = z.infer<typeof overallRiskSchema>;
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;
export type Finding = z.infer<typeof findingSchema>;
export type ReviewResult = z.infer<typeof reviewResultSchema>;

export interface DocumentBlock {
  id: string;
  type: 'heading' | 'paragraph' | 'table' | 'sheet';
  title?: string;
  page?: number;
  text: string;
  startOffset: number;
  endOffset: number;
}

export interface DocumentClause {
  id: string;
  documentId: string;
  sequence: number;
  title: string;
  text: string;
  pageStart?: number;
  pageEnd?: number;
  startOffset: number;
  endOffset: number;
  parentClauseId?: string;
}

export interface ParsedDocument {
  filename: string;
  mimeType: string;
  sha256: string;
  pageCount?: number;
  charCount: number;
  parserVersion: string;
  fullText: string;
  blocks: DocumentBlock[];
  warnings: string[];
}

export interface DocumentSummary {
  id: string;
  kind: DocumentKind;
  filename: string;
  mimeType: string;
  sha256: string;
  sizeBytes: number;
  charCount: number;
  pageCount?: number;
  parserVersion: string;
  warnings: string[];
  status: 'parsed' | 'failed' | 'deleting';
  createdAt: string;
}

export interface ReviewSummary {
  id: string;
  title: string;
  policyDocumentId: string;
  targetDocumentId: string;
  policyDocName?: string;
  targetDocName?: string;
  model: string;
  status: ReviewStatus;
  progress: number;
  processedClauses: number;
  totalClauses: number;
  overallRisk?: OverallRisk;
  summary?: string;
  draftOpinion?: string;
  missingInformation?: string[];
  coverageRate?: number;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}
