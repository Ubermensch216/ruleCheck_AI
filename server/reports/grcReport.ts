import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import type { Finding, ReviewSummary } from '../../shared/schemas.js';
import { AppError } from '../errors.js';

const colors = {
  ink: '#172033', muted: '#647084', line: '#d9e0ea', accent: '#2563eb',
  high: '#b91c1c', highBg: '#fee2e2', medium: '#92400e', mediumBg: '#fef3c7',
  low: '#166534', lowBg: '#dcfce7', info: '#475569', infoBg: '#f1f5f9'
};

function resolveFont(): string {
  const candidates = [
    process.env.PDF_FONT_PATH,
    path.resolve('server/fonts/NanumGothic.ttf'),
    'C:\\Windows\\Fonts\\malgun.ttf',
    '/usr/share/fonts/truetype/nanum/NanumGothic.ttf'
  ].filter(Boolean) as string[];
  const font = candidates.find((candidate) => fs.existsSync(candidate));
  if (!font) throw new AppError('PDF_FONT_MISSING', 'PDF 생성을 위한 한글 폰트를 찾을 수 없습니다.', 500);
  return font;
}

function riskStyle(risk?: string): { fg: string; bg: string } {
  if (risk === 'High') return { fg: colors.high, bg: colors.highBg };
  if (risk === 'Medium') return { fg: colors.medium, bg: colors.mediumBg };
  return { fg: colors.low, bg: colors.lowBg };
}

function findingStyle(status: string): { fg: string; bg: string } {
  if (status === '충돌 가능성') return { fg: colors.high, bg: colors.highBg };
  if (status === '일부 보완 필요') return { fg: colors.medium, bg: colors.mediumBg };
  if (status === '적합') return { fg: colors.low, bg: colors.lowBg };
  return { fg: colors.info, bg: colors.infoBg };
}

