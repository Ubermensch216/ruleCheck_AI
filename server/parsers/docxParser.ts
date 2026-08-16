import mammoth from 'mammoth';
import type { ParsedDocument } from '../../shared/schemas.js';
import { AppError } from '../errors.js';
import { blocksFromParagraphs, finalizeParsed, loadSafeZip } from './common.js';

export async function parseDocx(buffer: Buffer, filename: string, mimeType: string): Promise<ParsedDocument> {
  await loadSafeZip(buffer);
  try {
    const result = await mammoth.extractRawText({ buffer });
    const fullText = result.value;
    const warnings = result.messages.map((message) => message.message).filter(Boolean).slice(0, 20);
    return finalizeParsed({ filename, mimeType, parserVersion: 'docx-1', fullText, blocks: blocksFromParagraphs(fullText), warnings }, buffer);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('DOCX_PARSE_FAILED', 'DOCX 문서를 해석하지 못했습니다.', 422);
  }
}
