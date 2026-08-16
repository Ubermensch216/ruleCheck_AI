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
  properties: {
    status: { type: 'string', enum: ['적합', '일부 보완 필요', '충돌 가능성', '확인 불가'] },
    severity: { type: 'string', enum: ['Critical', 'High', 'Medium', 'Low'] },
    reason: { type: 'string' },
    remediation: { type: 'string' },
    policyEvidence: { type: 'array', items: { type: 'object', properties: { excerpt: { type: 'string' } }, required: ['excerpt'] } },
    targetEvidence: { type: 'array', items: { type: 'object', properties: { excerpt: { type: 'string' } }, required: ['excerpt'] } },
    confidence: { type: 'number' },
    missingInformation: { type: 'array', items: { type: 'string' } }
  },
  required: ['status', 'severity', 'reason', 'remediation', 'policyEvidence', 'targetEvidence', 'confidence', 'missingInformation']
};

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
  const validated = rawFindingSchema.safeParse(parsed);
  if (!validated.success) {
    throw new AppError('LLM_SCHEMA_INVALID', '모델 응답이 검토 결과 스키마와 일치하지 않습니다.', 502, validated.error.issues);
  }
  return validated.data;
}
