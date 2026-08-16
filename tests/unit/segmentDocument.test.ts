import { describe, expect, it } from 'vitest';
import { segmentDocument } from '../../server/documents/segmentDocument.js';
import { blocksFromParagraphs } from '../../server/parsers/common.js';

describe('segmentDocument', () => {
  it('keeps every Korean policy article in sequence with offsets', () => {
    const text = '제1조 (목적)\n이 규정의 목적을 정한다.\n\n제2조 (보관)\n자료는 국내에 보관한다.\n\n제3조 (삭제)\n계약 종료 후 삭제한다.';
    const clauses = segmentDocument('doc_policy', text, blocksFromParagraphs(text));
    expect(clauses).toHaveLength(3);
    expect(clauses.map((item) => item.title)).toEqual(['제1조 (목적)', '제2조 (보관)', '제3조 (삭제)']);
    for (const clause of clauses) expect(text.slice(clause.startOffset, clause.endOffset)).toBe(clause.text);
  });

  it('falls back to paragraph groups when headings are absent', () => {
    const text = '첫 번째 설명입니다.\n\n두 번째 설명입니다.';
    const clauses = segmentDocument('doc_target', text, blocksFromParagraphs(text));
    expect(clauses.length).toBeGreaterThan(0);
    expect(clauses.map((item) => item.text).join('\n')).toContain('두 번째 설명');
  });
});
