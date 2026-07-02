import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The scaffold ships with no tests yet; a green run with 0 tests is the
    // expected state for T-001 (later tasks add tests under tests/).
    passWithNoTests: true,
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
    environment: "node",
  },
});
