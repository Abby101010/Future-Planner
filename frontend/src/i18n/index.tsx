/* Starward — i18n (English only; zh locale removed in client test harness) */

import { createContext, useContext, type ReactNode } from "react";
import en, { type Translations } from "./locales/en";

export type Language = "en" | "zh";

export const LANGUAGE_OPTIONS: { value: Language; label: string; nativeLabel: string }[] = [
  { value: "en", label: "English", nativeLabel: "English" },
];

const I18nContext = createContext<Translations>(en as Translations);

export function I18nProvider({
  language: _language,
  children,
}: {
  language: Language;
  children: ReactNode;
}) {
  return <I18nContext.Provider value={en as Translations}>{children}</I18nContext.Provider>;
}

export function useT(): Translations {
  return useContext(I18nContext);
}

export function getDateLocale(_lang: Language): string {
  return "en-US";
}

export default { en };
