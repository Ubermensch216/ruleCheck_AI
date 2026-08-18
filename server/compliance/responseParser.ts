import { jsonrepair } from 'jsonrepair';
import { z } from 'zod';
import { grcStatusSchema, severitySchema } from '../../shared/schemas.js';
import { AppError } from '../errors.js';

export const rawFindingSchema = z.object({
  status: grcStatusSchema,
  severity: severitySchema,
  reason: z.string().min(1),
  remediation: z.string().min(1),
  policyEvidence: z.array(z.object({ excerpt: z.string().min(1) })).min(1),
  targetEvidence: z.array(z.object({ excerpt: z.string().min(1) })),
  confidence: z.number().min(0).max(1),
  missingInformation: z.array(z.string()).default([])
});

export type RawFinding = z.infer<typeof rawFindingSchema>;

export const findingJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['적합', '일부 보완 필요', '충돌 가능성', '확인 불가'] },
    severity: { type: 'string', enum: ['Critical', 'High', 'Medium', 'Low'] },
    reason: { type: 'string', minLength: 1 },
    remediation: { type: 'string', minLength: 1 },
    policyEvidence: {
      type: 'array', minItems: 1,
      items: { type: 'object', additionalProperties: false, properties: { excerpt: { type: 'string', minLength: 1 } }, required: ['excerpt'] }
    },
    targetEvidence: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, properties: { excerpt: { type: 'string', minLength: 1 } }, required: ['excerpt'] }
    },
    confidence: { type: 'number', minimum: 0, maximum: 1, description: '0부터 1 사이의 신뢰도. 백분율이 아님.' },
    missingInformation: { type: 'array', items: { type: 'string' } }
  },
  required: ['status', 'severity', 'reason', 'remediation', 'policyEvidence', 'targetEvidence', 'confidence', 'missingInformation']
};

function normalizeEvidence(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item) => typeof item === 'string' ? { excerpt: item } : item);
}

function normalizeConfidence(value: unknown): unknown {
  let numeric = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    numeric = trimmed.endsWith('%') ? Number(trimmed.slice(0, -1)) : Number(trimmed);
  }
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) return value;
  return numeric > 1 && numeric <= 100 ? numeric / 100 : numeric;
}

function normalizeStringArray(value: unknown): unknown {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') return value.trim() ? [value] : [];
  return value;
}

function normalizeRawFinding(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const raw = value as Record<string, unknown>;
  const severity = typeof raw.severity === 'string'
    ? ({ critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' } as Record<string, string>)[raw.severity.trim().toLowerCase()] ?? raw.severity.trim()
    : raw.severity;
  return {
    ...raw,
    status: typeof raw.status === 'string' ? raw.status.trim() : raw.status,
    severity,
    policyEvidence: normalizeEvidence(raw.policyEvidence),
    targetEvidence: normalizeEvidence(raw.targetEvidence ?? []),
    confidence: normalizeConfidence(raw.confidence),
    missingInformation: normalizeStringArray(raw.missingInformation)
  };
}

export function schemaIssueHint(details: unknown): string {
  if (!Array.isArray(details)) return '필수 필드와 자료형을 JSON 스키마에 정확히 맞추십시오.';
  const hints = details.slice(0, 6).map((issue) => {
    const record = issue && typeof issue === 'object' ? issue as Record<string, unknown> : {};
    const path = Array.isArray(record.path) && record.path.length ? record.path.join('.') : '응답 전체';
    const message = typeof record.message === 'string' ? record.message : '값이 올바르지 않습니다.';
    return `${path}: ${message}`;
  });
  return hints.length ? hints.join('; ') : '필수 필드와 자료형을 JSON 스키마에 정확히 맞추십시오.';
}

export function parseLlmJson(content: string): RawFinding {
  const stripped = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const first = stripped.indexOf('{');
  const last = stripped.lastIndexOf('}');
  const candidate = first >= 0 && last >= first ? stripped.slice(first, last + 1) : stripped;
  let parsed: unknown;
  try { parsed = JSON.parse(candidate); }
  catch {
    try { parsed = JSON.parse(jsonrepair(candidate)); }
    catch { throw new AppError('LLM_JSON_INVALID', '모델 응답을 JSON으로 해석하지 못했습니다.', 502); }
  }
  const validated = rawFindingSchema.safeParse(normalizeRawFinding(parsed));
  if (!validated.success) {
    throw new AppError('LLM_SCHEMA_INVALID', '모델 응답이 검토 결과 스키마와 일치하지 않습니다.', 502, validated.error.issues);
  }
  return validated.data;
}
