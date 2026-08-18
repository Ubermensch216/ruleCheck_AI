import { describe, expect, it } from 'vitest';
import { validateEvidence } from '../../server/compliance/evidenceValidator.js';
import type { DocumentClause } from '../../shared/schemas.js';

const fullText = '서문\n\n자료는 국내에 보관한다.';
const clause: DocumentClause = {
  id: 'c1', documentId: 'd1', sequence: 0, title: '제1조',
  text: '자료는 국내에 보관한다.', startOffset: 5, endOffset: 19
};

function call(excerpt: string) {
  return validateEvidence({ excerpts: [excerpt], clauses: [clause], documentId: 'd1', kind: 'policy', fullText });
}

describe('evidence anchoring', () => {
  it('anchors the excerpt to its true offset in the full text', () => {
    const [ref] = call('국내에 보관한다.');
    expect(fullText.slice(ref.startOffset, ref.endOffset)).toBe('국내에 보관한다.');
  });

  it('accepts whitespace-only differences and stores the original wording', () => {
    const [ref] = call('국내에   보관한다.');
    expect(ref.excerpt).toBe('국내에 보관한다.');
    expect(fullText.slice(ref.startOffset, ref.endOffset)).toBe('국내에 보관한다.');
  });

  it('still rejects an excerpt that is not in the document', () => {
    expect(call('해외에 보관한다.')).toHaveLength(0);
  });
});
