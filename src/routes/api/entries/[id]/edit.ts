import type { APIEvent } from "@solidjs/start/server";
import { canManageBudgetEntries } from "~/lib/permissions";
import { editProvisionalEntrySchema } from "~/lib/schemas";
import { apiErrorResponse, assertSameOrigin, extractFiles } from "~/server/api-helpers";
import { requireUser } from "~/server/auth";
import { editProvisionalEntry } from "~/server/budget";

export async function POST(event: APIEvent) {
  try {
    assertSameOrigin(event);
    const user = await requireUser();
    if (!canManageBudgetEntries(user.role)) {
      return Response.json(
        { error: "FORBIDDEN: Only approvers and Master can edit money entries." },
        { status: 403 }
      );
    }

    const entryId = event.params.id;
    const formData = await event.request.formData();

    let jsonPayload: unknown;
    try {
      jsonPayload = JSON.parse(String(formData.get("payload") ?? "{}"));
    } catch {
      return Response.json({ error: "Invalid entry payload JSON." }, { status: 400 });
    }

    const parsed = editProvisionalEntrySchema.safeParse(jsonPayload);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid money entry fields." },
        { status: 400 }
      );
    }

    await editProvisionalEntry(user, {
      entryId,
      title: parsed.data.title,
      category: parsed.data.category,
      amountEur: parsed.data.amountEur,
      entryDate: parsed.data.entryDate,
      comment: parsed.data.comment,
      removeAttachmentIds: parsed.data.removeAttachmentIds,
      newSupportingFiles: extractFiles(formData, "supportingFiles")
    });

    return Response.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
