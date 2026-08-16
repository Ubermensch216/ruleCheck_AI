import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(3000),
  OLLAMA_URL: z.string().url().default('http://127.0.0.1:11434'),
  OLLAMA_MODEL: z.string().default('gemma4:e2b'),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().positive().default(180000),
  DATABASE_PATH: z.string().default('./data/grc.sqlite'),
  DATA_DIR: z.string().default('./data'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(30 * 1024 * 1024),
  MAX_EXTRACTED_CHARS: z.coerce.number().int().positive().default(2_000_000),
  MAX_ZIP_ENTRIES: z.coerce.number().int().positive().default(5000),
  MAX_ZIP_UNCOMPRESSED_BYTES: z.coerce.number().int().positive().default(100 * 1024 * 1024),
  MAX_CONCURRENT_REVIEWS: z.coerce.number().int().positive().default(1),
  LOG_LEVEL: z.string().default('info'),
  PDF_FONT_PATH: z.string().optional()
});

const parsed = schema.parse(process.env);
export const env = {
  ...parsed,
  DATABASE_PATH: path.resolve(parsed.DATABASE_PATH),
  DATA_DIR: path.resolve(parsed.DATA_DIR)
};
