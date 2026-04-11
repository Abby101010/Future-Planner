# server/src/ai/

Server-side AI orchestration. The renderer never talks to Anthropic
directly — every AI call arrives as a view/command/legacy HTTP POST
and routes to the appropriate handler here.

## Layout

```
ai/
├── client.ts       # Anthropic SDK client. Reads ANTHROPIC_API_KEY from
│                   # process.env (Fly secret). No per-user fallback.
├── router.ts       # Maps task name → handler function
├── prompts.ts      # All system prompts as exported constants
├── personalize.ts  # Injects per-user memory context into a prompt
├── sanitize.ts     # Normalizes LLM JSON replies
└── handlers/       # One file per AI task
```

Each handler is a `(client, payload, ctx) => Promise<result>` function
that pulls fields from `payload`, builds a system prompt (often via
`personalizeSystem`), sends to Anthropic, parses the JSON reply, and
returns the strict shape declared in `@northstar/core/src/ai/handlers/`.

## The one rule

**`ai/client.ts` is the ONLY place the Anthropic SDK is imported.**
Handlers take the client as a parameter — that way tests can stub it
and the SDK can't leak elsewhere.

## What NOT to put here

- Direct database queries — handlers receive context from the caller
  (a view or command), they don't read from pg themselves.
- React / UI shaping — return the envelope payload type from core and
  let the client render it.
- New API keys in source — secrets are Fly secrets, full stop.
