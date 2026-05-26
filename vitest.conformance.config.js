import { defineConfig } from 'vitest/config';

// Separate config so conformance runs are explicit: `npm run test:conformance`.
// Failures here = divergence from the TC39 Signals proposal as encoded by
// the polyfill's test suite, NOT regressions in our own framework tests.
export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['conformance/tests/**/*.test.ts'],
  },
});
