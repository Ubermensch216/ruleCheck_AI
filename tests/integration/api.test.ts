import fs from 'node:fs/promises';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app.js';
import { env } from '../../server/config/env.js';
import { closeDatabase, db, migrate } from '../../server/storage/database.js';

const app = createApp();

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
});
