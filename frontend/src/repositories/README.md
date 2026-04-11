# frontend/src/repositories/

Typed wrappers around the generic `invoke()` transport. One file
(`index.ts`) groups all repository helpers into named exports —
`storeRepo`, `entitiesRepo`, `calendarRepo`, `chatRepo`, etc.

## Why this exists

Pages should never write `invoke("entities:new-goal", payload)` directly.
That's two failure modes in one line: a typo'd channel string and an
untyped payload. Repositories give every IPC channel a real TypeScript
function with input + output types.

## Pattern

```ts
async function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  // cloudTransport routes the call to HTTP or local IPC
  return cloudInvoke<T>(channel, payload);
}

export const entitiesRepo = {
  newGoal(input: NewGoalInput): Promise<{ ok: true; goal: Goal }> {
    return invoke("entities:new-goal", input);
  },
  // ...
};
```

## Adding a new channel

1. Add the route in `backend/src/routes/<domain>.ts`.
2. Add the channel name to `CLOUD_CHANNELS` in
   `frontend/src/services/cloudTransport.ts`.
3. Add a typed wrapper here under the appropriate `<domain>Repo`.
4. Call the wrapper from the page that needs it.

If the channel stays local (device calendar, environment), skip step 2 —
`cloudTransport` will fall through to `window.electronAPI.invoke`.
