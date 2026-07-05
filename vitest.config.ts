import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
    environment: "node",
    // Integration tests spawn real `git`/subprocesses (tests/git/*, tests/e2e/*)
    // and get squeezed past the 5s default when the suite runs under CPU
    // contention (e.g. N parallel verify runs). Give them headroom. See D-0002.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
