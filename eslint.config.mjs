import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "public/map/**/*.tsx", // Tiled XML tilesets, not TypeScript
    ],
  },
  {
    files: ["scripts/splitMapIntoTiles.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" }, // This Node CLI is CommonJS.
  },
];

export default eslintConfig;
