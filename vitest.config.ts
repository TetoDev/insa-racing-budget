import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  plugins: [solid()],
  resolve: {
    conditions: ["development", "browser"],
    alias: {
      "~": path.resolve(import.meta.dirname, "src")
    }
  },
  test: {
    environment: "node"
  }
});
