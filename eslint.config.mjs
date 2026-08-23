// @ts-check
import tseslint from "typescript-eslint";

/**
 * Minimal, high-signal lint: correctness rules only (no stylistic churn).
 * The codebase is strictly typed via tsc --noEmit per workspace; ESLint adds
 * the class of issues TypeScript can't see (unused vars, misleading patterns).
 */
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**",
      "packages/database/prisma/generated/**",
      "apps/web/next-env.d.ts",
      "apps/dashboard/next-env.d.ts",
      "apps/admin/next-env.d.ts",
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      // The domain layer intentionally throws typed error subclasses; `throw new Error`
      // is still allowed where infrastructure genuinely has nothing better.
    },
  }
);
