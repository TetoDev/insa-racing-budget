import { and, desc, eq, ilike, or } from "drizzle-orm";
import { getDb } from "./db";
import { auditLogs } from "./db/schema";

type DbOrTx = ReturnType<typeof getDb>;

export async function recordAuditLog(
  dbOrTx: Pick<DbOrTx, "insert">,
  params: {
    seasonId?: string | null;
    actorId?: string | null;
    actorLabel: string;
    action: string;
    targetType: string;
    targetId?: string | null;
    targetCode?: string | null;
    summary: string;
    details?: Record<string, unknown> | null;
  }
) {
  await dbOrTx.insert(auditLogs).values({
    seasonId: params.seasonId ?? null,
    actorId: params.actorId ?? null,
    actorLabel: params.actorLabel,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId ?? null,
    targetCode: params.targetCode ?? null,
    summary: params.summary,
    detailsJson: params.details ?? null
  });
}

export async function listAuditLogs(params: {
  seasonId?: string;
  action?: string;
  search?: string;
  limit?: number;
}) {
  const db = getDb();
  const conditions = [];

  if (params.seasonId && params.seasonId !== "all") {
    conditions.push(eq(auditLogs.seasonId, params.seasonId));
  }
  if (params.action && params.action !== "all") {
    conditions.push(eq(auditLogs.action, params.action));
  }
  if (params.search && params.search.trim()) {
    const q = `%${params.search.trim()}%`;
    conditions.push(
      or(
        ilike(auditLogs.summary, q),
        ilike(auditLogs.actorLabel, q),
        ilike(auditLogs.targetCode, q),
        ilike(auditLogs.action, q)
      )
    );
  }

  return db
    .select()
    .from(auditLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLogs.createdAt))
    .limit(params.limit ?? 250);
}
