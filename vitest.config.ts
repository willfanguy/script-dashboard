import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    // Several server tests do real I/O (temp dirs, file writes, spawning bash
    // scripts via execFileSync). Under full-suite parallelism the CPU contends
    // and a ~1s operation can blow past vitest's 5s default, producing
    // intermittent "Test timed out" failures that vanish when a file runs
    // alone. A single global ceiling is the right knob — scoping per-file just
    // played whack-a-mole as new slow tests appeared.
    testTimeout: 20_000,
  },
});
