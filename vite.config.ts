import { defineConfig } from 'vite';
import { sites } from '@openai/sites-vite-plugin';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react(), sites()],
  optimizeDeps: { include: ['@huggingface/transformers'] },
  server: { headers: { 'Cache-Control': 'no-store' } },
});
