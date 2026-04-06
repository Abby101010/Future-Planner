import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";
import path from "node:path";
import { config as dotenvConfig } from "dotenv";

// Load .env so we can read NORTHSTAR_EDITION at build time
dotenvConfig();

const isPersonal = process.env.NORTHSTAR_EDITION === "personal";

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    // Compile-time flag: true only when NORTHSTAR_EDITION=personal in .env
    // Dead-code eliminated in production builds when false
    __PERSONAL_EDITION__: JSON.stringify(isPersonal),
  },
  plugins: [
    react(),
    electron({
      main: {
        // Electron main process entry
        entry: "electron/main.ts",
        vite: {
          build: {
            rollupOptions: {
              // Native modules must be external — bundler can't process them
              external: ["better-sqlite3"],
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
