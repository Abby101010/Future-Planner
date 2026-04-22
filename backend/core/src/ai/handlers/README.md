# core/src/ai/handlers/

Per-agent handler signatures — the shared shapes for every AI agent
(classify-goal, breakdown, daily-tasks, recovery, pace-check,
home-chat, ...). Each file declares the input context, the output
payload, and the sanitizer that maps the raw LLM reply onto that
output.

## The one rule

**Type definitions and pure sanitizers only.** No `Anthropic` imports,
no prompts that reach outside this tree — the prompt text lives in
`../prompts.ts` or `server/prompts/`.

## What NOT to put here

- The server-side agent runner (belongs in `server/src/ai/handlers/`).
- Desktop UI code for displaying agent output.
- Anything with network side effects.
