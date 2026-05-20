// Root ESLint config: enforces framework-isolation rules across
// packages/. The frontend has its own config at apps/frontend/eslint.config.js
// for React-specific rules.

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules",
      "**/dist",
      "**/target",
      "apps/desktop/gen",
      // Spikes and templates are excluded by their own configs / are
      // exploratory; the framework-isolation rule only matters for the
      // canonical framework code under packages/.
    ],
  },
  {
    files: ["packages/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
    },
    rules: {
      // Framework principle #1: a package cannot reach into a consumer.
      // If a package needs something from an app, the app should pass
      // it in (dependency injection) — or the thing belongs in another
      // package. This catches the regression at lint time.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["*/apps/*", "**/apps/*", "apps/*"],
              message:
                "Packages cannot import from apps/. Move shared code into a package or pass the dependency in via a parameter.",
            },
            {
              group: ["hipo", "hipo/*"],
              message:
                "Packages cannot import the hipo consumer app. Move shared code into a package or pass the dependency in via a parameter.",
            },
          ],
        },
      ],
      // Packages exit on errors / use console for plugin diagnostics; the
      // recommended preset's no-empty etc. is plenty.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
