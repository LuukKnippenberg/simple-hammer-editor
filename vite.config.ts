import { defineConfig } from 'vite';
import { editorServer } from './server/plugin.ts';

export default defineConfig({
  plugins: [editorServer()],
  // SHE_PORT lets a second checkout (a git worktree) run its own dev server next to this one.
  server: { port: Number(process.env.SHE_PORT ?? 5190), strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
