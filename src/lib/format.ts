import type { Locale } from "./i18n/types";

const eurFormatters: Record<Locale, Intl.NumberFormat> = {
  en: new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }),
  fr: new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
};

export function formatEur(cents: number, locale: Locale = "fr"): string {
  const normalized = Number.isFinite(cents) ? Math.round(cents) : 0;
  return (eurFormatters[locale] ?? eurFormatters.fr).format(normalized / 100);
}

export function formatCentsPlain(cents: number): string {
  const normalized = Number.isFinite(cents) ? Math.round(cents) : 0;
  return (normalized / 100).toFixed(2);
}

/**
 * Parses a human-entered Euro string (e.g. "1 234,50", "1234.5", "42") into integer cents.
 * Returns null if invalid or negative (unless allowNegative is true).
 */
export function parseEurToCents(
  raw: string | number,
  options?: { allowZero?: boolean; allowNegative?: boolean }
): number | null {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    const cents = Math.round(raw * 100);
    if (!options?.allowNegative && cents < 0) return null;
    if (!options?.allowZero && cents === 0) return null;
    return cents;
  }
  const cleaned = raw
    .trim()
    .replace(/[\s\u00A0\u202F€]/g, "")
    .replace(",", ".");
  if (!cleaned || !/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
    return null;
  }
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return null;
  const cents = Math.round(num * 100);
  if (!options?.allowNegative && cents < 0) return null;
  if (!options?.allowZero && cents === 0) return null;
  return cents;
}

export function formatDate(
  isoOrDate: string | Date | null | undefined,
  locale: Locale = "en"
): string {
  if (!isoOrDate) return "—";
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit"
  }).format(d);
}

export function formatDateTime(
  isoOrDate: string | Date | null | undefined,
  locale: Locale = "en"
): string {
  if (!isoOrDate) return "—";
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(d);
}

export function formatBytes(bytes: number, locale: Locale = "en"): string {
  if (bytes < 1024) return `${bytes} ${locale === "fr" ? "o" : "B"}`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ${locale === "fr" ? "Ko" : "KB"}`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} ${locale === "fr" ? "Mo" : "MB"}`;
}

export function slugifyFilename(input: string, maxLen = 40): string {
  return (
    input
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, maxLen) || "item"
  );
}

export function toIsoDateInput(isoOrDate: string | Date | null | undefined): string {
  if (!isoOrDate) return new Date().toISOString().slice(0, 10);
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/** Formats an ISO timestamp or Date for an HTML `<input type="datetime-local">` in local time. */
export function toDateTimeLocalInput(isoOrDate: string | Date | null | undefined): string {
  if (!isoOrDate) return "";
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Converts an HTML `<input type="datetime-local">` or ISO string into UTC ISO-8601, or null if blank. */
export function fromDateTimeLocalInput(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  const d = new Date(raw.trim());
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
