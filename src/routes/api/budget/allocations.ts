import type { APIEvent } from "@solidjs/start/server";
import { canManageBudgetEntries } from "~/lib/permissions";
import { updateDepartmentBudgetsSchema } from "~/lib/schemas";
import { apiErrorResponse, assertSameOrigin } from "~/server/api-helpers";
import { requireUser } from "~/server/auth";
import { upsertDepartmentBudgets } from "~/server/budget";

export async function POST(event: APIEvent) {
  try {
    assertSameOrigin(event);
    const user = await requireUser();
    if (!canManageBudgetEntries(user.role)) {
      return Response.json(
        { error: "FORBIDDEN: Only approvers and Master can update department budget envelopes." },
        { status: 403 }
      );
    }

    const body = await event.request.json().catch(() => null);
    const parsed = updateDepartmentBudgetsSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid department budget allocations." },
        { status: 400 }
      );
    }

    await upsertDepartmentBudgets(user, parsed.data);
    return Response.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
