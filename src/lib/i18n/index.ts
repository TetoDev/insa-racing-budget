import type {
  BudgetSectionId,
  DepartmentId,
  EntryCategory,
  EntryStatus,
  RatePeriod,
  RequestStatus,
  SeasonStatus,
  UserRole,
  UserStatus
} from "~/lib/constants";
import { en, type TranslationDict } from "./en";
import { fr } from "./fr";
import { LOCALE_COOKIE_NAME, type Locale } from "./types";

export { en, fr, LOCALE_COOKIE_NAME };
export type { Locale, TranslationDict };

const DICTIONARIES: Record<Locale, TranslationDict> = {
  en,
  fr
};

export function normalizeLocale(raw: unknown): Locale {
  if (typeof raw !== "string") return "en";
  const lower = raw.trim().toLowerCase();
  if (lower === "fr" || lower.startsWith("fr-")) return "fr";
  return "en";
}

export function getDictionary(locale: Locale): TranslationDict {
  return DICTIONARIES[locale] ?? en;
}

export function parseLocaleFromCookieHeader(cookieHeader: string | null | undefined): Locale {
  if (!cookieHeader) return "en";
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    if (key === LOCALE_COOKIE_NAME) {
      const val = part.slice(eqIdx + 1).trim();
      try {
        return normalizeLocale(decodeURIComponent(val));
      } catch {
        return normalizeLocale(val);
      }
    }
  }
  return "en";
}

export function readLocaleFromDocumentCookie(): Locale {
  if (typeof document === "undefined") return "en";
  return parseLocaleFromCookieHeader(document.cookie);
}

export function writeLocaleDocumentCookie(locale: Locale): void {
  if (typeof document === "undefined") return;
  const secure =
    typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${LOCALE_COOKIE_NAME}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}

export function getDepartmentLabel(locale: Locale, id: DepartmentId): string {
  return getDictionary(locale).domain.departments[id] ?? id;
}

export function getRoleLabel(locale: Locale, role: UserRole): string {
  return getDictionary(locale).domain.roles[role] ?? role;
}

export function getUserStatusLabel(locale: Locale, status: UserStatus): string {
  return getDictionary(locale).domain.userStatuses[status] ?? status;
}

export function getSeasonStatusLabel(locale: Locale, status: SeasonStatus): string {
  return getDictionary(locale).domain.seasonStatuses[status] ?? status;
}

export function getRequestStatusLabel(locale: Locale, status: RequestStatus): string {
  return getDictionary(locale).domain.requestStatuses[status] ?? status;
}

export function getEntryCategoryLabel(locale: Locale, category: EntryCategory): string {
  return getDictionary(locale).domain.entryCategories[category] ?? category;
}

export function getEntryStatusLabel(locale: Locale, status: EntryStatus): string {
  return getDictionary(locale).domain.entryStatuses[status] ?? status;
}

export function getBudgetSectionLabel(locale: Locale, id: BudgetSectionId): string {
  return getDictionary(locale).domain.budgetSections[id] ?? id;
}

export function getBudgetGroupLabel(
  locale: Locale,
  group: "Overview" | "Spendings" | "Entries" | "Cashflow"
): string {
  return getDictionary(locale).domain.budgetGroups[group] ?? group;
}

export function getRatePeriodLabel(
  locale: Locale,
  period: RatePeriod,
  variant: "noun" | "adj" = "noun"
): string {
  return getDictionary(locale).domain.ratePeriods[period]?.[variant] ?? period;
}

export function getAttachmentKindLabel(locale: Locale, kind: string): string {
  const map = getDictionary(locale).domain.attachmentKinds as Record<string, string>;
  return map[kind] ?? kind;
}

export function getTimelineEventLabel(locale: Locale, eventType: string): string {
  return getDictionary(locale).domain.timelineEvents[eventType] ?? eventType;
}

export function getAuditActionLabel(locale: Locale, action: string): string {
  return getDictionary(locale).domain.auditActions[action] ?? action;
}

export function formatCarSystemDisplay(carSystem: string, locale: Locale): string {
  if (carSystem === "Unspecified Subsystem") {
    return getDictionary(locale).domain.unspecifiedSubsystem;
  }
  return carSystem;
}

export function formatTimeBucketLabel(
  bucketKey: string,
  fallbackLabel: string,
  period: RatePeriod,
  locale: Locale
): string {
  if (period === "month") {
    const match = bucketKey.match(/^(\d{4})-(\d{2})$/);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
        year: "numeric",
        month: "short",
        timeZone: "UTC"
      }).format(new Date(Date.UTC(year, month - 1, 1)));
    }
  }
  if (period === "week" && bucketKey) {
    return locale === "fr" ? `S/${bucketKey}` : `W/${bucketKey}`;
  }
  if (period === "quarter") {
    const match = bucketKey.match(/^(\d{4})-Q([1-4])$/);
    if (match) {
      return locale === "fr" ? `T${match[2]} ${match[1]}` : `Q${match[2]} ${match[1]}`;
    }
  }
  return fallbackLabel;
}
