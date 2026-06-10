import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["src/**/*.test.ts", "src/index.ts", "scripts/**"],
    },
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
  },
});