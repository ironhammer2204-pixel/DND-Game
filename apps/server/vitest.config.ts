import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Only pick up modern Vitest test files; exclude legacy __tests__ with process.exit() style
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/__tests__/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/game/**/*.ts"],
      exclude: ["src/game/**/*.test.ts", "src/game/__tests__/**"],
    },
  },
});
