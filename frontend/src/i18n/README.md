# frontend/src/i18n/

Localization. Starward ships in **English** and **Chinese** (simplified).

## Files

- **`index.tsx`** — exports the `useT()` hook, the locale context provider,
  and the `getDateLocale()` helper for `date-fns`. Pages call `const t = useT()`
  and then `t("home.welcome")` to render strings.
- **`locales/en.ts`** — English translation table (object literal).
- **`locales/zh.ts`** — Chinese translation table. Keys must match `en.ts`.

## Adding a string

1. Add the key to `en.ts` first (English is the source of truth).
2. Add the same key with a Chinese translation to `zh.ts`.
3. Use `t("your.key")` in the component.

## Adding a language

1. Create `locales/<lang>.ts` with the same key set as `en.ts`.
2. Register it in `index.tsx`'s locale map.
3. Add the language to the picker in `WelcomePage.tsx` and `SettingsPage.tsx`.

## Conventions

- **Never hardcode user-facing strings.** Run a search for any literal
  English string in a `<JSX>` block — if you find one, it should be moved
  into a translation key.
- **Date / time formatting goes through `getDateLocale(lang)`** so
  `format(date, "PPP", { locale })` produces locale-correct output.
