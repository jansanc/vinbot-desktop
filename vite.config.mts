/// <reference types="vitest/config" />
import path from "path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * The renderer (the app's window). Main and the preload are not bundled:
 * main is compiled by tsc to dist/, and public/electron.js and preload.js are
 * copied as they are.
 */
export default defineConfig(({ mode }) => {
  // src/config/config.ts is shared with main and reads process.env. As Create
  // React App did, the window gets the REACT_APP_* variables and nothing else.
  const env = loadEnv(mode, process.cwd(), "REACT_APP_");

  return {
    // Relative paths: a packaged build loads build/index.html from file://
    base: "./",
    plugins: [react(), tailwindcss(), devScriptPolicy()],
    resolve: {
      alias: { "@": path.resolve(import.meta.dirname, "src") },
    },
    define: {
      "process.env": JSON.stringify({ ...env, NODE_ENV: mode === "production" ? "production" : "development" }),
    },
    build: {
      outDir: "build",
      emptyOutDir: true,
    },
    // public/electron.js loads this in dev (ELECTRON_DEV)
    server: {
      port: 3002,
      strictPort: true,
    },
    test: {
      include: ["src/**/*.test.ts"],
      environment: "node",
    },
  };
});

/**
 * React's hot reload injects an inline script into the page in dev, which the
 * page's script-src 'self' blocks. Allow inline scripts in dev only; a build
 * keeps the strict policy.
 */
function devScriptPolicy(): Plugin {
  return {
    name: "dev-script-policy",
    apply: "serve",
    transformIndexHtml: (html) => html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
  };
}
