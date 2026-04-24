// Type shim so `import from "@starward/core/handlers"` resolves under
// classic Node module resolution. Forwards to the server-only handler
// barrel in dist/.
export * from "./dist/handlers";
