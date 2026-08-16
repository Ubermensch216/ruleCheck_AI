import type { DocumentClause, DocumentKind, EvidenceRef } from '../../shared/schemas.js';

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
    const clause = input.clauses.find((candidate) => candidate.text.includes(excerpt));
    if (!clause) continue;
    const localOffset = clause.text.indexOf(excerpt);
    const startOffset = clause.startOffset + localOffset;
    const exactStart = input.fullText.indexOf(excerpt, Math.max(0, startOffset - 4));
    if (exactStart < 0) continue;
    results.push({
      documentId: input.documentId,
      documentKind: input.kind,
      clauseId: clause.id,
      clauseTitle: clause.title,
      page: clause.pageStart,
      excerpt,
      startOffset: exactStart,
      endOffset: exactStart + excerpt.length
    });
  }
  return results;
}
