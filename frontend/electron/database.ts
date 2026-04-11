/* NorthStar — SQLite database layer (transition barrel)
 *
 * The real implementation now lives under electron/db/. This file is
 * kept as a thin re-export so existing importers do not need to change
 * their paths.
 */

export * from "./db/connection";
export * from "./db/helpers";
export * from "./db/appStore";
export * from "./db/calendar";
export * from "./db/reminders";
export * from "./db/memory";
export * from "./db/monthlyContext";
export * from "./db/chat";
export * from "./db/semanticSearch";
export { runMigrations } from "./db/migrations";
