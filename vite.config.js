import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  build: { rollupOptions: { input: mode === 'pages' || mode === 'simulation' ? { app: 'index.html' } : { app: 'index.html', deploy: 'deploy.html' } } },
}));
