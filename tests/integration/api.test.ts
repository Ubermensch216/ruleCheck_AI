import fs from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import pino from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app.js';
import { env } from '../../server/config/env.js';
import { closeDatabase, db, migrate, recoverInterruptedReviews } from '../../server/storage/database.js';
import { createReview, getReview, newId } from '../../server/storage/store.js';

const app = createApp();

function appWithCapturedLogs() {
  const lines: string[] = [];
  const stream = new PassThrough();
  stream.on('data', (chunk) => lines.push(...chunk.toString().trim().split('\n').filter(Boolean)));
  const testLogger = pino({ level: 'trace', base: undefined }, stream);
  return { app: createApp(testLogger), lines };
}

describe('document API', () => {
  beforeAll(async () => {
    migrate();
    db.exec('DELETE FROM evidence; DELETE FROM findings; DELETE FROM reviews; DELETE FROM clause_fts; DELETE FROM document_clauses; DELETE FROM documents;');
    await fs.rm(env.DATA_DIR, { recursive: true, force: true });
    await fs.mkdir(env.DATA_DIR, { recursive: true });
  });

  afterAll(async () => {
    closeDatabase();
    await fs.rm(env.DATA_DIR, { recursive: true, force: true });
    await fs.rm(env.DATABASE_PATH, { force: true });
    await fs.rm(`${env.DATABASE_PATH}-shm`, { force: true });
    await fs.rm(`${env.DATABASE_PATH}-wal`, { force: true });
  });

  it('uploads and retrieves a policy text document without exposing full text', async () => {
    const upload = await request(app).post('/api/documents').field('kind', 'policy')
      .attach('file', Buffer.from('제1조 (목적)\n내부 규정의 목적입니다.'), 'policy.txt');
    expect(upload.status).toBe(201);
    expect(upload.body.document.kind).toBe('policy');
    expect(upload.body.clauseCount).toBeGreaterThan(0);

    const fetched = await request(app).get(`/api/documents/${upload.body.document.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.document.fullText).toBeUndefined();
  });

  it('rejects an unsupported upload', async () => {
    const response = await request(app).post('/api/documents').field('kind', 'target')
      .attach('file', Buffer.from('payload'), 'payload.exe');
    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('renames a review from review history', async () => {
    const policy = await request(app).post('/api/documents').field('kind', 'policy')
      .attach('file', Buffer.from('제1조 기준 문서입니다.'), 'rename-policy.txt');
    const target = await request(app).post('/api/documents').field('kind', 'target')
      .attach('file', Buffer.from('제1조 대상 문서입니다.'), 'rename-target.txt');
    const review = createReview({
      id: newId('review'),
      title: '변경 전 제목',
      policyDocumentId: policy.body.document.id,
      targetDocumentId: target.body.document.id,
      model: 'test-model'
    });

    const response = await request(app).patch(`/api/reviews/${review.id}`).send({ title: '  변경된 검토 제목  ' });

    expect(response.status).toBe(200);
    expect(response.body.review.title).toBe('변경된 검토 제목');
    const history = await request(app).get('/api/reviews');
    expect(history.body.items.find((item: { id: string }) => item.id === review.id).title).toBe('변경된 검토 제목');
  });

  it('returns interrupted reviews to the queue instead of failing them', () => {
    const review = db.prepare('SELECT id FROM reviews ORDER BY created_at DESC LIMIT 1').get() as { id: string };
    db.prepare(`UPDATE reviews SET status='analyzing', progress=54, processed_clauses=6,
      total_clauses=11, error_code='STALE', error_message='이전 오류' WHERE id=?`).run(review.id);

    const jobs = recoverInterruptedReviews();
    const recovered = getReview(review.id);

    expect(jobs.some((job) => job.reviewId === review.id)).toBe(true);
    expect(recovered.status).toBe('queued');
    expect(recovered.progress).toBe(0);
    expect(recovered.processedClauses).toBe(0);
    expect(recovered.errorCode).toBeUndefined();
    expect(recovered.errorMessage).toBeUndefined();
  });

  it('does not log successful HTTP requests', async () => {
    const { app: loggedApp, lines } = appWithCapturedLogs();

    const response = await request(loggedApp).get('/index.html');

    expect(response.status).toBe(200);
    expect(lines).toEqual([]);
  });

  it('logs failed requests without headers, query strings, or response metadata', async () => {
    const { app: loggedApp, lines } = appWithCapturedLogs();

    const response = await request(loggedApp)
      .post('/missing?token=secret')
      .set('authorization', 'Bearer secret');

    expect(response.status).toBe(404);
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(entry.level).toBe(40);
    expect(entry.msg).toBe('요청 처리 실패: POST /missing (404)');
    expect(entry).toMatchObject({
      reqId: expect.any(String),
      method: 'POST',
      path: '/missing',
      statusCode: 404
    });
    expect(entry).not.toHaveProperty('req');
    expect(entry).not.toHaveProperty('res');
    expect(JSON.stringify(entry)).not.toContain('secret');
  });
});
