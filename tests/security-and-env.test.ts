import { afterEach, describe, expect, it } from "vitest";
import { assertSameOrigin } from "~/server/api-helpers";
import { getEnv } from "~/server/env";
import {
  clearAllRateLimits,
  consumeRateLimit,
  extractClientIp,
  resetRateLimit
} from "~/server/rate-limit";

const SAVED_ENV_KEYS = [
  "NODE_ENV",
  "APP_URL",
  "SESSION_SECRET",
  "COOKIE_SECURE",
  "MASTER_PASSWORD",
  "DATABASE_URL"
] as const;

const snapshotEnv: Record<string, string | undefined> = {};
for (const k of SAVED_ENV_KEYS) {
  snapshotEnv[k] = process.env[k];
}

afterEach(() => {
  for (const k of SAVED_ENV_KEYS) {
    if (snapshotEnv[k] === undefined) delete process.env[k];
    else process.env[k] = snapshotEnv[k];
  }
  clearAllRateLimits();
});

describe("production env validation, CSRF origin checks & rate limiter", () => {
  it("enforces non-placeholder secrets in production and respects COOKIE_SECURE", () => {
    process.env.NODE_ENV = "production";
    process.env.APP_URL = "https://achats.insa-racing.fr";
    process.env.SESSION_SECRET = "a_very_strong_random_secret_at_least_32_characters_long";
    process.env.MASTER_PASSWORD = "StrongMasterPassword123";
    process.env.DATABASE_URL = "postgresql://insa_achats:secret123@postgres:5432/insa_achats";
    delete process.env.COOKIE_SECURE;

    const prodEnv = getEnv();
    expect(prodEnv.cookieSecure).toBe(true);
    expect(prodEnv.appHost).toBe("achats.insa-racing.fr");

    process.env.COOKIE_SECURE = "false";
    expect(getEnv().cookieSecure).toBe(false);

    process.env.SESSION_SECRET = "replace_with_a_64_char_random_hex_secret_at_least_32_bytes";
    expect(() => getEnv()).toThrow(/SESSION_SECRET/);

    process.env.SESSION_SECRET = "a_very_strong_random_secret_at_least_32_characters_long";
    process.env.MASTER_PASSWORD = "replace_with_a_strong_master_password";
    expect(() => getEnv()).toThrow(/MASTER_PASSWORD/);

    process.env.MASTER_PASSWORD = "StrongMasterPassword123";
    process.env.DATABASE_URL = "postgresql://insa_achats:replace_with_strong_db_password@postgres:5432/insa_achats";
    expect(() => getEnv()).toThrow(/DATABASE_URL/);
  });

  it("validates same-origin POST requests behind multi-hop proxies and blocks cross-origin requests", () => {
    process.env.NODE_ENV = "test";
    process.env.APP_URL = "https://achats.insa-racing.fr";

    const okProxyEvent = {
      request: new Request("http://127.0.0.1:3000/api/requests", {
        method: "POST",
        headers: {
          origin: "https://achats.insa-racing.fr",
          "x-forwarded-host": "achats.insa-racing.fr, 10.0.0.2"
        }
      })
    } as never;
    expect(() => assertSameOrigin(okProxyEvent)).not.toThrow();

    const evilEvent = {
      request: new Request("http://127.0.0.1:3000/api/requests", {
        method: "POST",
        headers: {
          origin: "https://evil.example.com",
          host: "achats.insa-racing.fr"
        }
      })
    } as never;
    expect(() => assertSameOrigin(evilEvent)).toThrow(/Cross-origin/);
  });

  it("tracks sliding-window rate limits, resets cleanly, and extracts client IP", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.45, 10.0.0.1" });
    expect(extractClientIp(headers, "127.0.0.1")).toBe("203.0.113.45");

    const t0 = 1_700_000_000_000;
    expect(consumeRateLimit("login:test", 2, 60_000, t0)).toEqual({
      allowed: true,
      remaining: 1,
      retryAfterSeconds: 0
    });
    expect(consumeRateLimit("login:test", 2, 60_000, t0 + 1000)).toEqual({
      allowed: true,
      remaining: 0,
      retryAfterSeconds: 0
    });
    const blocked = consumeRateLimit("login:test", 2, 60_000, t0 + 2000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

    // Sliding window expires old entry
    expect(consumeRateLimit("login:test", 2, 60_000, t0 + 60_001).allowed).toBe(true);

    // Explicit reset unlocks immediately
    resetRateLimit("login:test");
    expect(consumeRateLimit("login:test", 2, 60_000, t0 + 60_002).remaining).toBe(1);
  });
});
