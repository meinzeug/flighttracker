import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 6666,
    host: '::',
    proxy: {
      '/api': {
        target: 'http://localhost:6667',
        changeOrigin: true,
      },
    },
  },
});
