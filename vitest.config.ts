import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    typecheck: {
      tsconfig: "src/lib/__tests__/tsconfig.json",
    },
  },
  resolve: {
    alias: {
      // Mirror the wrangler alias so tests use the same lite build
      exifr: new URL(
        "./node_modules/exifr/dist/lite.esm.mjs",
        import.meta.url
      ).pathname,
    },
  },
});
