import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier/flat";

export default defineConfig([
    {
        ignores: ["**/*.js", "cdk.out/*"],
    },
    { files: ["**/*.{ts}"], plugins: { js }, extends: ["js/recommended"] },
    { files: ["**/*.{ts}"], languageOptions: { globals: globals.browser } },
    tseslint.configs.recommended,
    eslintConfigPrettier
]);
