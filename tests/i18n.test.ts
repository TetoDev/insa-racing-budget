import { describe, expect, it } from "vitest";
import {
  ASSIGNABLE_ROLES,
  BUDGET_SECTIONS,
  DEPARTMENTS,
  ENTRY_CATEGORIES,
  ENTRY_STATUSES,
  RATE_PERIODS,
  REQUEST_STATUSES,
  SEASON_STATUSES
} from "~/lib/constants";
import { formatBytes, formatDate, formatDateTime, formatEur } from "~/lib/format";
import {
  en,
  formatCarSystemDisplay,
  formatTimeBucketLabel,
  fr,
  getAuditActionLabel,
  getBudgetGroupLabel,
  getBudgetSectionLabel,
  getDepartmentLabel,
  getDictionary,
  getEntryCategoryLabel,
  getEntryStatusLabel,
  getRatePeriodLabel,
  getRequestStatusLabel,
  getRoleLabel,
  getSeasonStatusLabel,
  getTimelineEventLabel,
  getUserStatusLabel,
  LOCALE_COOKIE_NAME,
  normalizeLocale,
  parseLocaleFromCookieHeader
} from "~/lib/i18n";
import { exportConfigSchema } from "~/lib/schemas";

function collectShape(obj: unknown, prefix = ""): Array<{ path: string; kind: string }> {
  if (typeof obj === "string") {
    return [{ path: prefix, kind: "string" }];
  }
  if (typeof obj === "function") {
    return [{ path: prefix, kind: `function(${obj.length})` }];
  }
  if (Array.isArray(obj)) {
    return [{ path: prefix, kind: `array(${obj.length})` }];
  }
  if (obj && typeof obj === "object") {
    return Object.entries(obj)
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([k, v]) => collectShape(v, prefix ? `${prefix}.${k}` : k));
  }
  return [{ path: prefix, kind: typeof obj }];
}

function collectStrings(obj: unknown, prefix = ""): Array<{ path: string; value: string }> {
  if (typeof obj === "string") {
    return [{ path: prefix, value: obj }];
  }
  if (Array.isArray(obj)) {
    return obj.flatMap((v, idx) => collectStrings(v, `${prefix}[${idx}]`));
  }
  if (obj && typeof obj === "object") {
    return Object.entries(obj).flatMap(([k, v]) =>
      collectStrings(v, prefix ? `${prefix}.${k}` : k)
    );
  }
  return [];
}

describe("i18n locale parsing & dictionaries", () => {
  it("normalizes supported locales cleanly and defaults unknown inputs to en", () => {
    expect(normalizeLocale(undefined)).toBe("en");
    expect(normalizeLocale(null)).toBe("en");
    expect(normalizeLocale("")).toBe("en");
    expect(normalizeLocale("de-DE")).toBe("en");
    expect(normalizeLocale("en")).toBe("en");
    expect(normalizeLocale("EN-US")).toBe("en");
    expect(normalizeLocale("fr")).toBe("fr");
    expect(normalizeLocale("FR-fr")).toBe("fr");
  });

  it("parses locale reliably from raw Cookie headers", () => {
    expect(parseLocaleFromCookieHeader(undefined)).toBe("en");
    expect(parseLocaleFromCookieHeader("")).toBe("en");
    expect(parseLocaleFromCookieHeader(`${LOCALE_COOKIE_NAME}=fr`)).toBe("fr");
    expect(
      parseLocaleFromCookieHeader(`insa_session=xyz; ${LOCALE_COOKIE_NAME}=fr-FR; other=1`)
    ).toBe("fr");
    expect(parseLocaleFromCookieHeader(`${LOCALE_COOKIE_NAME}=es`)).toBe("en");
  });

  it("maintains identical nested structure and arities between EN and FR dictionaries", () => {
    const enShape = collectShape(en);
    const frShape = collectShape(fr);
    expect(frShape).toEqual(enShape);
  });

  it("contains only non-empty translation strings in both locales", () => {
    for (const [localeName, dict] of [
      ["en", getDictionary("en")],
      ["fr", getDictionary("fr")]
    ] as const) {
      const entries = collectStrings(dict);
      expect(entries.length).toBeGreaterThan(200);
      for (const item of entries) {
        expect(item.value.trim().length, `${localeName}:${item.path} must be non-empty`).toBeGreaterThan(
          0
        );
      }
    }
  });

  it("provides translations for all domain enums, groups, timeline events, and audit actions", () => {
    for (const locale of ["en", "fr"] as const) {
      for (const dept of DEPARTMENTS) {
        expect(getDepartmentLabel(locale, dept.id).length).toBeGreaterThan(0);
      }
      for (const role of [...ASSIGNABLE_ROLES, "master"] as const) {
        expect(getRoleLabel(locale, role).length).toBeGreaterThan(0);
      }
      for (const status of ["invited", "active", "suspended"] as const) {
        expect(getUserStatusLabel(locale, status).length).toBeGreaterThan(0);
      }
      for (const status of SEASON_STATUSES) {
        expect(getSeasonStatusLabel(locale, status).length).toBeGreaterThan(0);
      }
      for (const status of REQUEST_STATUSES) {
        expect(getRequestStatusLabel(locale, status).length).toBeGreaterThan(0);
      }
      for (const cat of ENTRY_CATEGORIES) {
        expect(getEntryCategoryLabel(locale, cat.id).length).toBeGreaterThan(0);
      }
      for (const status of ENTRY_STATUSES) {
        expect(getEntryStatusLabel(locale, status).length).toBeGreaterThan(0);
      }
      for (const sec of BUDGET_SECTIONS) {
        expect(getBudgetSectionLabel(locale, sec.id).length).toBeGreaterThan(0);
      }
      for (const grp of ["Overview", "Spendings", "Entries", "Cashflow"] as const) {
        expect(getBudgetGroupLabel(locale, grp).length).toBeGreaterThan(0);
      }
      for (const period of RATE_PERIODS) {
        expect(getRatePeriodLabel(locale, period, "noun").length).toBeGreaterThan(0);
        expect(getRatePeriodLabel(locale, period, "adj").length).toBeGreaterThan(0);
      }
      expect(getTimelineEventLabel(locale, "approver_approve")).not.toBe("approver_approve");
      expect(getAuditActionLabel(locale, "master_request_edited").length).toBeGreaterThan(0);
    }
    expect(getAuditActionLabel("fr", "master_request_edited")).not.toBe("master_request_edited");
  });
});

