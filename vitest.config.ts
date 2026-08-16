import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_PATH: './data/test-grc.sqlite',
      DATA_DIR: './data/test-runtime',
      LOG_LEVEL: 'silent'
    },
    coverage: { reporter: ['text', 'html'] }
  }
});
