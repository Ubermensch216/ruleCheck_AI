import { describe, expect, it } from 'vitest';
import { validateEvidence } from '../../server/compliance/evidenceValidator.js';
import { calculateRisk } from '../../server/compliance/riskCalculator.js';
import type { DocumentClause, Finding } from '../../shared/schemas.js';

const clause: DocumentClause = {
  id: 'clause_1', documentId: 'doc_1', sequence: 0, title: '제1조', text: '자료는 국내에 보관한다.',
  startOffset: 5, endOffset: 19
};

function finding(status: Finding['status'], severity: Finding['severity']): Finding {
  return { id: 'f', ruleTitle: '규정', status, severity, reason: '이유', remediation: '조치',
    policyEvidence: [], targetEvidence: [], confidence: 1, requiresHumanReview: false };
}

describe('evidence validation and risk', () => {
  it('only accepts exact excerpts from a candidate clause', () => {
    const fullText = '서문\n\n자료는 국내에 보관한다.';
    expect(validateEvidence({ excerpts: ['국내에 보관한다.'], clauses: [clause], documentId: 'doc_1', kind: 'policy', fullText })).toHaveLength(1);
    expect(validateEvidence({ excerpts: ['해외에 보관한다.'], clauses: [clause], documentId: 'doc_1', kind: 'policy', fullText })).toHaveLength(0);
  });

  it('calculates deterministic overall risk', () => {
    expect(calculateRisk([finding('충돌 가능성', 'Critical')], 1)).toBe('High');
    expect(calculateRisk([finding('일부 보완 필요', 'Medium')], 1)).toBe('Medium');
    expect(calculateRisk([finding('적합', 'Low')], 1)).toBe('Low');
  });
});