describe("locale-aware formatters & schema", () => {
  it("formats EUR amounts differently in EN and FR", () => {
    const enFormatted = formatEur(123456, "en");
    const frFormatted = formatEur(123456, "fr").replace(/[\u00a0\u202f]/g, " ");
    expect(enFormatted).toContain("1,234.56");
    expect(enFormatted).toContain("€");
    expect(frFormatted).toContain("234,56");
    expect(frFormatted).toContain("€");
  });

  it("formats bytes with locale units (KB vs Ko)", () => {
    expect(formatBytes(512, "en")).toBe("512 B");
    expect(formatBytes(512, "fr")).toBe("512 o");
    expect(formatBytes(1536, "en")).toBe("1.5 KB");
    expect(formatBytes(1536, "fr")).toBe("1.5 Ko");
    expect(formatBytes(2 * 1024 * 1024, "en")).toBe("2.0 MB");
    expect(formatBytes(2 * 1024 * 1024, "fr")).toBe("2.0 Mo");
  });

  it("formats dates and date-times properly for both locales", () => {
    const enDate = formatDate("2026-03-15T14:30:00Z", "en");
    const frDate = formatDate("2026-03-15T14:30:00Z", "fr");
    expect(enDate).toContain("2026");
    expect(frDate).toContain("2026");
    expect(frDate.toLowerCase()).toContain("mars");
    expect(formatDateTime("2026-03-15T14:30:00Z", "fr")).toContain("2026");
  });

  it("formats chart period bucket labels in EN and FR", () => {
    expect(formatTimeBucketLabel("2026-Q1", "2026-Q1", "quarter", "en")).toBe("Q1 2026");
    expect(formatTimeBucketLabel("2026-Q1", "2026-Q1", "quarter", "fr")).toBe("T1 2026");
    expect(formatTimeBucketLabel("2026-W09", "W09", "week", "en")).toBe("W/2026-W09");
    expect(formatTimeBucketLabel("2026-W09", "W09", "week", "fr")).toBe("S/2026-W09");
    expect(formatTimeBucketLabel("2026-02", "2026-02", "month", "fr").toLowerCase()).toContain("févr");
  });

  it("localizes Unspecified Subsystem sentinel without mutating custom system names", () => {
    expect(formatCarSystemDisplay("Unspecified Subsystem", "en")).toBe("Unspecified Subsystem");
    expect(formatCarSystemDisplay("Unspecified Subsystem", "fr")).toBe(
      getDictionary("fr").domain.unspecifiedSubsystem
    );
    expect(formatCarSystemDisplay("Front Wing", "fr")).toBe("Front Wing");
  });

  it("accepts optional locale on exportConfigSchema", () => {
    const base = {
      seasonId: "11111111-1111-4111-8111-111111111111",
      format: "xlsx",
      sections: ["summary"]
    };
    expect(exportConfigSchema.safeParse(base).success).toBe(true);
    expect(exportConfigSchema.safeParse({ ...base, locale: "fr" }).success).toBe(true);
    expect(exportConfigSchema.safeParse({ ...base, locale: "en" }).success).toBe(true);
    expect(exportConfigSchema.safeParse({ ...base, locale: "de" }).success).toBe(false);
  });
});
