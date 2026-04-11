import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["../core/src/**/*.test.ts", "src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
