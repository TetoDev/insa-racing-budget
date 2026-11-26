import type { APIEvent } from "@solidjs/start/server";
import { exportConfigSchema } from "~/lib/schemas";
import { apiErrorResponse, assertSameOrigin } from "~/server/api-helpers";
import { recordAuditLog } from "~/server/audit";
import { requireApproverOrMaster } from "~/server/auth";
import { getDb } from "~/server/db";
import { generateBudgetExport } from "~/server/exports";

export async function POST(event: APIEvent) {
  try {
    assertSameOrigin(event);
    const user = await requireApproverOrMaster();
    const body = await event.request.json();
    const parsed = exportConfigSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid export configuration." },
        { status: 400 }
      );
    }

    const result = await generateBudgetExport(parsed.data);

    await recordAuditLog(getDb(), {
      seasonId: parsed.data.seasonId,
      actorId: user.id,
      actorLabel: `${user.fullName} (${user.title})`,
      action: "budget_exported",
      targetType: "export",
      targetCode: result.filename,
      summary: `Exported budget (${parsed.data.format.toUpperCase()}${parsed.data.includeZip ? " + ZIP docs" : ""}, ${(parsed.data.locale ?? "en").toUpperCase()}) covering ${parsed.data.sections.length} section(s)`
    });

    return new Response(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        "Content-Type": result.mimeType,
        "Content-Length": String(result.buffer.length),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
