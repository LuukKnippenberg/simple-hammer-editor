import { defineConfig } from 'vite';
import { editorServer } from './server/plugin.ts';

export default defineConfig({
  plugins: [editorServer()],
  server: { port: 5190, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
