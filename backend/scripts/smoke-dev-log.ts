/* eslint-disable no-console */
import {
  initDevLog,
  emitDevLog,
  shutdownDevLog,
  devLogFilePath,
  DEV_LOG_ENABLED,
} from "../src/services/devLog";

async function main() {
  if (!DEV_LOG_ENABLED) {
    console.error(
      "DEV_LOG_ENABLED is false. Run with NODE_ENV=development NORTHSTAR_DEV_LOGGING=1.",
    );
    process.exit(2);
  }

  await initDevLog();
  const file = devLogFilePath();
  console.log("file:", file);

  const rootId = emitDevLog({
    type: "user.click",
    actor: "user",
    correlationId: "smoke-1",
    parentId: null,
    summary: "smoke: synthetic root click on [data-action=test]",
    details: {
      target: "[data-action=test]",
      sample: { token: "should-be-redacted", email: "alice@example.com" },
    },
  });

  emitDevLog({
    type: "command",
    actor: "frontend",
    correlationId: "smoke-1",
    parentId: rootId,
    summary: "smoke: dispatch command:test/ping",
    details: { args: { hello: "world" } },
  });

  emitDevLog({
    type: "command",
    actor: "backend",
    correlationId: "smoke-1",
    parentId: rootId,
    summary: "smoke: handle command:test/ping",
    durationMs: 17,
    status: "ok",
    details: { result: { ok: true } },
  });

  await shutdownDevLog();
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
