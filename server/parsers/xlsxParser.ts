import * as XLSX from 'xlsx';
import type { DocumentBlock, ParsedDocument } from '../../shared/schemas.js';
import { AppError } from '../errors.js';
import { finalizeParsed, loadSafeZip, normalizeText } from './common.js';

export async function parseXlsx(buffer: Buffer, filename: string, mimeType: string): Promise<ParsedDocument> {
  await loadSafeZip(buffer);
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellFormula: false, cellHTML: false, cellText: true });
    let fullText = '';
    const blocks: DocumentBlock[] = [];
    const warnings: string[] = [];
    workbook.SheetNames.forEach((sheetName, index) => {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) return;
      const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, { header: 1, raw: false, defval: '' });
      const body = rows.map((row, rowIndex) => {
        const values = row.map((value, colIndex) => value === '' ? '' : `${XLSX.utils.encode_col(colIndex)}${rowIndex + 1}: ${String(value)}`);
        return values.filter(Boolean).join(' | ');
      }).filter(Boolean).join('\n');
      const text = normalizeText(`[시트: ${sheetName}]\n${body}`);
      if (fullText) fullText += '\n\n';
      const startOffset = fullText.length;
      fullText += text;
      blocks.push({ id: `sheet_${index + 1}`, type: 'sheet', title: sheetName, text, startOffset, endOffset: fullText.length });
      const metadata = workbook.Workbook?.Sheets?.[index];
      if (metadata?.Hidden) warnings.push(`숨김 시트 '${sheetName}'도 검토 대상에 포함했습니다.`);
    });
    return finalizeParsed({ filename, mimeType, parserVersion: 'xlsx-1', fullText, blocks, warnings }, buffer);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('XLSX_PARSE_FAILED', 'XLSX 문서를 해석하지 못했습니다.', 422);
  }
}
