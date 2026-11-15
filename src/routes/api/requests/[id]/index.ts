import type { APIEvent } from "@solidjs/start/server";
import { masterDeleteRecordSchema } from "~/lib/schemas";
import { apiErrorResponse, assertSameOrigin } from "~/server/api-helpers";
import { requireMaster } from "~/server/auth";
import { masterDeletePurchaseRequest } from "~/server/requests";

export async function DELETE(event: APIEvent) {
  try {
    assertSameOrigin(event);
    const master = await requireMaster();
    const requestId = event.params.id;

    let body: unknown = {};
    try {
      const text = await event.request.text();
      if (text.trim()) body = JSON.parse(text);
    } catch {
      return Response.json({ error: "Invalid deletion payload JSON." }, { status: 400 });
    }

    const parsed = masterDeleteRecordSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid deletion request." },
        { status: 400 }
      );
    }

    const deleted = await masterDeletePurchaseRequest(master, requestId, parsed.data.reason);
    return Response.json({ ok: true, deleted });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
