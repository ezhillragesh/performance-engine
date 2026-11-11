// Runtime accessibility audit tests (core/a11y/__tests__), jsdom environment.
// `npm test` runs them after the core suite; alone: `npm run test:a11y`
// (single file: npx vitest run -c vitest.a11y.config.ts a11y/__tests__/aria.test.ts).
import { defineConfig } from "vitest/config";

export default defineConfig({
  // panel-list.test.ts imports the extension's panel view module (outside core).
  server: { fs: { allow: [".."] } },
  test: {
    include: ["a11y/__tests__/**/*.test.ts"],
    environment: "jsdom",
    setupFiles: ["a11y/__tests__/setup.ts"],
    // perf.test.ts asserts wall-clock budgets; run files one at a time so they don't contend.
    fileParallelism: false,
  },
});
