/// <reference types="vitest" />
import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          '/api/scrape': {
            target: 'https://r.jina.ai',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api\/scrape\?url=/, '/'),
          }
        }
      },
      plugins: [
          react(),
          tailwindcss()
      ],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: './tests/setup.ts',
      },
    };
});