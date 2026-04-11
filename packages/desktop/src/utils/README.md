# desktop/src/utils/

Small leaf utilities with no deps beyond TypeScript and the browser.
Currently just `logger.ts` (a tiny `debug`/`info`/`warn`/`error`
wrapper that no-ops in production builds).

## The one rule

**One concept per file, zero imports from elsewhere in the repo.**
Utilities are the bottom of the dependency graph — they must not
import from `pages/`, `components/`, `services/`, or `hooks/`.

## What NOT to put here

- React-specific helpers (use a hook in `../hooks/`).
- Domain logic (put it in `../lib/`).
- Anything that touches the network, filesystem, or DOM beyond
  `console`.
