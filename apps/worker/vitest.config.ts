import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'worker',
    include: ['test/**/*.test.ts'],
    // The same throwaway database as core's tests (npm run db:dev).
    globalSetup: ['../../packages/core/test/global-setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
