import type { APIEvent } from "@solidjs/start/server";
import { entryCategorySchema } from "~/lib/schemas";
import { apiErrorResponse, assertSameOrigin, extractFiles } from "~/server/api-helpers";
import { requireApproverOrMaster } from "~/server/auth";
import { createMoneyEntry } from "~/server/budget";

export async function POST(event: APIEvent) {
  try {
    assertSameOrigin(event);
    const user = await requireApproverOrMaster();
    const formData = await event.request.formData();

    const title = String(formData.get("title") ?? "").trim();
    const categoryRaw = String(formData.get("category") ?? "");
    const amountEur = String(formData.get("amountEur") ?? "");
    const entryDate = String(formData.get("entryDate") ?? "");
    const comment = String(formData.get("comment") ?? "").trim();

    if (title.length < 2) {
      return Response.json({ error: "Entry title is required." }, { status: 400 });
    }
    const parsedCat = entryCategorySchema.safeParse(categoryRaw);
    if (!parsedCat.success) {
      return Response.json({ error: "Invalid entry category." }, { status: 400 });
    }
    if (!comment) {
      return Response.json({ error: "A comment is required for budget entries." }, { status: 400 });
    }

    const invoiceEntry = formData.get("invoiceFile");
    const invoiceFile = invoiceEntry instanceof File && invoiceEntry.size > 0 ? invoiceEntry : null;

    const created = await createMoneyEntry(user, {
      title,
      category: parsedCat.data,
      amountEur,
      entryDate,
      comment,
      supportingFiles: extractFiles(formData, "supportingFiles"),
      invoiceFile
    });

    return Response.json({ ok: true, id: created.id, entryCode: created.entryCode }, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
