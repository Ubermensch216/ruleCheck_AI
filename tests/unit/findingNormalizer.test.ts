import { describe, expect, it } from 'vitest';
import { normalizeFindingSemantics } from '../../server/compliance/findingNormalizer.js';

const base = {
  status: '적합' as const, severity: 'Critical' as const, reason: '두 조항은 상충되므로 위반 가능성이 있습니다.',
  remediation: '조항을 수정합니다.', policyEvidence: [{ excerpt: '기준' }], targetEvidence: [{ excerpt: '대상' }],
  confidence: 1, missingInformation: []
};

describe('finding semantic normalization', () => {
  it('converts a contradictory pass result into a human-reviewed conflict', () => {
    const result = normalizeFindingSemantics(base);
    expect(result.status).toBe('충돌 가능성');
    expect(result.requiresHumanReview).toBe(true);
  });

  it('forces a genuine compliant result to low severity', () => {
    const result = normalizeFindingSemantics({ ...base, reason: '기준과 동일하게 규정하고 있습니다.' });
    expect(result.status).toBe('적합');
    expect(result.severity).toBe('Low');
  });
});
