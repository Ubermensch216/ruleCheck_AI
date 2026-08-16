import { describe, expect, it } from 'vitest';
import { parseLlmJson } from '../../server/compliance/responseParser.js';

const valid = {
  status: '적합', severity: 'Low', reason: '일치합니다.', remediation: '별도 조치 없음',
  policyEvidence: [{ excerpt: '국내에 보관한다.' }], targetEvidence: [{ excerpt: '서울 리전에 보관한다.' }],
  confidence: 0.9, missingInformation: []
};

describe('parseLlmJson', () => {
  it('accepts JSON wrapped in a markdown fence', () => {
    expect(parseLlmJson(`\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``).status).toBe('적합');
  });

  it('repairs a trailing comma', () => {
    const content = JSON.stringify(valid).replace(/}$/, ',}');
    expect(parseLlmJson(content).confidence).toBe(0.9);
  });

  it('rejects an unknown status', () => {
    expect(() => parseLlmJson(JSON.stringify({ ...valid, status: '통과' }))).toThrow(/스키마/);
  });
});
