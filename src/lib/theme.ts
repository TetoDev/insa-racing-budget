export const SUPPORTED_THEMES = ["light", "dark"] as const;
export type Theme = (typeof SUPPORTED_THEMES)[number];

export const THEME_COOKIE_NAME = "insa_theme";

export function normalizeTheme(raw: unknown): Theme {
  if (typeof raw !== "string") return "light";
  const lower = raw.trim().toLowerCase();
  return lower === "dark" ? "dark" : "light";
}

export function parseThemeFromCookieHeader(cookieHeader: string | null | undefined): Theme {
  if (!cookieHeader) return "light";
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    if (key === THEME_COOKIE_NAME) {
      const val = part.slice(eqIdx + 1).trim();
      try {
        return normalizeTheme(decodeURIComponent(val));
      } catch {
        return normalizeTheme(val);
      }
    }
  }
  return "light";
}

export function readThemeFromDocumentCookie(): Theme {
  if (typeof document === "undefined") return "light";
  return parseThemeFromCookieHeader(document.cookie);
}

export function writeThemeDocumentCookie(theme: Theme): void {
  if (typeof document === "undefined") return;
  const secure =
    typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${THEME_COOKIE_NAME}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}

export function applyThemeToDocument(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}
