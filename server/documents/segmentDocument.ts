import { randomUUID } from 'node:crypto';
import type { DocumentBlock, DocumentClause } from '../../shared/schemas.js';

const headingPattern = /^(?:#{1,6}\s+.+|제\s*\d+\s*조(?:의\s*\d+)?(?:\s*\([^)]*\))?.*|\d+(?:\.\d+)*[.)]\s+.+|[가-하][.)]\s+.+|[①-⑳]\s*.+)$/;
const maxClauseChars = 8_000;

function pageAt(blocks: DocumentBlock[], offset: number): number | undefined {
  return blocks.find((block) => block.startOffset <= offset && block.endOffset >= offset)?.page;
}

export function segmentDocument(documentId: string, fullText: string, blocks: DocumentBlock[]): DocumentClause[] {
  const paragraphs = fullText.split(/\n{2,}/).map((text) => text.trim()).filter(Boolean);
  const sections: Array<{ title: string; text: string; startOffset: number; endOffset: number }> = [];
  let cursor = 0;
  let current: typeof sections[number] | undefined;

  for (const paragraph of paragraphs) {
    const start = fullText.indexOf(paragraph, cursor);
    const end = start + paragraph.length;
    const firstLine = paragraph.split('\n', 1)[0].trim();
    if (headingPattern.test(firstLine) || !current) {
      if (current) sections.push(current);
      current = { title: headingPattern.test(firstLine) ? firstLine.slice(0, 200) : `문서 구간 ${sections.length + 1}`, text: paragraph, startOffset: start, endOffset: end };
    } else if (current.text.length + paragraph.length + 2 <= maxClauseChars) {
      current.text += `\n\n${paragraph}`;
      current.endOffset = end;
    } else {
      sections.push(current);
      current = { title: `${current.title} (계속 ${sections.length + 1})`, text: paragraph, startOffset: start, endOffset: end };
    }
    cursor = end;
  }
  if (current) sections.push(current);
  if (sections.length === 0 && fullText) sections.push({ title: '문서 전체', text: fullText, startOffset: 0, endOffset: fullText.length });

  return sections.map((section, sequence) => ({
    id: `clause_${randomUUID()}`,
    documentId,
    sequence,
    title: section.title,
    text: section.text,
    pageStart: pageAt(blocks, section.startOffset),
    pageEnd: pageAt(blocks, Math.max(section.startOffset, section.endOffset - 1)),
    startOffset: section.startOffset,
    endOffset: section.endOffset
  }));
}
