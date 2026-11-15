import { createMiddleware } from "@solidjs/start/middleware";
import { getEnv } from "~/server/env";

function applySecurityHeaders(headers: Headers, isHttpsRequest: boolean) {
  if (!headers.has("X-Content-Type-Options")) {
    headers.set("X-Content-Type-Options", "nosniff");
  }
  if (!headers.has("X-Frame-Options")) {
    headers.set("X-Frame-Options", "DENY");
  }
  if (!headers.has("Referrer-Policy")) {
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  }
  if (!headers.has("Permissions-Policy")) {
    headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  }
  if (isHttpsRequest && !headers.has("Strict-Transport-Security")) {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

export default createMiddleware([
  async (event, next) => {
    const forwardedProto = event.req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    let appUsesHttps = false;
    try {
      appUsesHttps = getEnv().appUrl.startsWith("https://");
    } catch {
      // Env errors surface loudly on dynamic route handlers
    }
    const isHttps = appUsesHttps && (forwardedProto === "https" || event.url.protocol === "https:");

    applySecurityHeaders(event.res.headers, isHttps);
    const response = await next();
    if (response instanceof Response) {
      try {
        applySecurityHeaders(response.headers, isHttps);
      } catch {
        // Ignore frozen/immutable Response header objects (e.g. redirects)
      }
    }
    return response;
  }
]);
