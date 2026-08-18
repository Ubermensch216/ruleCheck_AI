import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import multer from 'multer';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { createReviewSchema, documentKindSchema, updateReviewSchema } from '../shared/schemas.js';
import { env } from './config/env.js';
import { AppError } from './errors.js';
import { logger } from './logger.js';
import { ollamaHealthy, listModels } from './compliance/ollamaClient.js';
import { segmentDocument } from './documents/segmentDocument.js';
import { reviewJobs } from './jobs/reviewJobs.js';
import { parseDocument } from './parsers/parserRegistry.js';
import { createReviewPdf } from './reports/grcReport.js';
import { safeFilename, validateUpload } from './security/uploadPolicy.js';
import {
  createReview, deleteReview, getDocument, getReview, getReviewResult, insertDocument,
  listReviews, newId, updateReviewTitle
} from './storage/store.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1 } });

function requestPath(url: string | undefined) {
  return url?.split('?', 1)[0] || '/';
}

function requestLogDetails(req: Request, res: Response, responseTime: number) {
  return {
    method: req.method,
    path: requestPath(req.originalUrl),
    statusCode: res.statusCode,
    durationMs: responseTime
  };
}

export function createApp(appLogger: Logger = logger) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"] } } }));
  app.use(pinoHttp({
    logger: appLogger,
    genReqId: () => randomUUID(),
    quietReqLogger: true,
    quietResLogger: true,
    customLogLevel: (_req, res, error) => {
      if (error || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'silent';
    },
    customSuccessObject: (req, res, value) => requestLogDetails(req as Request, res as Response, value.responseTime),
    customErrorObject: (req, res, error, value) => ({
      ...requestLogDetails(req as Request, res as Response, value.responseTime),
      ...(res.err ? { err: error } : {})
    }),
    customSuccessMessage: (req, res) => `요청 처리 실패: ${req.method} ${requestPath(req.url)} (${res.statusCode})`,
    customErrorMessage: (req, res) => `서버 요청 처리 실패: ${req.method} ${requestPath(req.url)} (${res.statusCode})`
  }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', async (_req, res) => {
    const ollama = await ollamaHealthy();
    res.status(ollama ? 200 : 503).json({ ok: ollama, server: 'ok', database: 'ok', ollama: ollama ? 'ok' : 'unavailable' });
  });

  app.get('/api/models', async (_req, res, next) => {
    try { res.json({ ok: true, models: await listModels() }); } catch (error) { next(error); }
  });

  app.post('/api/documents', upload.single('file'), async (req, res, next) => {
    let storageDirectory: string | undefined;
    try {
      if (!req.file) throw new AppError('FILE_REQUIRED', '업로드할 문서를 선택해 주세요.', 400);
      const kind = documentKindSchema.parse(req.body.kind);
      const filename = safeFilename(req.file.originalname);
      const { extension, mimeType } = await validateUpload(filename, req.file.buffer);
      const parsed = await parseDocument(req.file.buffer, filename, mimeType, extension);
      const id = newId('doc');
      const clauses = segmentDocument(id, parsed.fullText, parsed.blocks);
      storageDirectory = path.join(env.DATA_DIR, 'documents', id);
      await fs.mkdir(storageDirectory, { recursive: true });
      const originalPath = path.join(storageDirectory, `original${extension}`);
      await fs.writeFile(originalPath, req.file.buffer, { flag: 'wx' });
      const document = insertDocument({ id, kind, sizeBytes: req.file.size, storagePath: storageDirectory, parsed, clauses });
      res.status(201).json({ ok: true, document, clauseCount: clauses.length });
    } catch (error) {
      if (storageDirectory) await fs.rm(storageDirectory, { recursive: true, force: true }).catch(() => {});
      next(error);
    }
  });

  app.get('/api/documents/:id', (req, res, next) => {
    try { res.json({ ok: true, document: getDocument(req.params.id) }); } catch (error) { next(error); }
  });

  app.post('/api/reviews', (req, res, next) => {
    try {
      const input = createReviewSchema.parse(req.body);
      const review = createReview({ id: newId('review'), ...input });
      reviewJobs.enqueue({ reviewId: review.id, model: review.model, policyDocumentId: review.policyDocumentId, targetDocumentId: review.targetDocumentId });
      res.status(202).json({ ok: true, review });
    } catch (error) { next(error); }
  });

  app.get('/api/reviews', (_req, res) => res.json({ ok: true, items: listReviews() }));

  app.get('/api/reviews/:id', (req, res, next) => {
    try {
      const result = getReviewResult(req.params.id);
      res.json({ ok: true, ...result });
    } catch (error) { next(error); }
  });

  app.patch('/api/reviews/:id', (req, res, next) => {
    try {
      const input = updateReviewSchema.parse(req.body);
      res.json({ ok: true, review: updateReviewTitle(req.params.id, input.title) });
    } catch (error) { next(error); }
  });

  app.get('/api/reviews/:id/events', (req, res, next) => {
    try { getReview(req.params.id); } catch (error) { next(error); return; }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    let last = '';
    const send = () => {
      try {
        const review = getReview(req.params.id);
        const payload = JSON.stringify(review);
        if (payload !== last) { res.write(`event: progress\ndata: ${payload}\n\n`); last = payload; }
        if (['completed', 'failed', 'cancelled'].includes(review.status)) { clearInterval(timer); res.end(); }
      } catch { clearInterval(timer); res.end(); }
    };
    const timer = setInterval(send, 750);
    send();
    req.on('close', () => clearInterval(timer));
  });

  app.post('/api/reviews/:id/cancel', (req, res, next) => {
    try { reviewJobs.cancel(req.params.id); res.json({ ok: true, review: getReview(req.params.id) }); } catch (error) { next(error); }
  });

  app.get('/api/reviews/:id/report.pdf', async (req, res, next) => {
    try {
      const { review, findings } = getReviewResult(req.params.id);
      if (review.status !== 'completed') throw new AppError('REVIEW_NOT_COMPLETED', '완료된 검토만 보고서를 생성할 수 있습니다.', 409);
      const pdf = await createReviewPdf(review, findings);
      const filename = encodeURIComponent(`${review.title}.pdf`);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
      res.send(pdf);
    } catch (error) { next(error); }
  });

  app.delete('/api/reviews/:id', async (req, res, next) => {
    try { await deleteReview(req.params.id); res.status(204).end(); } catch (error) { next(error); }
  });

  const dist = path.resolve('dist');
  app.use(express.static(dist));
  app.use((req, res, next) => {
    if (req.method === 'GET' && req.accepts('html')) res.sendFile(path.join(dist, 'index.html'), (error) => error && next(error));
    else next();
  });

  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    void _next;
    if (error instanceof multer.MulterError) {
      const message = error.code === 'LIMIT_FILE_SIZE' ? '파일 크기가 30MB 제한을 초과했습니다.' : '파일 업로드에 실패했습니다.';
      res.status(413).json({ ok: false, error: { code: error.code, message, requestId: req.id } });
      return;
    }
    if (error instanceof AppError) {
      res.status(error.status).json({ ok: false, error: { code: error.code, message: error.message, requestId: req.id } });
      return;
    }
    if (error && typeof error === 'object' && 'issues' in error) {
      res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: '요청 값이 올바르지 않습니다.', requestId: req.id } });
      return;
    }
    res.err = error instanceof Error ? error : new Error(String(error));
    res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: '서버 내부 오류가 발생했습니다.', requestId: req.id } });
  });
  return app;
}
