import type { APIEvent } from "@solidjs/start/server";
import { apiErrorResponse, assertSameOrigin, extractFiles } from "~/server/api-helpers";
import { requireApproverOrMaster } from "~/server/auth";
import { updateOrderSupplementalFees } from "~/server/requests";

export async function POST(event: APIEvent) {
  try {
    assertSameOrigin(event);
    const user = await requireApproverOrMaster();
    const requestId = event.params.id;
    const formData = await event.request.formData();

    await updateOrderSupplementalFees(user, {
      requestId,
      shippingEur: String(formData.get("shippingEur") ?? "0"),
      importFeeEur: String(formData.get("importFeeEur") ?? "0"),
      comment: String(formData.get("comment") ?? ""),
      proofFiles: extractFiles(formData, "proofFiles")
    });

    return Response.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
