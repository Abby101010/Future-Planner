import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";
import renderer from "vite-plugin-electron-renderer";
import path from "node:path";

const electronOutDir = path.join(__dirname, "dist-electron");

export default defineConfig({
  root: __dirname,
  plugins: [
    react(),
    electron([
      {
        entry: path.join(__dirname, "electron/main.ts"),
        vite: {
          build: {
            outDir: electronOutDir,
          },
        },
      },
      {
        entry: path.join(__dirname, "electron/preload.ts"),
        onstart(args) {
          args.reload();
        },
        vite: {
          build: {
            outDir: electronOutDir,
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      "@northstar/core": path.resolve(__dirname, "../core/src/index.ts"),
    },
  },
  build: {
    outDir: path.join(__dirname, "dist"),
    emptyOutDir: true,
  },
});
