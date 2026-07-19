import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["src/**/*.a11y.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: { lines: 80, branches: 70, functions: 80, statements: 80 },
      include: [
        "src/shared/contracts.ts",
        "src/shared/time.ts",
        "src/shared/ipc/memory-client.ts",
        "src/features/schedule/timeline-layout.ts",
      ],
    },
  },
});
