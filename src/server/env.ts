import path from "node:path";

const DEV_DEFAULT_SESSION_SECRET =
  "insa_racing_dev_session_secret_please_override_in_production_32chars";

function looksLikePlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  return !trimmed || trimmed.includes("replace_with_");
}

function parseAppUrl(raw: string | undefined): string {
  const candidate = (raw || "http://localhost:3000").trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`Invalid APP_URL value: "${candidate}". Expected an http:// or https:// URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`APP_URL must start with http:// or https:// (got "${parsed.protocol}").`);
  }
  return candidate;
}

export interface AppEnv {
  isProd: boolean;
  appUrl: string;
  appHost: string;
  cookieSecure: boolean;
  sessionSecret: string;
  databaseUrl: string;
  masterEmail: string;
  masterPassword: string;
  masterName: string;
  masterTitle: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpIgnoreTls: boolean;
  smtpRequireAuth: boolean;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
  uploadDir: string;
  maxFileSizeBytes: number;
}

export function getEnv(): AppEnv {
  const isProd = process.env.NODE_ENV === "production";
  const rawSessionSecret = process.env.SESSION_SECRET?.trim() ?? "";

  if (isProd) {
    if (
      looksLikePlaceholder(rawSessionSecret) ||
      rawSessionSecret === DEV_DEFAULT_SESSION_SECRET ||
      rawSessionSecret.length < 32
    ) {
      throw new Error(
        "SESSION_SECRET must be explicitly set to a strong >=32-character secret in production."
      );
    }
  }

  const sessionSecret = rawSessionSecret || DEV_DEFAULT_SESSION_SECRET;
  const appUrl = parseAppUrl(process.env.APP_URL);
  const appHost = new URL(appUrl).host;

  const cookieSecureEnv = process.env.COOKIE_SECURE?.trim().toLowerCase();
  const cookieSecure =
    cookieSecureEnv === "true"
      ? true
      : cookieSecureEnv === "false"
        ? false
        : appUrl.startsWith("https://");

  const masterEmail = (process.env.MASTER_EMAIL || "master@insa-racing.fr").trim().toLowerCase();
  const rawMasterPassword = process.env.MASTER_PASSWORD ?? "";
  const masterPassword = rawMasterPassword || (isProd ? "" : "master-dev-password");
  if (isProd && (looksLikePlaceholder(masterPassword) || masterPassword.length < 8)) {
    throw new Error(
      "MASTER_PASSWORD must be explicitly configured (at least 8 characters or an scrypt: hash) in production."
    );
  }

  const databaseUrl =
    process.env.DATABASE_URL?.trim() ||
    "postgresql://insa_achats:insa_achats@localhost:5432/insa_achats";
  if (isProd && looksLikePlaceholder(databaseUrl)) {
    throw new Error("DATABASE_URL contains an unreplaced template placeholder in production.");
  }

  const maxFileMb = Number(process.env.MAX_FILE_SIZE_MB || "20");

  return {
    isProd,
    appUrl,
    appHost,
    cookieSecure,
    sessionSecret,
    databaseUrl,
    masterEmail,
    masterPassword,
    masterName: (process.env.MASTER_NAME || "Master Admin").trim(),
    masterTitle: (process.env.MASTER_TITLE || "Team Master").trim(),
    smtpHost: (process.env.SMTP_HOST || "").trim(),
    smtpPort: Number(process.env.SMTP_PORT || "465"),
    smtpSecure: (process.env.SMTP_SECURE || "true").toLowerCase() === "true",
    smtpIgnoreTls: (process.env.SMTP_IGNORE_TLS || "false").toLowerCase() === "true",
    smtpRequireAuth: (process.env.SMTP_AUTH || "true").toLowerCase() !== "false",
    smtpUser: (process.env.SMTP_USER || "contact@insa-racing.fr").trim(),
    smtpPass: process.env.SMTP_PASS || "",
    smtpFrom: (process.env.SMTP_FROM || "INSA Racing Achats <contact@insa-racing.fr>").trim(),
    uploadDir: path.resolve(process.env.UPLOAD_DIR || "./data/uploads"),
    maxFileSizeBytes: (Number.isFinite(maxFileMb) && maxFileMb > 0 ? maxFileMb : 20) * 1024 * 1024
  };
}
