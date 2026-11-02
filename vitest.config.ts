import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Git worktrees live under .claude/worktrees: without this, a run in the main checkout also runs their copies.
    exclude: [...configDefaults.exclude, '.claude/**'],
    // A few generator tests take several seconds on their own, longer when the whole suite runs in parallel.
    testTimeout: 30000,
  },
});
