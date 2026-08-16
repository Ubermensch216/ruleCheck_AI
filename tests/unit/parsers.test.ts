import { describe, expect, it } from 'vitest';
import { parseText } from '../../server/parsers/textParser.js';
import { safeFilename, validateUpload } from '../../server/security/uploadPolicy.js';

describe('text parser and upload policy', () => {
  it('normalizes UTF-8 BOM and Windows line endings', () => {
    const parsed = parseText(Buffer.from('\uFEFF제1조\r\n내용입니다.'), 'policy.txt', 'text/plain');
    expect(parsed.fullText).toBe('제1조\n내용입니다.');
    expect(parsed.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('sanitizes a path-like filename', () => {
    expect(safeFilename('../../규정?.txt')).toBe('규정_.txt');
  });

  it('rejects an unsupported extension', async () => {
    await expect(validateUpload('malware.exe', Buffer.from('x'))).rejects.toThrow(/지원하지 않는/);
  });
});
