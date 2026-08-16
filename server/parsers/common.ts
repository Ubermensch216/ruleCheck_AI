import { createHash, randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import type { DocumentBlock, ParsedDocument } from '../../shared/schemas.js';
import { env } from '../config/env.js';
import { AppError } from '../errors.js';

export function normalizeText(value: string): string {
  return value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n').trim();
}

export function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function blocksFromParagraphs(text: string, page?: number): DocumentBlock[] {
  const normalized = normalizeText(text);
  const chunks = normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const blocks: DocumentBlock[] = [];
  let cursor = 0;
  for (const chunk of chunks) {
    const start = normalized.indexOf(chunk, cursor);
    const end = start + chunk.length;
    const heading = /^(#{1,6}\s+|제\s*\d+\s*조(?:의\s*\d+)?|\d+(?:\.\d+)*[.)]\s+)/.test(chunk);
    blocks.push({ id: `block_${randomUUID()}`, type: heading ? 'heading' : 'paragraph', page, text: chunk, startOffset: start, endOffset: end });
    cursor = end;
  }
  if (blocks.length === 0 && normalized) {
    blocks.push({ id: `block_${randomUUID()}`, type: 'paragraph', page, text: normalized, startOffset: 0, endOffset: normalized.length });
  }
  return blocks;
}

export async function loadSafeZip(buffer: Buffer): Promise<JSZip> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(buffer, { checkCRC32: true }); }
  catch { throw new AppError('CORRUPT_ARCHIVE', '압축 문서가 손상되었거나 암호화되어 있습니다.', 422); }
  const entries = Object.values(zip.files);
  if (entries.length > env.MAX_ZIP_ENTRIES) throw new AppError('ZIP_ENTRY_LIMIT', '압축 문서의 항목 수가 제한을 초과했습니다.', 413);
  let estimated = 0;
  for (const entry of entries) {
    const data = (entry as any)._data;
    estimated += Number(data?.uncompressedSize ?? 0);
    if (estimated > env.MAX_ZIP_UNCOMPRESSED_BYTES) {
      throw new AppError('ZIP_SIZE_LIMIT', '압축 해제 크기가 제한을 초과했습니다.', 413);
    }
  }
  return zip;
}

export function finalizeParsed(input: Omit<ParsedDocument, 'sha256' | 'charCount'>, buffer: Buffer): ParsedDocument {
  const fullText = normalizeText(input.fullText);
  if (!fullText) throw new AppError('EMPTY_DOCUMENT', '문서에서 텍스트를 추출하지 못했습니다.', 422);
  if (fullText.length > env.MAX_EXTRACTED_CHARS) throw new AppError('EXTRACTED_TEXT_LIMIT', '추출된 텍스트가 허용된 크기를 초과했습니다.', 413);
  return { ...input, fullText, sha256: hashBuffer(buffer), charCount: fullText.length };
}
