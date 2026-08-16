import ExcelJS from 'exceljs';
import type { DocumentBlock, ParsedDocument } from '../../shared/schemas.js';
import { AppError } from '../errors.js';
import { finalizeParsed, loadSafeZip, normalizeText } from './common.js';

export async function parseXlsx(buffer: Buffer, filename: string, mimeType: string): Promise<ParsedDocument> {
  await loadSafeZip(buffer);
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(buffer).buffer);
    let fullText = '';
    const blocks: DocumentBlock[] = [];
    const warnings: string[] = [];
    workbook.worksheets.forEach((sheet, index) => {
      const rows: string[] = [];
      sheet.eachRow({ includeEmpty: false }, (row) => {
        const values: string[] = [];
        row.eachCell({ includeEmpty: false }, (cell) => {
          const value = cell.text.trim();
          if (value) values.push(`${cell.address}: ${value}`);
        });
        if (values.length) rows.push(values.join(' | '));
      });
      const text = normalizeText(`[시트: ${sheet.name}]\n${rows.join('\n')}`);
      if (fullText) fullText += '\n\n';
      const startOffset = fullText.length;
      fullText += text;
      blocks.push({ id: `sheet_${index + 1}`, type: 'sheet', title: sheet.name, text, startOffset, endOffset: fullText.length });
      if (sheet.state !== 'visible') warnings.push(`숨김 시트 '${sheet.name}'도 검토 대상에 포함했습니다.`);
    });
    return finalizeParsed({ filename, mimeType, parserVersion: 'xlsx-1', fullText, blocks, warnings }, buffer);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('XLSX_PARSE_FAILED', 'XLSX 문서를 해석하지 못했습니다.', 422);
  }
}
