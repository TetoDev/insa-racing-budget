import type { APIEvent } from "@solidjs/start/server";
import { eq } from "drizzle-orm";
import { apiErrorResponse } from "~/server/api-helpers";
import { requireUser } from "~/server/auth";
import { getDb } from "~/server/db";
import { attachments } from "~/server/db/schema";
import { isInlineSafeMime, readStoredFile } from "~/server/storage";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(event: APIEvent) {
  try {
    await requireUser();
    const id = event.params.id;
    if (!id || !UUID_RE.test(id)) {
      return Response.json({ error: "Invalid file id." }, { status: 400 });
    }

    const db = getDb();
    const [att] = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1);
    if (!att) {
      return Response.json({ error: "File not found." }, { status: 404 });
    }

    const buffer = await readStoredFile(att.storageKey);
    const url = new URL(event.request.url);
    const wantsInline = url.searchParams.get("inline") === "1";
    const dispositionType = wantsInline && isInlineSafeMime(att.mimeType) ? "inline" : "attachment";
    const asciiFallback =
      att.originalName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\;]/g, "_") || "download";
    const safeFilename = encodeURIComponent(att.originalName);

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": att.mimeType,
        "Content-Length": String(buffer.length),
        "Content-Disposition": `${dispositionType}; filename="${asciiFallback}"; filename*=UTF-8''${safeFilename}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600"
      }
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return Response.json({ error: "Stored file missing from storage." }, { status: 404 });
    }
    return apiErrorResponse(err);
  }
}
