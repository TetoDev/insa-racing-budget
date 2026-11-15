import type { APIEvent } from "@solidjs/start/server";
import { getEnv } from "./env";

export function apiErrorResponse(err: unknown): Response {
  const msg = err instanceof Error ? err.message : "Unexpected server error";
  if (msg === "UNAUTHORIZED") {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }
  if (msg.startsWith("FORBIDDEN")) {
    return Response.json({ error: msg }, { status: 403 });
  }
  if (msg.startsWith("RATE_LIMITED:")) {
    return Response.json({ error: msg.slice("RATE_LIMITED:".length).trim() }, { status: 429 });
  }
  return Response.json({ error: msg }, { status: 400 });
}

export function assertSameOrigin(event: APIEvent): void {
  const req = event.request;
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (!origin) return;

  const url = new URL(req.url);
  const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const hostHeader = req.headers.get("host")?.trim();
  const allowedHosts = new Set<string>([url.host]);
  if (forwardedHost) allowedHosts.add(forwardedHost);
  if (hostHeader) allowedHosts.add(hostHeader);

  try {
    allowedHosts.add(getEnv().appHost);
  } catch {
    // Ignore env errors in pure unit/edge calls; request hosts still apply
  }

  try {
    const parsedOrigin = new URL(origin);
    if (!allowedHosts.has(parsedOrigin.host)) {
      throw new Error("FORBIDDEN: Cross-origin request rejected.");
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("FORBIDDEN")) throw err;
    throw new Error("FORBIDDEN: Invalid origin header.");
  }
}

export function extractFiles(formData: FormData, fieldName: string): File[] {
  const items = formData.getAll(fieldName);
  const files: File[] = [];
  for (const item of items) {
    if (item instanceof File && item.size > 0) {
      files.push(item);
    }
  }
  return files;
}
