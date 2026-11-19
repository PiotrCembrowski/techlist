import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "design/**",
    "src/db/migrations/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
  ]),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      // Rule 2.3 / Section 13: no raw HTML injection outside JSON-LD (added in Stage 7 with an explicit disable).
      "react/no-danger": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: "Use getEnv() from src/config/env.ts",
        },
      ],
    },
  },
  {
    // Tooling and config may read process.env directly.
    files: [
      "scripts/**",
      "tests/**",
      "*.config.*",
      "src/config/env.ts",
      "src/instrumentation.ts",
      "src/db/seed/**",
    ],
    rules: { "no-restricted-syntax": "off" },
  },
]);
