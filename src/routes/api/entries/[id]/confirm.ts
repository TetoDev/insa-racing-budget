import type { APIEvent } from "@solidjs/start/server";
import { apiErrorResponse, assertSameOrigin } from "~/server/api-helpers";
import { requireApproverOrMaster } from "~/server/auth";
import { confirmProvisionalEntryWithInvoice } from "~/server/budget";

export async function POST(event: APIEvent) {
  try {
    assertSameOrigin(event);
    const user = await requireApproverOrMaster();
    const entryId = event.params.id;
    const formData = await event.request.formData();

    const invoiceEntry = formData.get("invoiceFile");
    if (!(invoiceEntry instanceof File) || invoiceEntry.size <= 0) {
      return Response.json({ error: "Invoice file is required to confirm this entry." }, { status: 400 });
    }

    await confirmProvisionalEntryWithInvoice(user, {
      entryId,
      invoiceFile: invoiceEntry,
      confirmedAmountEur: String(formData.get("confirmedAmountEur") ?? ""),
      comment: String(formData.get("comment") ?? "")
    });

    return Response.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
