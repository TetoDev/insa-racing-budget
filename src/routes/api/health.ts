import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { getSql } from "~/server/db";
import { ensureDbReady } from "~/server/db/bootstrap";
import { getEnv } from "~/server/env";

export async function GET() {
  try {
    const env = getEnv();
    await ensureDbReady();
    const sql = getSql();
    await sql`SELECT 1`;
    await fs.mkdir(env.uploadDir, { recursive: true });
    await fs.access(env.uploadDir, fsConstants.R_OK | fsConstants.W_OK);
    return Response.json({ ok: true, status: "healthy" }, { status: 200 });
  } catch (err) {
    console.error("[health] Readiness check failed:", err);
    const isProd = process.env.NODE_ENV === "production";
    const message =
      !isProd && err instanceof Error ? err.message : "Service dependencies unavailable";
    return Response.json({ ok: false, status: "unhealthy", error: message }, { status: 503 });
  }
}
