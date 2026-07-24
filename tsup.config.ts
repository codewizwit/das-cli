import { defineConfig } from "tsup";

export default defineConfig({
  entry: { "bin/das": "src/bin/das.ts" },
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: false,
});
