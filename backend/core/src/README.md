# core/src/

The public surface of `@northstar/core`. Everything exported from
`index.ts` is importable by desktop and server code.

## Layout

| Subdir | Role |
|---|---|
| `protocol/` | Envelope protocol — `Envelope<T>`, view/command kinds, request/response shapes |
| `types/` | Shared domain types (Goal, DailyTask, Reminder, ...) and agent payload shapes |
| `domain/` | Pure domain logic both sides need (e.g. cognitive budget math) |
| `ai/` | Prompt builders, sanitizers, personalization helpers (server executes them, client reads their output shape) |

## Top-level files

- `index.ts` — the barrel. Add new exports here (and only here).
- `model-config.ts` — shape of the user's model-override object.

## The one rule

**Pure data + pure functions only.** No I/O, no React, no Express,
no Postgres.

## What NOT to put here

Anything that makes a network call, touches the filesystem, reads
`process.env` at runtime, or depends on a browser/DOM/Node global.
