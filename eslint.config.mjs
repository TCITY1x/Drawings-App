import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Test files use runtime `.ts` import specifiers for Node's built-in test
    // runner, which the Next/TS lint rules would otherwise flag.
    "**/*.test.ts",
    "**/*.test.tsx",
    // Vendored, minified pdf.js worker, served as-is so its version matches
    // the library exactly.
    "public/pdfjs/**",
  ]),
]);

export default eslintConfig;
