import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["dist", "node_modules", "src-tauri/target", "src-tauri/gen"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // We intentionally use the "fetch on mount via useCallback + useEffect"
      // pattern throughout the app — backend is the source of truth, React
      // holds only ephemeral UI state. The v6 rule's advice (avoid effects
      // for state sync) is geared at "computed from other state" cases and
      // doesn't apply to syncing from an external system.
      "react-hooks/set-state-in-effect": "off",
      // Honor the underscore-prefix convention for intentionally-unused
      // function args and binding names — used heavily in test mocks
      // (e.g. `vi.fn(async (_url, _init) => ...)`).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  {
    files: ["*.config.{js,ts}", "vite.config.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },
  prettier,
);
