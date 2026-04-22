# frontend/src/i18n/locales/

Per-language translation tables. One file per language.

- **`en.ts`** — English (source of truth)
- **`zh.ts`** — Simplified Chinese

Each file exports a default object literal whose keys mirror every other
locale's keys. Keep them in the same order so diffs are easy to read.

## Adding a key

1. Add to `en.ts` first.
2. Add the matching key (with the translated string) to every other locale
   file. The build will not fail if a key is missing — `useT()` falls
   through to the English value as a fallback — but the user will see
   English text where they should see their language.

See `../README.md` for the higher-level translation workflow.
