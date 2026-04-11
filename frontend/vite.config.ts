import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";
import renderer from "vite-plugin-electron-renderer";
import path from "node:path";

// Reorg note: this file lives inside frontend/ now. __dirname IS the frontend
// root, so all paths are local — no more "frontend/" prefix on every join.

const electronOutDir = path.join(__dirname, "dist-electron");

export default defineConfig({
  root: __dirname,
  plugins: [
    react(),
    // Three main-process entries: the main window, the preload bridge,
    // and the reflection worker (spawned via node:worker_threads from main).
    // Using the array form of vite-plugin-electron because /simple only
    // accepts a single main entry.
    electron([
      {
        entry: path.join(__dirname, "electron/main.ts"),
        vite: {
          build: {
            outDir: electronOutDir,
            rollupOptions: {
              external: ["better-sqlite3"],
            },
          },
        },
      },
      {
        entry: path.join(__dirname, "electron/preload.ts"),
        onstart(args) {
          // Reload the renderer when preload changes in dev
          args.reload();
        },
        vite: {
          build: {
            outDir: electronOutDir,
          },
        },
      },
      {
        // Background reflection worker — runs the 2-5s Claude reflection
        // call off the main thread so the UI stays responsive.
        entry: path.join(__dirname, "electron/reflection-worker.ts"),
        vite: {
          build: {
            outDir: electronOutDir,
            rollupOptions: {
              external: ["better-sqlite3"],
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  build: {
    // Output to frontend/dist so electron-builder can bundle it
    outDir: path.join(__dirname, "dist"),
    emptyOutDir: true,
  },
});
