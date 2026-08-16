import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import PDFDocument from 'pdfkit';
import { describe, expect, it } from 'vitest';
import { parseDocx } from '../../server/parsers/docxParser.js';
import { parseHwpx } from '../../server/parsers/hwpxParser.js';
import { parsePdf } from '../../server/parsers/pdfParser.js';
import { parseXlsx } from '../../server/parsers/xlsxParser.js';

async function pdfBuffer(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const document = new PDFDocument({ size: 'A4' });
    document.on('data', (chunk) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
    document.text('Policy text content for parser verification.');
    document.end();
  });
}

describe('office document parsers', () => {
  it('parses a text PDF with page metadata', async () => {
    const parsed = await parsePdf(await pdfBuffer(), 'policy.pdf', 'application/pdf');
    expect(parsed.pageCount).toBe(1);
    expect(parsed.fullText).toContain('Policy text content');
    expect(parsed.blocks[0].page).toBe(1);
  });

  it('parses a minimal DOCX paragraph', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
    zip.file('_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
    zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>내부 규정 본문</w:t></w:r></w:p></w:body></w:document>`);
    const parsed = await parseDocx(await zip.generateAsync({ type: 'nodebuffer' }), 'policy.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(parsed.fullText).toContain('내부 규정 본문');
  });

  it('sorts HWPX sections by numeric order', async () => {
    const zip = new JSZip();
    zip.file('Contents/section10.xml', `<hp:section xmlns:hp="urn:hancom"><hp:p><hp:run><hp:t>열 번째</hp:t></hp:run></hp:p></hp:section>`);
    zip.file('Contents/section2.xml', `<hp:section xmlns:hp="urn:hancom"><hp:p><hp:run><hp:t>두 번째</hp:t></hp:run></hp:p></hp:section>`);
    const parsed = await parseHwpx(await zip.generateAsync({ type: 'nodebuffer' }), 'policy.hwpx', 'application/hwpx+zip');
    expect(parsed.fullText.indexOf('두 번째')).toBeLessThan(parsed.fullText.indexOf('열 번째'));
  });

  it('extracts XLSX cell addresses and hidden-sheet warnings', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('규정표');
    sheet.getCell('A1').value = '보관 위치';
    sheet.getCell('B1').value = '국내';
    sheet.state = 'hidden';
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const parsed = await parseXlsx(buffer, 'policy.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(parsed.fullText).toContain('A1: 보관 위치');
    expect(parsed.fullText).toContain('B1: 국내');
    expect(parsed.warnings[0]).toContain('숨김 시트');
  });
});
