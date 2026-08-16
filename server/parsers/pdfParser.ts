import pdfParse from 'pdf-parse';
import type { DocumentBlock, ParsedDocument } from '../../shared/schemas.js';
import { AppError } from '../errors.js';
import { finalizeParsed, normalizeText } from './common.js';

export async function parsePdf(buffer: Buffer, filename: string, mimeType: string): Promise<ParsedDocument> {
  const pageTexts: string[] = [];
  try {
    const parsed = await pdfParse(buffer, {
      pagerender: async (pageData: any) => {
        const content = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
        const text = content.items.map((item: any) => item.str ?? '').join(' ');
        pageTexts.push(normalizeText(text));
        return text;
      }
    });
    const warnings: string[] = [];
    if (parsed.numpages > 0 && parsed.text.trim().length / parsed.numpages < 30) {
      throw new AppError('OCR_REQUIRED', '텍스트가 거의 없는 스캔 PDF입니다. OCR 처리 후 다시 업로드해 주세요.', 422);
    }
    let fullText = '';
    const blocks: DocumentBlock[] = [];
    const pages = pageTexts.length > 0 ? pageTexts : [normalizeText(parsed.text)];
    pages.forEach((text, index) => {
      if (!text) return;
      if (fullText) fullText += '\n\n';
      const startOffset = fullText.length;
      fullText += text;
      blocks.push({
        id: `page_${index + 1}`, type: 'paragraph', page: index + 1, text,
        startOffset, endOffset: fullText.length
      });
    });
    return finalizeParsed({ filename, mimeType, pageCount: parsed.numpages, parserVersion: 'pdf-1', fullText, blocks, warnings }, buffer);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('PDF_PARSE_FAILED', 'PDF 문서를 해석하지 못했습니다. 암호화 또는 손상 여부를 확인해 주세요.', 422);
  }
}
