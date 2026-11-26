import type { APIEvent } from "@solidjs/start/server";
import type { DepartmentId, RequestStatus } from "~/lib/constants";
import { masterUpdateRequestSchema } from "~/lib/schemas";
import { apiErrorResponse, assertSameOrigin, extractFiles } from "~/server/api-helpers";
import { requireMaster } from "~/server/auth";
import { masterUpdatePurchaseRequest } from "~/server/requests";

export async function POST(event: APIEvent) {
  try {
    assertSameOrigin(event);
    const master = await requireMaster();
    const requestId = event.params.id;
    const formData = await event.request.formData();

    let jsonPayload: unknown;
    try {
      jsonPayload = JSON.parse(String(formData.get("payload") ?? "{}"));
    } catch {
      return Response.json({ error: "Invalid payload JSON." }, { status: 400 });
    }

    const parsed = masterUpdateRequestSchema.safeParse(jsonPayload);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request fields." },
        { status: 400 }
      );
    }

    const result = await masterUpdatePurchaseRequest(master, {
      requestId,
      requestCode: parsed.data.requestCode,
      seasonId: parsed.data.seasonId,
      department: parsed.data.department as DepartmentId,
      carSystem: parsed.data.carSystem,
      quantity: parsed.data.quantity,
      title: parsed.data.title,
      explanation: parsed.data.explanation,
      status: parsed.data.status as RequestStatus,
      creatorId: parsed.data.creatorId,
      hasApproverResponse: parsed.data.hasApproverResponse,
      selectedOptionClientKey: parsed.data.selectedOptionClientKey,
      selectedOptionPriceEur: parsed.data.selectedOptionPriceEur,
      shippingEur: parsed.data.shippingEur,
      importFeeEur: parsed.data.importFeeEur,
      finalAmountEur: parsed.data.finalAmountEur,
      orderedById: parsed.data.orderedById,
      orderedAt: parsed.data.orderedAt,
      invoicedById: parsed.data.invoicedById,
      invoicedAt: parsed.data.invoicedAt,
      archivedAt: parsed.data.archivedAt,
      createdAt: parsed.data.createdAt,
      options: parsed.data.options,
      attachmentUpdates: parsed.data.attachmentUpdates,
      removeAttachmentIds: parsed.data.removeAttachmentIds,
      newPhotoFiles: extractFiles(formData, "photos"),
      newDocumentFiles: extractFiles(formData, "documents"),
      newFeeProofFiles: extractFiles(formData, "feeProofs"),
      newInvoiceFiles: extractFiles(formData, "invoices"),
      editReason: parsed.data.editReason
    });

    return Response.json({ ok: true, ...result });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
