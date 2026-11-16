export type Locale = "en" | "fr";

export const SUPPORTED_LOCALES: readonly Locale[] = ["en", "fr"] as const;

export const LOCALE_COOKIE_NAME = "insa_locale";
