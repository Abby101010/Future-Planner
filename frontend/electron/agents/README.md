# frontend/electron/agents/

Multi-agent coordinator for complex AI flows that need more than a single
prompt. The coordinator chains specialized agents (research → schedule →
reply) and streams progress events back to the renderer via
`agent:progress`.

## Files

| File | Role |
|---|---|
| `coordinator.ts` | Top-level orchestrator. Receives a payload, decides which sub-agents to run, emits `agent:progress` events |
| `research-agent.ts` | Gathers context (goals, calendar, memory) before planning |
| `context-evaluator.ts` | Scores how relevant retrieved context is to the current request |
| `types.ts` | Shared payload + event types |

## Status

This still runs locally in the Electron main process. Cloud-side
equivalents are not yet built — coordinator-style flows are deferred to
phase 1c. If you change behavior here, there is no cloud copy to keep in
sync (yet).

## Known issues

`coordinator.ts` has 4 pre-existing TypeScript errors around
`_schedulingContext` / `_environmentContext` on a payload union. These are
tracked but not blocking — they pre-date the cloud migration.
