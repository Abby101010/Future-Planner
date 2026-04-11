/* NorthStar — structured logger (renderer side)
 *
 * Namespaced, level-filtered console logger. In dev builds everything
 * from debug↑ is printed; in production only warn/error.
 *
 * Usage:
 *   const log = createLogger("ai:transport");
 *   log.debug("POST", url, { payloadKeys: Object.keys(payload) });
 *   log.warn("slow response", ms);
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const isDev =
  typeof import.meta !== "undefined" &&
  (import.meta.env?.DEV || import.meta.env?.MODE === "development");

const currentLevel: LogLevel = isDev ? "debug" : "warn";

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel];
}

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export function createLogger(namespace: string): Logger {
  const prefix = `[${namespace}]`;
  return {
    debug: (...args: unknown[]) => {
      if (shouldLog("debug")) console.debug(prefix, ...args);
    },
    info: (...args: unknown[]) => {
      if (shouldLog("info")) console.info(prefix, ...args);
    },
    warn: (...args: unknown[]) => {
      if (shouldLog("warn")) console.warn(prefix, ...args);
    },
    error: (...args: unknown[]) => {
      if (shouldLog("error")) console.error(prefix, ...args);
    },
  };
}

export type { LogLevel };
