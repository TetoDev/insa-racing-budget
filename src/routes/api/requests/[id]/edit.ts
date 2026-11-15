import type { APIEvent } from "@solidjs/start/server";
import { editRequestPayloadSchema } from "~/lib/schemas";
import { apiErrorResponse, assertSameOrigin, extractFiles } from "~/server/api-helpers";
import { requireUser } from "~/server/auth";
import { editUnreviewedPurchaseRequest } from "~/server/requests";

export async function POST(event: APIEvent) {
  try {
    assertSameOrigin(event);
    const user = await requireUser();
    const requestId = event.params.id;
    const formData = await event.request.formData();

    let jsonPayload: unknown;
    try {
      jsonPayload = JSON.parse(String(formData.get("payload") ?? "{}"));
    } catch {
      return Response.json({ error: "Invalid payload JSON." }, { status: 400 });
    }

    const parsed = editRequestPayloadSchema.safeParse(jsonPayload);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid edit request fields." },
        { status: 400 }
      );
    }

    await editUnreviewedPurchaseRequest(user, {
      requestId,
      title: parsed.data.title,
      carSystem: parsed.data.carSystem,
      explanation: parsed.data.explanation,
      options: parsed.data.options,
      newPhotoFiles: extractFiles(formData, "photos"),
      newDocumentFiles: extractFiles(formData, "documents"),
      removeAttachmentIds: parsed.data.removeAttachmentIds
    });

    return Response.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
