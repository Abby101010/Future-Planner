# server/src/routes/

Express routers. The main two are the envelope-protocol dispatchers:

| File | Mounted at | Purpose |
|---|---|---|
| `views.ts` | `/views` | Dispatches `view:*` — looks up the view builder in `../views/` and returns an envelope |
| `commands.ts` | `/commands` | Dispatches `command:*` — looks up the command handler, applies it, broadcasts `view:invalidate` |
| `auth.ts` | `/auth` | Bearer-token login (phase 1 single-user, phase 2 JWT drop-in) |

A few legacy channel-style routers (`ai.ts`, `chat.ts`, `memory.ts`,
`entities.ts`, etc.) are still mounted for backwards compatibility with
the desktop's repositories barrel — they'll shrink as the desktop
migrates more reads to views.

## The one rule

**Route handlers contain zero SQL.** A handler validates input, calls
exactly one view builder or command handler, and returns the envelope.
Anything more belongs in `../views/` or `../repositories/`.

## What NOT to put here

- Raw `pool.query()` calls — go through a repository.
- Anthropic calls — go through `../ai/`.
- Response shapes that aren't `Envelope<T>` from `@northstar/core`.
- Any handler written as `async (req, res) =>` without `asyncHandler` —
  unhandled rejections crash the process.
