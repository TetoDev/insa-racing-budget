import type { APIEvent } from "@solidjs/start/server";
import { canCreateRequest } from "~/lib/permissions";
import { createRequestPayloadSchema } from "~/lib/schemas";
import { apiErrorResponse, assertSameOrigin, extractFiles } from "~/server/api-helpers";
import { requireUser } from "~/server/auth";
import { createPurchaseRequest } from "~/server/requests";

export async function POST(event: APIEvent) {
  try {
    assertSameOrigin(event);
    const user = await requireUser();
    if (!canCreateRequest(user.role)) {
      return Response.json(
        { error: "FORBIDDEN: Viewers cannot create purchase requests." },
        { status: 403 }
      );
    }

    const formData = await event.request.formData();
    const rawPayload = String(formData.get("payload") ?? "{}");
    let jsonPayload: unknown;
    try {
      jsonPayload = JSON.parse(rawPayload);
    } catch {
      return Response.json({ error: "Invalid request payload JSON." }, { status: 400 });
    }

    const parsed = createRequestPayloadSchema.safeParse(jsonPayload);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid purchase request fields." },
        { status: 400 }
      );
    }

    const photoFiles = extractFiles(formData, "photos");
    const documentFiles = extractFiles(formData, "documents");

    const created = await createPurchaseRequest(user, {
      title: parsed.data.title,
      quantity: parsed.data.quantity,
      department: parsed.data.department,
      carSystem: parsed.data.carSystem,
      explanation: parsed.data.explanation,
      options: parsed.data.options,
      photoFiles,
      documentFiles
    });

    return Response.json({ ok: true, id: created.id, requestCode: created.requestCode }, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
