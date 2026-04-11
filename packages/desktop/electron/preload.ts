/* ──────────────────────────────────────────────────────────
   NorthStar — Electron preload

   Phase 2a: all renderer <-> main IPC channels were removed.
   The preload still runs (contextIsolation requires a preload
   file), but it exposes nothing to the renderer.
   ────────────────────────────────────────────────────────── */

export {};
