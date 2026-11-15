const MAX_TRACKED_KEYS = 10_000;

interface RateLimitBucket {
  timestamps: number[];
  windowMs: number;
}

const buckets = new Map<string, RateLimitBucket>();

function pruneStaleBuckets(now: number): void {
  for (const [key, bucket] of buckets.entries()) {
    const cutoff = now - bucket.windowMs;
    while (bucket.timestamps.length > 0 && bucket.timestamps[0] <= cutoff) {
      bucket.timestamps.shift();
    }
    if (bucket.timestamps.length === 0) {
      buckets.delete(key);
    }
  }
}

/**
 * Extracts a client IP address safely behind reverse proxies (Caddy / Nginx).
 */
export function extractClientIp(headers: Headers | Record<string, string | undefined>, fallback?: string): string {
  const getHeader = (name: string): string | undefined => {
    if (headers instanceof Headers) {
      return headers.get(name) ?? undefined;
    }
    return headers[name] ?? headers[name.toLowerCase()];
  };

  const xff = getHeader("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = getHeader("x-real-ip")?.trim();
  if (realIp) return realIp;
  return fallback?.trim() || "unknown";
}

/**
 * Sliding-window in-memory rate limiter for authentication & SMTP-triggering endpoints.
 */
export function consumeRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number,
  now = Date.now()
): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  if (buckets.size >= MAX_TRACKED_KEYS && !buckets.has(key)) {
    pruneStaleBuckets(now);
    if (buckets.size >= MAX_TRACKED_KEYS) {
      const oldestKey = buckets.keys().next().value;
      if (oldestKey !== undefined) {
        buckets.delete(oldestKey);
      }
    }
  }

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { timestamps: [], windowMs };
    buckets.set(key, bucket);
  } else {
    bucket.windowMs = windowMs;
  }

  const cutoff = now - windowMs;
  while (bucket.timestamps.length > 0 && bucket.timestamps[0] <= cutoff) {
    bucket.timestamps.shift();
  }

  if (bucket.timestamps.length >= maxAttempts) {
    const oldest = bucket.timestamps[0] ?? now;
    const retryAfterMs = Math.max(1000, windowMs - (now - oldest));
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000)
    };
  }

  bucket.timestamps.push(now);
  return {
    allowed: true,
    remaining: Math.max(0, maxAttempts - bucket.timestamps.length),
    retryAfterSeconds: 0
  };
}

export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

export function clearAllRateLimits(): void {
  buckets.clear();
}
