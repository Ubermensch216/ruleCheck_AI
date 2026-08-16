import type { ParsedDocument } from '../../shared/schemas.js';
import { AppError } from '../errors.js';
import { parseDocx } from './docxParser.js';
import { parseHwpx } from './hwpxParser.js';
import { parsePdf } from './pdfParser.js';
import { parseText } from './textParser.js';
import { parseXlsx } from './xlsxParser.js';

export async function parseDocument(buffer: Buffer, filename: string, mimeType: string, extension: string): Promise<ParsedDocument> {
  switch (extension) {
    case '.pdf': return parsePdf(buffer, filename, mimeType);
    case '.docx': return parseDocx(buffer, filename, mimeType);
    case '.hwpx': return parseHwpx(buffer, filename, mimeType);
    case '.xlsx': return parseXlsx(buffer, filename, mimeType);
    case '.txt': case '.md': case '.csv': return parseText(buffer, filename, mimeType);
    default: throw new AppError('UNSUPPORTED_FILE_TYPE', `지원하지 않는 파일 형식입니다: ${extension}`, 415);
  }
}
