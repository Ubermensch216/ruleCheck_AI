import { defineConfig, loadEnv } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = env.VITE_API_PORT || env.PORT || '3000';
  return {
    plugins: [svelte()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      proxy: { '/api': `http://127.0.0.1:${apiPort}` }
    },
    build: { outDir: 'dist' }
  };
});
