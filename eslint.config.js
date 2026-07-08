// ESLint flat config (ESLint v9) for the loopy engine.
// Uses typescript-eslint (parser + non-type-checked recommended rules) so the
// TypeScript sources are actually linted. Formatting is owned by Prettier, so
// no stylistic rules are enabled here (avoids eslint/prettier conflicts).
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/",
      "**/dist/",
      "coverage/",
      ".worktrees/",
      ".loopy/",
      // Pre-existing inputs / committed agent harness — not loopy source.
      ".claude/",
      // Vendored / third-party skill scripts — not loopy source.
      ".github/",
      // Tauri Rust/build artifacts (apps/menubar)
      "**/src-tauri/",
      "**/target/",
    ],
  },
  ...tseslint.configs.recommended,
);
