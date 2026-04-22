# desktop/src/repositories/

**Legacy** typed wrappers around `cloudTransport.cloudInvoke`. Kept
for call sites (mostly `chatRepo`, `entitiesRepo`, `memoryRepo`,
`monthlyContextRepo`, `modelConfigRepo`) that haven't migrated to
`view:*` queries yet.

## The one rule

**Do not add new repositories or new methods to existing ones.** Any
new data access should be a `view:*` query or a `command:*` handler,
consumed through `hooks/useQuery` or `hooks/useCommand` respectively.
This folder should shrink over time, never grow.

## What NOT to put here

- Anything that a server view could return instead.
- Transport logic — that lives in `../services/cloudTransport.ts`.
- React hooks or components.
