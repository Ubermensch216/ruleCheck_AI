import { XMLParser } from 'fast-xml-parser';
import type { DocumentBlock, ParsedDocument } from '../../shared/schemas.js';
import { AppError } from '../errors.js';
import { finalizeParsed, loadSafeZip, normalizeText } from './common.js';

const xmlParser = new XMLParser({ ignoreAttributes: false, preserveOrder: true, processEntities: true });

function collectText(nodes: unknown): string {
  if (!Array.isArray(nodes)) return '';
  let result = '';
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === 'hp:t' || key === 't') {
        if (Array.isArray(value)) {
          for (const item of value) {
            if (item && typeof item === 'object' && '#text' in item) result += String((item as any)['#text'] ?? '');
          }
        } else if (typeof value === 'string') result += value;
      } else if (Array.isArray(value)) {
        const child = collectText(value);
        if (child) result += child + (key === 'hp:p' || key === 'p' ? '\n' : '');
      }
    }
  }
  return result;
}

export async function parseHwpx(buffer: Buffer, filename: string, mimeType: string): Promise<ParsedDocument> {
  const zip = await loadSafeZip(buffer);
  const sectionNames = Object.keys(zip.files)
    .filter((name) => /^Contents\/section\d+\.xml$/i.test(name))
    .sort((a, b) => Number(a.match(/section(\d+)/i)?.[1] ?? 0) - Number(b.match(/section(\d+)/i)?.[1] ?? 0));
  if (sectionNames.length === 0) throw new AppError('HWPX_STRUCTURE_INVALID', 'HWPX 본문 section을 찾을 수 없습니다.', 422);
  let fullText = '';
  const blocks: DocumentBlock[] = [];
  for (let index = 0; index < sectionNames.length; index += 1) {
    const xml = await zip.file(sectionNames[index])!.async('string');
    const text = normalizeText(collectText(xmlParser.parse(xml)));
    if (!text) continue;
    if (fullText) fullText += '\n\n';
    const startOffset = fullText.length;
    fullText += text;
    blocks.push({ id: `section_${index + 1}`, type: 'paragraph', text, startOffset, endOffset: fullText.length });
  }
  return finalizeParsed({ filename, mimeType, parserVersion: 'hwpx-1', fullText, blocks, warnings: [] }, buffer);
}
