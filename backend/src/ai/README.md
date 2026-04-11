# backend/src/ai/

Server-side AI orchestration. The renderer never talks to Anthropic
directly — every AI call comes here as an HTTP POST to `/ai/<task>`,
which routes to the appropriate handler.

## Layout

```
ai/
├── client.ts        # Anthropic SDK client. Reads ANTHROPIC_API_KEY from
│                    # process.env (Fly secret). NO per-user fallback —
│                    # users never enter their own key.
├── router.ts        # Maps task name → handler function
├── prompts.ts       # All system prompts as exported constants
├── personalize.ts   # Injects per-user memory context into a system prompt
├── sanitize.ts      # Strips PII / normalizes user input before sending
└── handlers/        # One file per AI task
```

## Handlers

Each handler is a `(client, payload, memoryContext) => Promise<result>`
function. They:
1. Pull the relevant fields out of `payload`,
2. Build a per-task system prompt (often via `personalizeSystem` to inject
   memory facts/preferences),
3. Send to Anthropic via `client.messages.create`,
4. Parse the JSON reply (tolerant to code fences and prose around it),
5. Return the structured result that the renderer expects.

## Adding a new task

1. Write the handler in `handlers/<taskName>.ts`.
2. Register it in `router.ts` so `/ai/<task-name>` resolves to it.
3. Add the prompt constant to `prompts.ts`.
4. Add `ai:<task-name>` to the renderer's `CLOUD_CHANNELS` set in
   `frontend/src/services/cloudTransport.ts`.

The renderer's `frontend/src/services/ai.ts` exposes typed wrappers — add
one there too if the call is invoked from React.
