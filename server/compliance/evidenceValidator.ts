import type { DocumentClause, DocumentKind, EvidenceRef } from '../../shared/schemas.js';

/**
 * 모델이 인용한 excerpt를 원문에서 찾습니다.
 * 공백과 줄바꿈만 다른 경우는 같은 문장으로 보되, 글자가 다르면 인정하지 않습니다.
 * 반환값은 원문 기준의 정확한 오프셋과 원문 그대로의 텍스트입니다.
 */
function locate(haystack: string, needle: string): { start: number; end: number } | undefined {
  const exact = haystack.indexOf(needle);
  if (exact >= 0) return { start: exact, end: exact + needle.length };

  // 공백을 제거한 위치 대응표를 만들어 원문 오프셋으로 되돌립니다.
  const positions: number[] = [];
  let compact = '';
  for (let index = 0; index < haystack.length; index += 1) {
    if (!/\s/.test(haystack[index])) {
      compact += haystack[index];
      positions.push(index);
    }
  }
  const compactNeedle = needle.replace(/\s+/g, '');
  if (!compactNeedle) return undefined;
  const found = compact.indexOf(compactNeedle);
  if (found < 0) return undefined;
  return { start: positions[found], end: positions[found + compactNeedle.length - 1] + 1 };
}

export function validateEvidence(input: {
  excerpts: string[];
  clauses: DocumentClause[];
  documentId: string;
  kind: DocumentKind;
  fullText: string;
}): EvidenceRef[] {
  const results: EvidenceRef[] = [];
  for (const rawExcerpt of input.excerpts) {
    const excerpt = rawExcerpt.trim();
    if (!excerpt) continue;
    let clause: DocumentClause | undefined;
    let local: { start: number; end: number } | undefined;
    for (const candidate of input.clauses) {
      const hit = locate(candidate.text, excerpt);
      if (hit) { clause = candidate; local = hit; break; }
    }
    if (!clause || !local) continue;
    // clause 오프셋은 몇 글자 어긋날 수 있으므로 원문에서 다시 정확한 위치를 찾습니다.
    const approx = clause.startOffset + local.start;
    const windowStart = Math.max(0, approx - 32);
    const window = input.fullText.slice(windowStart, approx + (local.end - local.start) + 32);
    const anchored = locate(window, excerpt);
    if (!anchored) continue;
    const startOffset = windowStart + anchored.start;
    const endOffset = windowStart + anchored.end;
    // 인용문은 모델이 쓴 문장이 아니라 원문 그대로를 저장합니다.
    const verbatim = input.fullText.slice(startOffset, endOffset);
    if (!verbatim) continue;
    results.push({
      documentId: input.documentId,
      documentKind: input.kind,
      clauseId: clause.id,
      clauseTitle: clause.title,
      page: clause.pageStart,
      excerpt: verbatim,
      startOffset,
      endOffset
    });
  }
  return results;
}