export async function createReviewPdf(review: ReviewSummary, findings: Finding[]): Promise<Buffer> {
  const font = resolveFont();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true, info: { Title: review.title, Author: 'RuleLens AI' } });
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('Korean', font).font('Korean');
    const startX = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    const ensureSpace = (height: number) => {
      if (doc.y + height > doc.page.height - 50) doc.addPage();
    };
    const section = (title: string) => {
      ensureSpace(42);
      doc.moveDown(0.7);
      const titleY = doc.y;
      doc.fillColor(colors.accent).fontSize(13).text(title, startX, titleY, { width });
      doc.strokeColor(colors.line).moveTo(startX, doc.y + 3).lineTo(startX + width, doc.y + 3).stroke();
      doc.moveDown(0.8);
    };

    const bannerY = doc.y;
    doc.roundedRect(startX, bannerY, width, 96, 8).fill(colors.ink);
    doc.fillColor('#ffffff').fontSize(19).text('내부 규정 적합성 검토 보고서', startX + 18, bannerY + 18, { width: width - 150 });
    doc.fillColor('#bfdbfe').fontSize(9).text(`대상: ${review.targetDocName ?? '-'}\n기준: ${review.policyDocName ?? '-'}`, startX + 18, bannerY + 52, { width: width - 150 });
    const style = riskStyle(review.overallRisk);
    doc.roundedRect(startX + width - 112, bannerY + 22, 94, 30, 5).fill(style.bg);
    doc.fillColor(style.fg).fontSize(11).text(review.overallRisk ?? '-', startX + width - 112, bannerY + 31, { width: 94, align: 'center' });
    doc.y = bannerY + 112;

    doc.roundedRect(startX, doc.y, width, 46, 5).fill('#eff6ff');
    doc.fillColor(colors.ink).fontSize(8.5).text('본 보고서는 로컬 AI가 생성한 검토 초안입니다. 담당자의 최종 확인과 승인이 필요합니다.', startX + 12, doc.y + 14, { width: width - 24, align: 'center' });
    doc.y += 58;

    section('1. 종합 요약');
    doc.fillColor(colors.ink).fontSize(10).text(review.summary ?? '요약 없음', { lineGap: 4 });
    doc.moveDown(0.5).fillColor(colors.muted).fontSize(9).text(`검토 커버리지: ${Math.round((review.coverageRate ?? 0) * 100)}% · 모델: ${review.model}`);

    section('2. 핵심 통계');
    const cards = [
      ['충돌 가능성', findings.filter((item) => item.status === '충돌 가능성').length],
      ['보완 필요', findings.filter((item) => item.status === '일부 보완 필요').length],
      ['적합', findings.filter((item) => item.status === '적합').length],
      ['확인 불가', findings.filter((item) => item.status === '확인 불가').length]
    ] as const;
    const gap = 8; const cardWidth = (width - gap * 3) / 4; const cardY = doc.y;
    cards.forEach(([label, count], index) => {
      const itemStyle = findingStyle(label === '보완 필요' ? '일부 보완 필요' : label);
      const x = startX + index * (cardWidth + gap);
      doc.roundedRect(x, cardY, cardWidth, 52, 5).fill(itemStyle.bg);
      doc.fillColor(itemStyle.fg).fontSize(16).text(String(count), x, cardY + 8, { width: cardWidth, align: 'center' });
      doc.fontSize(8).text(label, x, cardY + 32, { width: cardWidth, align: 'center' });
    });
    doc.y = cardY + 64;
    doc.x = startX;

    section('3. 쟁점별 판단 및 근거');
    findings.forEach((finding, index) => {
      const policyText = finding.policyEvidence.map((item) => `기준: ${item.excerpt}`).join('\n');
      const targetText = finding.targetEvidence.map((item) => `대상: ${item.excerpt}`).join('\n') || '대상: 확인 가능한 근거 없음';
      doc.fontSize(9);
      const textWidth = width - 20;
      const height = 38 + doc.heightOfString(`판단: ${finding.reason}`, { width: textWidth }) +
        doc.heightOfString(`권고: ${finding.remediation}`, { width: textWidth }) +
        doc.heightOfString(`${policyText}\n${targetText}`, { width: textWidth }) + 28;
      ensureSpace(Math.min(height, doc.page.height - 100));
      const y = doc.y;
      const itemStyle = findingStyle(finding.status);
      doc.fillColor(colors.ink).fontSize(10.5).text(`${index + 1}. ${finding.ruleTitle}`, startX + 10, y + 8, { width: width - 120 });
      doc.roundedRect(startX + width - 105, y + 6, 95, 19, 4).fill(itemStyle.bg);
      doc.fillColor(itemStyle.fg).fontSize(8).text(finding.status, startX + width - 105, y + 11, { width: 95, align: 'center' });
      let ty = y + 32;
      doc.fillColor(colors.ink).fontSize(9).text(`판단: ${finding.reason}`, startX + 10, ty, { width: textWidth, lineGap: 2 }); ty = doc.y + 5;
      doc.fillColor(colors.accent).text(`권고: ${finding.remediation}`, startX + 10, ty, { width: textWidth, lineGap: 2 }); ty = doc.y + 5;
      doc.fillColor(colors.muted).fontSize(8).text(`${policyText}\n${targetText}`, startX + 10, ty, { width: textWidth, lineGap: 2 });
      const bottom = doc.y + 10;
      doc.roundedRect(startX, y, width, bottom - y, 5).strokeColor(colors.line).stroke();
      doc.y = bottom + 5;
    });

    section('4. 추가 확인 필요 정보');
    const missing = review.missingInformation ?? [];
    doc.fillColor(colors.ink).fontSize(9.5).text(missing.length ? missing.map((item) => `• ${item}`).join('\n') : '추가 확인 자료 없음', { lineGap: 4 });

    section('5. 검토 의견서');
    const lines = (review.draftOpinion ?? '').split('\n');
    for (const line of lines) {
      const heading = line.match(/^#{1,3}\s+(.*)$/);
      ensureSpace(30);
      if (heading) doc.moveDown(0.5).fillColor(colors.accent).fontSize(heading[0].startsWith('# ') ? 14 : 11).text(heading[1]);
      else if (line.trim()) {
        const cleanLine = line.replace(/^[-*>]\s*/, '• ').replace(/\*\*/g, '').replace(/`/g, '');
        doc.fillColor(colors.ink).fontSize(9.5).text(cleanLine, startX, doc.y, { width, lineGap: 3 });
      }
      else doc.moveDown(0.4);
    }

    const pages = doc.bufferedPageRange();
    for (let index = 0; index < pages.count; index += 1) {
      doc.switchToPage(index);
      const footerY = doc.page.height - doc.page.margins.bottom - 11;
      doc.fillColor(colors.muted).fontSize(7.5).text(
        `검토 ID: ${review.id} · ${index + 1} / ${pages.count}`,
        startX, footerY, { width, align: 'center', lineBreak: false }
      );
    }
    doc.end();
  });
}
