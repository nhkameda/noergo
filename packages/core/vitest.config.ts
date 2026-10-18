import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'core',
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
