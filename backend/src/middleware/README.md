# backend/src/middleware/

Cross-cutting Express middleware. Two files:

## `auth.ts`

The **only** place `req.userId` is set in the entire backend. Phase 1 reads
`process.env.DEV_USER_ID` (set as a Fly secret to `sophie`). Phase 2 will
swap the body for JWT verification — the rest of the codebase doesn't need
to change because every route already reads `req.userId`.

```ts
declare module "express-serve-static-core" {
  interface Request { userId: string }
}
```

The type augmentation lives here so route handlers can use `req.userId`
without any extra cast or import.

## `errorHandler.ts`

Two exports:

- **`asyncHandler(fn)`** — wraps an async route handler and forwards thrown
  errors to Express's error pipeline. Without this, an unawaited rejection
  in a route would crash the process.
- **The error handler itself** — formats every error as
  `{ ok: false, error: <message> }` so the renderer's `cloudTransport`
  always sees the same shape regardless of whether the error came from
  validation, the DB, or Anthropic.

## `requestContext.ts`

AsyncLocalStorage-based context that threads `userId` through deeply-nested
function calls (memory, reflection) without passing it explicitly through
every signature. Routes call `runWithUser(req.userId, () => ...)` once at
the top of the handler, and any code below can call `getCurrentUserId()`.
