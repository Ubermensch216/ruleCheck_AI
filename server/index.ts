import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './logger.js';
import { reviewJobs } from './jobs/reviewJobs.js';
import { closeDatabase, migrate, recoverInterruptedReviews } from './storage/database.js';
import { recoverDeletingReviews } from './storage/store.js';

fs.mkdirSync(env.DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(env.DATA_DIR, 'documents'), { recursive: true });
migrate();

const app = createApp();
const server = app.listen(env.PORT, env.HOST, () => {
  const recoveredJobs = recoverInterruptedReviews();
  void recoverDeletingReviews().catch((error) => logger.error({ err: error }, '삭제 중인 검토 복구에 실패했습니다.'));
  recoveredJobs.forEach((job) => reviewJobs.enqueue(job));
  logger.info({ host: env.HOST, port: env.PORT }, 'RuleLens AI 서버가 시작되었습니다.');
});
server.on('error', (error) => {
  logger.fatal({ err: error, host: env.HOST, port: env.PORT }, '서버를 시작하지 못했습니다.');
  closeDatabase();
  process.exit(1);
});

function shutdown(signal: string) {
  logger.info({ signal }, '서버를 종료합니다.');
  server.close(() => { closeDatabase(); process.exit(0); });
  server.closeAllConnections();
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
