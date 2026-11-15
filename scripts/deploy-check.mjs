#!/usr/bin/env node
import { randomBytes, scrypt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEV_DEFAULT_SESSION_SECRET =
  "insa_racing_dev_session_secret_please_override_in_production_32chars";
const SCRYPT_OPTIONS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function hashMasterPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16);
    scrypt(password, salt, 64, SCRYPT_OPTIONS, (err, key) => {
      if (err) reject(err);
      else resolve(`scrypt:${salt.toString("hex")}:${key.toString("hex")}`);
    });
  });
}

function parseDotEnv(content) {
  const env = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
      (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

function isPlaceholder(val) {
  return !val || val.trim() === "" || val.includes("replace_with_");
}

async function run() {
  const args = process.argv.slice(2);

  if (args.includes("--generate-secrets")) {
    const sessionSecret = randomBytes(32).toString("hex");
    const dbPassword = randomBytes(24).toString("base64url");
    console.log(`SESSION_SECRET=${sessionSecret}`);
    console.log(`POSTGRES_PASSWORD=${dbPassword}`);
    return;
  }

  const hashFlagIdx = args.indexOf("--hash-password");
  if (hashFlagIdx !== -1) {
    const plain = args[hashFlagIdx + 1];
    if (!plain || plain.length < 8) {
      console.error("Usage: npm run deploy:hash-password -- \"<YourPasswordAtLeast8Chars>\"");
      process.exit(1);
    }
    const hashed = await hashMasterPassword(plain);
    console.log(`MASTER_PASSWORD=${hashed}`);
    return;
  }

  const envIdx = args.indexOf("--env");
  const envPath = path.resolve(envIdx !== -1 && args[envIdx + 1] ? args[envIdx + 1] : ".env");
  const verifySmtp = args.includes("--verify-smtp");

  if (!fs.existsSync(envPath)) {
    console.error(`FAIL: Environment file not found at ${envPath}`);
    console.error("Run `cp .env.example .env`, edit your secrets, and re-run `npm run deploy:check`.");
    process.exit(1);
  }

  const env = parseDotEnv(fs.readFileSync(envPath, "utf8"));
  const errors = [];
  const warnings = [];

  if (isPlaceholder(env.APP_URL)) {
    errors.push("APP_URL is missing.");
  } else {
    try {
      const parsed = new URL(env.APP_URL);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        errors.push(`APP_URL must start with https:// or http:// (got "${env.APP_URL}").`);
      } else if (parsed.protocol === "http:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
        warnings.push("APP_URL uses http:// on a non-local host; use https:// in production for secure cookies and HSTS.");
      }
    } catch {
      errors.push(`APP_URL is not a valid URL: "${env.APP_URL}".`);
    }
  }

  if (
    isPlaceholder(env.SESSION_SECRET) ||
    env.SESSION_SECRET === DEV_DEFAULT_SESSION_SECRET ||
    env.SESSION_SECRET.length < 32
  ) {
    errors.push(
      "SESSION_SECRET must be replaced with a random secret of at least 32 characters (run `openssl rand -hex 32` or `npm run deploy:check -- --generate-secrets`)."
    );
  }

  if (isPlaceholder(env.MASTER_EMAIL) || !env.MASTER_EMAIL.includes("@")) {
    errors.push("MASTER_EMAIL must be a valid email address.");
  }

  if (isPlaceholder(env.MASTER_PASSWORD) || env.MASTER_PASSWORD.length < 8) {
    errors.push("MASTER_PASSWORD must be configured (at least 8 characters or an scrypt: hash).");
  } else if (!env.MASTER_PASSWORD.startsWith("scrypt:")) {
    warnings.push(
      "MASTER_PASSWORD is stored in plaintext in .env; you can optionally replace it with an scrypt hash via `npm run deploy:hash-password`."
    );
  }

  if (isPlaceholder(env.POSTGRES_PASSWORD)) {
    errors.push("POSTGRES_PASSWORD must be set in .env before running docker compose.");
  } else if (!env.DATABASE_URL && /[@:/?#%\s]/.test(env.POSTGRES_PASSWORD)) {
    errors.push(
      "POSTGRES_PASSWORD contains URL-special characters (@:/?#% or spaces) without a URL-encoded DATABASE_URL override. Use alphanumeric/base64url characters (e.g. from `--generate-secrets`)."
    );
  }

  if (env.DATABASE_URL) {
    if (isPlaceholder(env.DATABASE_URL)) {
      errors.push("DATABASE_URL still contains a template placeholder (`replace_with_...`).");
    } else if (!env.DATABASE_URL.startsWith("postgresql://") && !env.DATABASE_URL.startsWith("postgres://")) {
      errors.push("DATABASE_URL must start with postgresql:// or postgres://.");
    }
  }

  if (!env.SMTP_HOST) {
    warnings.push("SMTP_HOST is empty — invite and password-reset emails will fall back to manual links.");
  } else if (isPlaceholder(env.SMTP_PASS)) {
    warnings.push("SMTP_PASS is not configured — invite links will print cleanly as manual setup URLs until filled in.");
  }

  for (const w of warnings) {
    console.warn(`WARN: ${w}`);
  }
  for (const e of errors) {
    console.error(`ERROR: ${e}`);
  }

  if (errors.length > 0) {
    console.error(`\nDeployment check failed with ${errors.length} error(s).`);
    process.exit(1);
  }

  if (verifySmtp) {
    if (!env.SMTP_HOST || isPlaceholder(env.SMTP_PASS)) {
      console.error("ERROR: Cannot run --verify-smtp without SMTP_HOST and SMTP_PASS in .env.");
      process.exit(1);
    }
    const { default: nodemailer } = await import("nodemailer");
    const port = Number(env.SMTP_PORT || "465");
    const secure = (env.SMTP_SECURE || "true").toLowerCase() === "true";
    const ignoreTls = (env.SMTP_IGNORE_TLS || "false").toLowerCase() === "true";
    const transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port,
      secure,
      ignoreTLS: ignoreTls,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      ...(!ignoreTls ? { tls: { minVersion: "TLSv1.2" } } : {}),
      auth: {
        user: env.SMTP_USER || "contact@insa-racing.fr",
        pass: env.SMTP_PASS
      }
    });
    console.log(`Verifying SMTP connection to ${env.SMTP_HOST}:${port} (secure=${secure})...`);
    await transporter.verify();
    console.log("OK: SMTP connection and credentials verified.");
  }

  console.log(`OK: Deployment configuration in ${envPath} is valid.`);
}

run().catch(err => {
  console.error("ERROR:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
