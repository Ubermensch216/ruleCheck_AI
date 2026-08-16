import type { GrcStatus, Severity } from '../../shared/schemas.js';
import type { RawFinding } from './responseParser.js';

export function normalizeFindingSemantics(raw: RawFinding): {
  status: GrcStatus;
  severity: Severity;
  requiresHumanReview: boolean;
  reason: string;
} {
  let status = raw.status;
  let severity = raw.severity;
  let requiresHumanReview = raw.status === '확인 불가' || raw.confidence < 0.7;
  let reason = raw.reason;
  const conflictLanguage = /충돌|상충|위반|불일치|부적합/.test(raw.reason);

  if (status === '적합' && conflictLanguage) {
    status = '충돌 가능성';
    requiresHumanReview = true;
    reason += ' 모델의 상태와 설명이 불일치하여 충돌 가능성으로 보수적으로 정규화했습니다.';
  }
  if (status === '적합') severity = 'Low';
  if (status === '충돌 가능성' && severity === 'Low') severity = 'Medium';
  if (status === '확인 불가') requiresHumanReview = true;
  return { status, severity, requiresHumanReview, reason };
}
