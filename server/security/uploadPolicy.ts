import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { AppError } from '../errors.js';

export const supportedExtensions = new Set(['.pdf', '.docx', '.hwpx', '.xlsx', '.txt', '.md', '.csv']);

const expectedMagic = new Map<string, Set<string>>([
  ['.pdf', new Set(['application/pdf'])],
  ['.docx', new Set(['application/zip', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])],
  ['.hwpx', new Set(['application/zip'])],
  ['.xlsx', new Set(['application/zip', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])]
]);

export function safeFilename(filename: string): string {
  const base = path.basename(filename).normalize('NFKC');
  const cleaned = base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 180) || 'document';
}

export async function validateUpload(filename: string, buffer: Buffer): Promise<{ extension: string; mimeType: string }> {
  const extension = path.extname(filename).toLowerCase();
  if (!supportedExtensions.has(extension)) {
    throw new AppError('UNSUPPORTED_FILE_TYPE', `지원하지 않는 파일 형식입니다: ${extension || '확장자 없음'}`, 415);
  }
  const detected = await fileTypeFromBuffer(buffer);
  const expected = expectedMagic.get(extension);
  if (expected && (!detected || !expected.has(detected.mime))) {
    throw new AppError('FILE_SIGNATURE_MISMATCH', '파일 확장자와 실제 파일 형식이 일치하지 않습니다.', 415);
  }
  if (!expected && detected && detected.mime !== 'text/plain' && detected.mime !== 'text/csv') {
    throw new AppError('FILE_SIGNATURE_MISMATCH', '텍스트 문서로 인식할 수 없는 파일입니다.', 415);
  }
  return { extension, mimeType: detected?.mime ?? mimeForExtension(extension) };
}

function mimeForExtension(extension: string): string {
  return ({
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.hwpx': 'application/hwpx+zip',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.csv': 'text/csv',
    '.md': 'text/markdown',
    '.txt': 'text/plain'
  } as Record<string, string>)[extension] ?? 'application/octet-stream';
}
