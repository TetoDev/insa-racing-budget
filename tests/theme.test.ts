import { describe, expect, it } from "vitest";
import {
  SUPPORTED_THEMES,
  THEME_COOKIE_NAME,
  normalizeTheme,
  parseThemeFromCookieHeader
} from "../src/lib/theme";
import { en } from "../src/lib/i18n/en";
import { fr } from "../src/lib/i18n/fr";

describe("theme utilities", () => {
  it("supports light and dark themes with expected cookie name", () => {
    expect(SUPPORTED_THEMES).toEqual(["light", "dark"]);
    expect(THEME_COOKIE_NAME).toBe("insa_theme");
  });

  it("normalizes valid and invalid theme inputs with light fallback", () => {
    expect(normalizeTheme("dark")).toBe("dark");
    expect(normalizeTheme("  DARK  ")).toBe("dark");
    expect(normalizeTheme("light")).toBe("light");
    expect(normalizeTheme("LIGHT")).toBe("light");
    expect(normalizeTheme("unknown")).toBe("light");
    expect(normalizeTheme("")).toBe("light");
    expect(normalizeTheme(null)).toBe("light");
    expect(normalizeTheme(undefined)).toBe("light");
    expect(normalizeTheme(123)).toBe("light");
  });

  it("parses theme cookie from HTTP Cookie header", () => {
    expect(parseThemeFromCookieHeader(undefined)).toBe("light");
    expect(parseThemeFromCookieHeader(null)).toBe("light");
    expect(parseThemeFromCookieHeader("")).toBe("light");
    expect(parseThemeFromCookieHeader("insa_theme=dark")).toBe("dark");
    expect(parseThemeFromCookieHeader("insa_locale=fr; insa_theme=dark; session=abc")).toBe(
      "dark"
    );
    expect(parseThemeFromCookieHeader("insa_locale=en; insa_theme=light")).toBe("light");
    expect(parseThemeFromCookieHeader("insa_theme=sepia")).toBe("light");
    expect(parseThemeFromCookieHeader("other=dark")).toBe("light");
    expect(parseThemeFromCookieHeader("insa_theme=%20dark%20")).toBe("dark");
    expect(parseThemeFromCookieHeader("insa_theme=%E0%A4%A")).toBe("light");
  });
});

describe("theme i18n keys", () => {
  it("defines non-empty English and French theme labels", () => {
    for (const dict of [en, fr]) {
      expect(dict.common.themeLabel.trim().length).toBeGreaterThan(0);
      expect(dict.common.lightTheme.trim().length).toBeGreaterThan(0);
      expect(dict.common.darkTheme.trim().length).toBeGreaterThan(0);
      expect(dict.common.switchToLight.trim().length).toBeGreaterThan(0);
      expect(dict.common.switchToDark.trim().length).toBeGreaterThan(0);
      expect(dict.profile.themePrefHeading.trim().length).toBeGreaterThan(0);
      expect(dict.profile.themePrefHelp.trim().length).toBeGreaterThan(0);
    }
  });
});
