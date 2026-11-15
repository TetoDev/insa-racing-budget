import type { APIEvent } from "@solidjs/start/server";
import { apiErrorResponse, assertSameOrigin } from "~/server/api-helpers";
import { requireApproverOrMaster } from "~/server/auth";
import { finalizeOrderWithInvoice } from "~/server/requests";

export async function POST(event: APIEvent) {
  try {
    assertSameOrigin(event);
    const user = await requireApproverOrMaster();
    const requestId = event.params.id;
    const formData = await event.request.formData();

    const invoiceEntry = formData.get("invoiceFile");
    if (!(invoiceEntry instanceof File) || invoiceEntry.size <= 0) {
      return Response.json({ error: "Invoice file is required." }, { status: 400 });
    }

    await finalizeOrderWithInvoice(user, {
      requestId,
      invoiceFile: invoiceEntry,
      finalAmountEur: String(formData.get("finalAmountEur") ?? ""),
      comment: String(formData.get("comment") ?? "")
    });

    return Response.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
