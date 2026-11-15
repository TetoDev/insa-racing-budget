import type { APIEvent } from "@solidjs/start/server";
import type { EntryCategory, EntryStatus } from "~/lib/constants";
import { masterUpdateEntrySchema } from "~/lib/schemas";
import { apiErrorResponse, assertSameOrigin, extractFiles } from "~/server/api-helpers";
import { requireMaster } from "~/server/auth";
import { masterUpdateMoneyEntry } from "~/server/budget";

export async function POST(event: APIEvent) {
  try {
    assertSameOrigin(event);
    const master = await requireMaster();
    const entryId = event.params.id;
    const formData = await event.request.formData();

    let jsonPayload: unknown;
    try {
      jsonPayload = JSON.parse(String(formData.get("payload") ?? "{}"));
    } catch {
      return Response.json({ error: "Invalid entry payload JSON." }, { status: 400 });
    }

    const parsed = masterUpdateEntrySchema.safeParse(jsonPayload);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid money entry fields." },
        { status: 400 }
      );
    }

    const result = await masterUpdateMoneyEntry(master, {
      entryId,
      entryCode: parsed.data.entryCode,
      seasonId: parsed.data.seasonId,
      title: parsed.data.title,
      category: parsed.data.category as EntryCategory,
      status: parsed.data.status as EntryStatus,
      initialAmountEur: parsed.data.initialAmountEur,
      confirmedAmountEur: parsed.data.confirmedAmountEur,
      entryDate: parsed.data.entryDate,
      comment: parsed.data.comment,
      createdById: parsed.data.createdById,
      confirmedById: parsed.data.confirmedById,
      confirmedAt: parsed.data.confirmedAt,
      createdAt: parsed.data.createdAt,
      attachmentUpdates: parsed.data.attachmentUpdates,
      removeAttachmentIds: parsed.data.removeAttachmentIds,
      newSupportingFiles: extractFiles(formData, "supportingFiles"),
      newInvoiceFiles: extractFiles(formData, "invoiceFiles"),
      editReason: parsed.data.editReason
    });

    return Response.json({ ok: true, ...result });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
