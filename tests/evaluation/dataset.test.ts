import { describe, expect, it } from 'vitest';
import { evaluationCases } from './cases.js';

describe('RuleLens AI evaluation dataset', () => {
  it('contains the required labeled coverage', () => {
    expect(evaluationCases).toHaveLength(20);
    expect(new Set(evaluationCases.map((item) => item.id)).size).toBe(evaluationCases.length);
    for (const category of ['conflict', 'remediation', 'compliant', 'unknown', 'adversarial']) {
      expect(evaluationCases.some((item) => item.category === category)).toBe(true);
    }
  });

  it('labels every seeded critical conflict as conflict', () => {
    expect(evaluationCases.filter((item) => item.critical).every((item) => item.expectedStatus === '충돌 가능성')).toBe(true);
  });
});
