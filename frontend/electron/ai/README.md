# frontend/electron/ai/

Local AI orchestration — used in **offline/dev mode only**. In normal
cloud mode the renderer's `services/ai.ts` routes every AI call straight
to `https://northstar-api.fly.dev/ai/<task>`, bypassing this directory.

## Why it still exists

1. **Offline fallback** — if `VITE_CLOUD_API_URL` is unset, AI calls fall
   through to `electronAPI.invoke("ai:<task>", payload)`, which lands here.
2. **Dev iteration without redeploying** — change a prompt locally, run
   the dev build, see the result without pushing to Fly.
3. **History** — this is where the AI logic was born. The cloud handlers
   in `backend/src/ai/handlers/` are line-for-line ports of these.

## Layout

```
ai/
├── client.ts        # Anthropic SDK client. Reads ANTHROPIC_API_KEY from
│                    # env OR from user settings (per-user fallback).
├── router.ts        # Maps task name → handler function
├── prompts.ts       # System prompts (kept in sync with backend/src/ai/prompts.ts)
├── personalize.ts   # Injects per-user memory into a system prompt
├── sanitize.ts      # PII / input scrubbing
└── handlers/        # One file per AI task — see handlers/README.md
```

## Keeping in sync with the cloud

When changing AI behavior:
1. Update `backend/src/ai/...` first (that's the canonical version users hit).
2. Mirror the change here only if you want offline mode to also pick it up.
3. The two prompt files (`prompts.ts` here and `backend/src/ai/prompts.ts`)
   should be identical except for the `personalize.ts` differences.

The backend version reads `ANTHROPIC_API_KEY` from `process.env` only —
the local version still has the per-user-key fallback because there's no
server-side env to fall back to in offline mode.
