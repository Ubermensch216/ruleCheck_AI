import pino from 'pino';
import { env } from './config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label })
  },
  redact: {
    paths: ['req.body.policyText', 'req.body.targetText', 'document.fullText', '*.excerpt', '*.prompt'],
    censor: '[REDACTED]'
  }
});
