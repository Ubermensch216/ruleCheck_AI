import type { ParsedDocument } from '../../shared/schemas.js';
import { AppError } from '../errors.js';
import { blocksFromParagraphs, finalizeParsed } from './common.js';

export function parseText(buffer: Buffer, filename: string, mimeType: string): ParsedDocument {
  const fullText = buffer.toString('utf8');
  const replacementRatio = (fullText.match(/\uFFFD/g) ?? []).length / Math.max(1, fullText.length);
  if (replacementRatio > 0.01) throw new AppError('TEXT_ENCODING_UNSUPPORTED', 'UTF-8 텍스트 문서만 지원합니다.', 422);
  return finalizeParsed({ filename, mimeType, parserVersion: 'text-1', fullText, blocks: blocksFromParagraphs(fullText), warnings: [] }, buffer);
}
