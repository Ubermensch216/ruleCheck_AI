import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './logger.js';
import { closeDatabase, migrate, recoverInterruptedReviews } from './storage/database.js';

fs.mkdirSync(env.DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(env.DATA_DIR, 'documents'), { recursive: true });
migrate();
recoverInterruptedReviews();

const app = createApp();
const server = app.listen(env.PORT, env.HOST, () => {
  logger.info({ host: env.HOST, port: env.PORT }, 'GRC Compliance Reviewer started');
});

function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  server.close(() => { closeDatabase(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
