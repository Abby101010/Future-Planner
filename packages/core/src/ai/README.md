# core/src/ai/

AI prompt builders, sanitizers, and personalization helpers that need
to live in the shared layer. The server actually runs these against
Claude; the client uses their type signatures to shape what it reads
from view/command responses.

## What lives here

- `prompts.ts` — prompt-template builders (pure string/object builders
  that take a context object and return the message list to send).
- `sanitize.ts` — response sanitizers: they take a raw LLM JSON blob
  and return a strictly-typed payload (with tests).
- `personalize.ts` — personalization helpers (language, user profile,
  tone) applied before prompts render.
- `payloads.ts` — strict shapes for AI input/output envelopes.
- `handlers/` — per-agent handler signatures (what each agent takes in,
  what it emits).

## The one rule

**Pure functions only.** No `Anthropic` SDK calls, no `fetch`, no
`console.log` side effects. The server wraps these in its transport
layer; the client consumes their output types via the envelope
protocol.

## What NOT to put here

- Actual network calls to Anthropic — that's `server/src/ai/`.
- React state, hooks, or components.
- Anything that reads environment variables.
