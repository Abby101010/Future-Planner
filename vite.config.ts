import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";
import path from "node:path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        // Electron main process entry
        entry: "electron/main.ts",
        vite: {
          build: {
            rollupOptions: {
              // pg optionally requires pg-native; mark it external so the
              // bundler doesn't try to resolve it at build time.
              external: ["pg-native"],
            },
          },
        },
      },
      preload: {
        // Preload script entry
        input: path.join(__dirname, "electron/preload.ts"),
      },
      // Enable Electron-renderer integration (use Node.js API in renderer)
      renderer: {},
    }),
  ],
  build: {
    // Output to dist/ so electron-builder can bundle it
    outDir: "dist",
    emptyOutDir: true,
  },
});
