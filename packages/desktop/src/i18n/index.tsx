/* ──────────────────────────────────────────────────────────
   NorthStar — i18n system (internationalization)
   Provides React context + useT() hook for translations.
   ────────────────────────────────────────────────────────── */

import { createContext, useContext, useMemo } from "react";
import en, { type Translations } from "./locales/en";
import zh from "./locales/zh";

export type Language = "en" | "zh";

const locales: Record<Language, Translations> = { en: en as Translations, zh };

export const LANGUAGE_OPTIONS: { value: Language; label: string; nativeLabel: string }[] = [
  { value: "en", label: "English", nativeLabel: "English" },
  { value: "zh", label: "Mandarin", nativeLabel: "简体中文" },
];

// ── Context ──

const I18nContext = createContext<Translations>(en as Translations);

/** Provider — wrap app root with this */
export function I18nProvider({
  language,
  children,
}: {
  language: Language;
  children: React.ReactNode;
}) {
  const translations = useMemo(() => locales[language] ?? en, [language]);
  return (
    <I18nContext.Provider value={translations}>
      {children}
    </I18nContext.Provider>
  );
}

/** Hook — returns the full translations object for the current language */
export function useT(): Translations {
  return useContext(I18nContext);
}

/** Get the locale string for date formatting (e.g. "en-US", "zh-CN") */
export function getDateLocale(lang: Language): string {
  return lang === "zh" ? "zh-CN" : "en-US";
}

export default locales;
