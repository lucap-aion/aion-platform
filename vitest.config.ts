import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // The edge functions import npm packages by Deno's specifier; the tests run them on
      // Node, where the same package is in node_modules.
      "npm:@resvg/resvg-wasm@2.6.2": "@resvg/resvg-wasm",
    },
  },
});
