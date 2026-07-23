import tseslint from "typescript-eslint";
import tsdoc from "eslint-plugin-tsdoc";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "node_modules/**",
      "*.config.js",
      "*.config.ts",
    ],
  },
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      tsdoc,
    },
    rules: {
      "tsdoc/syntax": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-inline-comments": "error",
      "spaced-comment": [
        "error",
        "always",
        { line: { markers: [] }, block: { markers: ["*"] } },
      ],
    },
  },
  {
    files: ["test/**/*.ts"],
    rules: {
      "no-inline-comments": "off",
      "spaced-comment": "off",
      "tsdoc/syntax": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
