# core/src/protocol/

The envelope protocol — the wire contract between `@northstar/desktop`
and `@northstar/server`.

## What lives here

- `envelope.ts` — `Envelope<T>` (`{ v, ok, kind, data, error }`), the
  universal response wrapper plus the `Ok` / `Err` constructors.
- `kinds.ts` — the full enumeration of legal `view:*` and `command:*`
  kinds, plus their request-parameter and response-data shapes.
- `index.ts` — the barrel.

## The one rule

**Every addition must stay backwards compatible with running clients.**
New fields on a response payload are safe; renaming or removing a field
is a breaking change and needs a version bump on `Envelope.v`. Adding
a new view or command kind is fine — old clients just won't call it.

## What NOT to put here

- Concrete transport code (`fetch`, WebSocket) — that's in
  `desktop/src/services/`.
- Route handlers — those live in `server/src/routes/`.
- Domain logic — that's in `../domain/` or `../types/`.
