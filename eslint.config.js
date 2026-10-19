import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    // The edge functions are in no tsconfig — they import `npm:` and `https:` specifiers and
    // run on Deno, so `tsc` cannot resolve them and `tsconfig.app.json` includes only `src`.
    // typescript-eslint's recommended preset switches these core rules OFF on the grounds
    // that TypeScript catches them, which leaves this half of the codebase checked by
    // nothing at all: `const html = …; html = …` shipped, deployed, and took out the
    // branding stage for every house that refuses a plain fetch.
    //
    // None of these need type information, so they cost nothing to run here.
    files: ["supabase/functions/**/*.ts"],
    languageOptions: {
      globals: { ...globals.browser, Deno: "readonly", EdgeRuntime: "readonly" },
    },
    rules: {
      "no-const-assign": "error",
      "no-class-assign": "error",
      "no-func-assign": "error",
      "no-dupe-args": "error",
      "no-dupe-keys": "error",
      "no-dupe-class-members": "error",
      "no-obj-calls": "error",
      "no-setter-return": "error",
      "no-unreachable": "error",
      "valid-typeof": "error",
      "no-undef": "error",
    },
  },
);
