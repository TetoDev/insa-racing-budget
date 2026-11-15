import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { computeBudgetAnalytics } from "~/lib/budget-analytics";
import {
  DEPARTMENT_MAP,
  ENTRY_CATEGORY_MAP,
  ENTRY_STATUS_LABELS,
  type DepartmentId,
  type EntryCategory,
  type EntryStatus,
  type RatePeriod
} from "~/lib/constants";
import { formatDateTime, formatEur, parseEurToCents, toIsoDateInput } from "~/lib/format";
import {
  diffRecordFields,
  formatDiffSummaryLines,
  parseOptionalTimestamp,
  parseRequiredTimestamp
} from "~/lib/master-diff";
import { canTransitionEntry } from "~/lib/workflow";
import { purgeEntityAttachments, saveUploadGroups, syncEntityAttachments } from "./attachment-sync";
import { recordAuditLog } from "./audit";
import type { PublicUser } from "./auth";
import { getDb } from "./db";
import { ensureDbReady } from "./db/bootstrap";
import {
  attachments,
  auditLogs,
  buyingOptions,
  departmentBudgets,
  entryCounters,
  entryTimeline,
  moneyEntries,
  purchaseRequests,
  seasons,
  users
} from "./db/schema";
import { getActiveSeasonOrThrow } from "./requests";
import { deleteStoredFileQuietly, saveUploadedFile } from "./storage";

export async function createMoneyEntry(
  actor: PublicUser,
  params: {
    title: string;
    category: EntryCategory;
    amountEur: string;
    entryDate: string;
    comment: string;
    supportingFiles: File[];
    invoiceFile: File | null;
  }
) {
  await ensureDbReady();
  const activeSeason = await getActiveSeasonOrThrow();
  const amountCents = parseEurToCents(params.amountEur, { allowZero: false });
  if (amountCents === null) {
    throw new Error("Entry amount must be a valid positive Euro amount.");
  }

  const savedSupporting: Array<Awaited<ReturnType<typeof saveUploadedFile>>> = [];
  let savedInvoice: Awaited<ReturnType<typeof saveUploadedFile>> | null = null;

  try {
    for (const file of params.supportingFiles) {
      if (file.size > 0) {
        savedSupporting.push(await saveUploadedFile({ file, mode: "document" }));
      }
    }
    if (params.invoiceFile && params.invoiceFile.size > 0) {
      savedInvoice = await saveUploadedFile({ file: params.invoiceFile, mode: "document" });
    }

    const db = getDb();
    const isImmediatelyConfirmed = Boolean(savedInvoice);
    const now = new Date();

    const created = await db.transaction(async tx => {
      const [counter] = await tx
        .insert(entryCounters)
        .values({ seasonId: activeSeason.id, lastSeq: 1 })
        .onConflictDoUpdate({
          target: [entryCounters.seasonId],
          set: { lastSeq: sql`${entryCounters.lastSeq} + 1` }
        })
        .returning({ lastSeq: entryCounters.lastSeq });

      const entryCode = `${activeSeason.yearCode}-ENT-${String(counter.lastSeq).padStart(3, "0")}`;

      const [entryRow] = await tx
        .insert(moneyEntries)
        .values({
          entryCode,
          seasonId: activeSeason.id,
          title: params.title.trim(),
          category: params.category,
          status: isImmediatelyConfirmed ? "confirmed" : "provisional",
          initialAmountCents: amountCents,
          confirmedAmountCents: isImmediatelyConfirmed ? amountCents : null,
          entryDate: toIsoDateInput(params.entryDate),
          comment: params.comment.trim(),
          createdById: actor.id,
          confirmedById: isImmediatelyConfirmed ? actor.id : null,
          confirmedAt: isImmediatelyConfirmed ? now : null
        })
        .returning();

      const filesToInsert = [
        ...savedSupporting.map(f => ({
          entityType: "entry" as const,
          entityId: entryRow.id,
          kind: "supporting_doc" as const,
          originalName: f.originalName,
          storageKey: f.storageKey,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
          uploadedById: actor.id
        })),
        ...(savedInvoice
          ? [
              {
                entityType: "entry" as const,
                entityId: entryRow.id,
                kind: "invoice" as const,
                originalName: savedInvoice.originalName,
                storageKey: savedInvoice.storageKey,
                mimeType: savedInvoice.mimeType,
                sizeBytes: savedInvoice.sizeBytes,
                uploadedById: actor.id
              }
            ]
          : [])
      ];

      if (filesToInsert.length > 0) {
        await tx.insert(attachments).values(filesToInsert);
      }

      const catLabel = ENTRY_CATEGORY_MAP[params.category].label;
      await tx.insert(entryTimeline).values({
        entryId: entryRow.id,
        actorId: actor.id,
        eventType: isImmediatelyConfirmed ? "entry_confirmed_created" : "entry_provisional_created",
        fromStatus: null,
        toStatus: entryRow.status,
        comment: `Created ${isImmediatelyConfirmed ? "confirmed" : "provisional"} ${catLabel} entry (${formatEur(amountCents)})${params.comment.trim() ? `: ${params.comment.trim()}` : ""}`,
        metadataJson: {
          amountCents,
          category: params.category,
          entryDate: toIsoDateInput(params.entryDate)
        }
      });

      await recordAuditLog(tx, {
        seasonId: activeSeason.id,
        actorId: actor.id,
        actorLabel: `${actor.fullName} (${actor.title})`,
        action: isImmediatelyConfirmed ? "entry_confirmed_created" : "entry_provisional_created",
        targetType: "entry",
        targetId: entryRow.id,
        targetCode: entryRow.entryCode,
        summary: `Logged ${isImmediatelyConfirmed ? "confirmed" : "provisional"} ${catLabel} entry ${entryRow.entryCode} "${entryRow.title}" (${formatEur(amountCents)})`
      });

      return entryRow;
    });

    return created;
  } catch (err) {
    await Promise.all([
      ...savedSupporting.map(s => deleteStoredFileQuietly(s.storageKey)),
      ...(savedInvoice ? [deleteStoredFileQuietly(savedInvoice.storageKey)] : [])
    ]);
    throw err;
  }
}

export async function confirmProvisionalEntryWithInvoice(
  actor: PublicUser,
  params: {
    entryId: string;
    invoiceFile: File;
    confirmedAmountEur?: string;
    comment?: string;
  }
) {
  await ensureDbReady();
  if (!params.invoiceFile || params.invoiceFile.size <= 0) {
    throw new Error("An invoice file is required to confirm a provisional entry.");
  }

  let customConfirmedCents: number | null = null;
  if (params.confirmedAmountEur && params.confirmedAmountEur.trim().length > 0) {
    customConfirmedCents = parseEurToCents(params.confirmedAmountEur, { allowZero: false });
    if (customConfirmedCents === null) {
      throw new Error("Confirmed EUR amount must be valid and positive.");
    }
  }

  const savedInvoice = await saveUploadedFile({ file: params.invoiceFile, mode: "document" });

  try {
    const db = getDb();
    await db.transaction(async tx => {
      const [entry] = await tx
        .select()
        .from(moneyEntries)
        .where(eq(moneyEntries.id, params.entryId))
        .limit(1);
      if (!entry) throw new Error("Money entry not found.");

      const [season] = await tx
        .select()
        .from(seasons)
        .where(eq(seasons.id, entry.seasonId))
        .limit(1);
      if (!season || season.status !== "active") {
        throw new Error("Cannot confirm entries in an archived season.");
      }

      const nextStatus = canTransitionEntry(entry.status, "confirm_with_invoice");
      const finalAmount = customConfirmedCents ?? entry.initialAmountCents;
      const now = new Date();
      const updatedComment = params.comment?.trim()
        ? `${entry.comment}\n\n[Confirmed]: ${params.comment.trim()}`
        : entry.comment;

      await tx
        .update(moneyEntries)
        .set({
          status: nextStatus,
          confirmedAmountCents: finalAmount,
          confirmedById: actor.id,
          confirmedAt: now,
          comment: updatedComment,
          updatedAt: now
        })
        .where(eq(moneyEntries.id, entry.id));

      await tx.insert(attachments).values({
        entityType: "entry",
        entityId: entry.id,
        kind: "invoice",
        originalName: savedInvoice.originalName,
        storageKey: savedInvoice.storageKey,
        mimeType: savedInvoice.mimeType,
        sizeBytes: savedInvoice.sizeBytes,
        uploadedById: actor.id
      });

      await tx.insert(entryTimeline).values({
        entryId: entry.id,
        actorId: actor.id,
        eventType: "entry_confirmed",
        fromStatus: entry.status,
        toStatus: nextStatus,
        comment: `Confirmed provisional entry with invoice (${savedInvoice.originalName}) at ${formatEur(finalAmount)}${(params.comment || "").trim() ? ` — ${(params.comment || "").trim()}` : ""}`,
        metadataJson: {
          confirmedAmountCents: finalAmount,
          invoiceName: savedInvoice.originalName
        }
      });

      await recordAuditLog(tx, {
        seasonId: entry.seasonId,
        actorId: actor.id,
        actorLabel: `${actor.fullName} (${actor.title})`,
        action: "entry_confirmed",
        targetType: "entry",
        targetId: entry.id,
        targetCode: entry.entryCode,
        summary: `Confirmed provisional entry ${entry.entryCode} "${entry.title}" with invoice at ${formatEur(finalAmount)}`
      });
    });
  } catch (err) {
    await deleteStoredFileQuietly(savedInvoice.storageKey);
    throw err;
  }
}

export async function cancelProvisionalEntry(
  actor: PublicUser,
  entryId: string,
  reason: string
) {
  await ensureDbReady();
  const db = getDb();
  const cleanReason = reason.trim() || "Cancelled by approver.";

  await db.transaction(async tx => {
    const [entry] = await tx
      .select()
      .from(moneyEntries)
      .where(eq(moneyEntries.id, entryId))
      .limit(1);
    if (!entry) throw new Error("Money entry not found.");

    const [season] = await tx
      .select()
      .from(seasons)
      .where(eq(seasons.id, entry.seasonId))
      .limit(1);
    if (!season || season.status !== "active") {
      throw new Error("Cannot modify entries in an archived season.");
    }

    const nextStatus = canTransitionEntry(entry.status, "cancel");
    await tx
      .update(moneyEntries)
      .set({
        status: nextStatus,
        comment: `${entry.comment}\n\n[Cancelled]: ${cleanReason}`,
        updatedAt: new Date()
      })
      .where(eq(moneyEntries.id, entry.id));

    await tx.insert(entryTimeline).values({
      entryId: entry.id,
      actorId: actor.id,
      eventType: "entry_cancelled",
      fromStatus: entry.status,
      toStatus: nextStatus,
      comment: cleanReason
    });

    await recordAuditLog(tx, {
      seasonId: entry.seasonId,
      actorId: actor.id,
      actorLabel: `${actor.fullName} (${actor.title})`,
      action: "entry_cancelled",
      targetType: "entry",
      targetId: entry.id,
      targetCode: entry.entryCode,
      summary: `Cancelled provisional entry ${entry.entryCode} "${entry.title}": ${cleanReason}`
    });
  });
}

export async function editProvisionalEntry(
  actor: PublicUser,
  params: {
    entryId: string;
    title: string;
    category: EntryCategory;
    amountEur: string;
    entryDate: string;
    comment: string;
    removeAttachmentIds: string[];
    newSupportingFiles: File[];
  }
) {
  await ensureDbReady();
  const amountCents = parseEurToCents(params.amountEur, { allowZero: false });
  if (amountCents === null) {
    throw new Error("Entry amount must be a valid positive Euro amount.");
  }

  const savedFiles: Array<Awaited<ReturnType<typeof saveUploadedFile>>> = [];
  try {
    for (const file of params.newSupportingFiles) {
      if (file.size > 0) {
        savedFiles.push(await saveUploadedFile({ file, mode: "document" }));
      }
    }

    const db = getDb();
    const removedKeys: string[] = [];

    await db.transaction(async tx => {
      const [entry] = await tx
        .select()
        .from(moneyEntries)
        .where(eq(moneyEntries.id, params.entryId))
        .limit(1);
      if (!entry) throw new Error("Money entry not found.");
      if (entry.status !== "provisional") {
        throw new Error("Only provisional money entries can be edited before confirmation.");
      }

      const [season] = await tx
        .select()
        .from(seasons)
        .where(eq(seasons.id, entry.seasonId))
        .limit(1);
      if (!season || season.status !== "active") {
        throw new Error("Cannot edit entries in an archived season.");
      }

      await tx
        .update(moneyEntries)
        .set({
          title: params.title.trim(),
          category: params.category,
          initialAmountCents: amountCents,
          entryDate: toIsoDateInput(params.entryDate),
          comment: params.comment.trim(),
          updatedAt: new Date()
        })
        .where(eq(moneyEntries.id, entry.id));

      if (params.removeAttachmentIds.length > 0) {
        const toDelete = await tx
          .select()
          .from(attachments)
          .where(
            and(
              eq(attachments.entityType, "entry"),
              eq(attachments.entityId, entry.id),
              inArray(attachments.id, params.removeAttachmentIds)
            )
          );
        for (const a of toDelete) {
          removedKeys.push(a.storageKey);
        }
        if (toDelete.length > 0) {
          await tx
            .delete(attachments)
            .where(inArray(attachments.id, toDelete.map(a => a.id)));
        }
      }

      if (savedFiles.length > 0) {
        await tx.insert(attachments).values(
          savedFiles.map(f => ({
            entityType: "entry" as const,
            entityId: entry.id,
            kind: "supporting_doc" as const,
            originalName: f.originalName,
            storageKey: f.storageKey,
            mimeType: f.mimeType,
            sizeBytes: f.sizeBytes,
            uploadedById: actor.id
          }))
        );
      }

      await tx.insert(entryTimeline).values({
        entryId: entry.id,
        actorId: actor.id,
        eventType: "entry_provisional_edited",
        fromStatus: entry.status,
        toStatus: entry.status,
        comment: `Edited provisional entry "${params.title.trim()}" (${formatEur(amountCents)})`,
        metadataJson: {
          initialAmountCents: amountCents,
          category: params.category,
          entryDate: toIsoDateInput(params.entryDate)
        }
      });

      await recordAuditLog(tx, {
        seasonId: entry.seasonId,
        actorId: actor.id,
        actorLabel: `${actor.fullName} (${actor.title})`,
        action: "entry_provisional_edited",
        targetType: "entry",
        targetId: entry.id,
        targetCode: entry.entryCode,
        summary: `Edited provisional entry ${entry.entryCode} "${params.title.trim()}" (${formatEur(amountCents)})`
      });
    });

    await Promise.all(removedKeys.map(k => deleteStoredFileQuietly(k)));
  } catch (err) {
    await Promise.all(savedFiles.map(f => deleteStoredFileQuietly(f.storageKey)));
    throw err;
  }
}

export async function upsertDepartmentBudgets(
  actor: PublicUser,
  params: {
    seasonId: string;
    allocations: Array<{ department: DepartmentId; allocatedEur: string }>;
  }
) {
  await ensureDbReady();
  const db = getDb();

  const [season] = await db.select().from(seasons).where(eq(seasons.id, params.seasonId)).limit(1);
  if (!season) throw new Error("Season not found.");
  if (season.status !== "active") {
    throw new Error("Cannot edit department budgets in an archived season.");
  }

  const parsed = params.allocations.map(item => {
    const cents = parseEurToCents(item.allocatedEur || "0", { allowZero: true });
    if (cents === null) {
      const label = DEPARTMENT_MAP[item.department]?.label ?? item.department;
      throw new Error(`Invalid budget amount for ${label}. Enter a valid EUR amount or 0.`);
    }
    return { department: item.department, allocatedCents: cents };
  });

  await db.transaction(async tx => {
    for (const row of parsed) {
      await tx
        .insert(departmentBudgets)
        .values({
          seasonId: season.id,
          department: row.department,
          allocatedCents: row.allocatedCents,
          updatedById: actor.id,
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: [departmentBudgets.seasonId, departmentBudgets.department],
          set: {
            allocatedCents: row.allocatedCents,
            updatedById: actor.id,
            updatedAt: new Date()
          }
        });
    }

    const totalSet = parsed.reduce((acc, r) => acc + r.allocatedCents, 0);
    await recordAuditLog(tx, {
      seasonId: season.id,
      actorId: actor.id,
      actorLabel: `${actor.fullName} (${actor.title})`,
      action: "department_budgets_updated",
      targetType: "season",
      targetId: season.id,
      targetCode: season.yearCode,
      summary: `Updated department budget envelopes for ${season.name} (total allocated: ${formatEur(totalSet)})`
    });
  });
}

export async function getSeasonBudgetSnapshot(params: {
  seasonId: string;
  periodUnit: RatePeriod;
  fromDate?: string;
  toDate?: string;
}) {
  await ensureDbReady();
  const db = getDb();

  const [season] = await db.select().from(seasons).where(eq(seasons.id, params.seasonId)).limit(1);
  if (!season) throw new Error("Season not found.");

  const allocRows = await db
    .select()
    .from(departmentBudgets)
    .where(eq(departmentBudgets.seasonId, season.id));
  const departmentAllocations: Partial<Record<DepartmentId, number>> = {};
  for (const row of allocRows) {
    departmentAllocations[row.department] = row.allocatedCents;
  }

  const requestRows = await db
    .select({
      request: purchaseRequests,
      creatorName: users.fullName
    })
    .from(purchaseRequests)
    .innerJoin(users, eq(purchaseRequests.creatorId, users.id))
    .where(eq(purchaseRequests.seasonId, season.id))
    .orderBy(desc(purchaseRequests.createdAt));

  const reqIds = requestRows.map(r => r.request.id);
  const optionRows =
    reqIds.length > 0
      ? await db.select().from(buyingOptions).where(inArray(buyingOptions.requestId, reqIds))
      : [];
  const optionById = new Map(optionRows.map(o => [o.id, o]));

  const reqAttachments =
    reqIds.length > 0
      ? await db
          .select()
          .from(attachments)
          .where(and(eq(attachments.entityType, "request"), inArray(attachments.entityId, reqIds)))
          .orderBy(asc(attachments.createdAt))
      : [];
  const reqAttMap = new Map<string, typeof reqAttachments>();
  for (const a of reqAttachments) {
    const list = reqAttMap.get(a.entityId) ?? [];
    list.push(a);
    reqAttMap.set(a.entityId, list);
  }

  const entryRows = await db
    .select({
      entry: moneyEntries,
      creatorName: users.fullName
    })
    .from(moneyEntries)
    .innerJoin(users, eq(moneyEntries.createdById, users.id))
    .where(eq(moneyEntries.seasonId, season.id))
    .orderBy(desc(moneyEntries.entryDate), desc(moneyEntries.createdAt));

  const entryIds = entryRows.map(e => e.entry.id);
  const entryAttachments =
    entryIds.length > 0
      ? await db
          .select()
          .from(attachments)
          .where(and(eq(attachments.entityType, "entry"), inArray(attachments.entityId, entryIds)))
          .orderBy(asc(attachments.createdAt))
      : [];
  const entryAttMap = new Map<string, typeof entryAttachments>();
  for (const a of entryAttachments) {
    const list = entryAttMap.get(a.entityId) ?? [];
    list.push(a);
    entryAttMap.set(a.entityId, list);
  }

  const allUserRows = await db.select({ id: users.id, fullName: users.fullName }).from(users);
  const userNameMap = new Map(allUserRows.map(u => [u.id, u.fullName]));

  const requestsForAnalytics = requestRows.map(({ request }) => ({
    id: request.id,
    requestCode: request.requestCode,
    title: request.title,
    department: request.department,
    carSystem: request.carSystem,
    status: request.status,
    selectedOptionPriceCents: request.selectedOptionPriceCents,
    shippingCents: request.shippingCents,
    importFeeCents: request.importFeeCents,
    finalAmountCents: request.finalAmountCents,
    createdAt: request.createdAt.toISOString(),
    orderedAt: request.orderedAt ? request.orderedAt.toISOString() : null,
    invoicedAt: request.invoicedAt ? request.invoicedAt.toISOString() : null
  }));

  const entriesForAnalytics = entryRows.map(({ entry }) => ({
    id: entry.id,
    entryCode: entry.entryCode,
    title: entry.title,
    category: entry.category,
    status: entry.status,
    initialAmountCents: entry.initialAmountCents,
    confirmedAmountCents: entry.confirmedAmountCents,
    entryDate: entry.entryDate,
    confirmedAt: entry.confirmedAt ? entry.confirmedAt.toISOString() : null
  }));

  const analytics = computeBudgetAnalytics({
    openingBalanceCents: season.openingBalanceCents,
    requests: requestsForAnalytics,
    entries: entriesForAnalytics,
    periodUnit: params.periodUnit,
    fromDate: params.fromDate,
    toDate: params.toDate,
    departmentAllocations
  });

  const isInDateWindow = (isoDate: string) => {
    const day = isoDate.slice(0, 10);
    if (params.fromDate && day < params.fromDate) return false;
    if (params.toDate && day > params.toDate) return false;
    return true;
  };

  const spendingsList = requestRows
    .filter(({ request }) => request.status === "spending")
    .map(({ request, creatorName }) => {
      const opt = request.selectedOptionId ? optionById.get(request.selectedOptionId) : null;
      const atts = reqAttMap.get(request.id) ?? [];
      const effectiveDate = (request.invoicedAt ?? request.orderedAt ?? request.createdAt).toISOString();
      const basePriceCents = request.selectedOptionPriceCents ?? 0;
      const committedTotalCents = basePriceCents + request.shippingCents + request.importFeeCents;
      const finalAmountCents = request.finalAmountCents ?? committedTotalCents;
      return {
        id: request.id,
        requestCode: request.requestCode,
        department: request.department,
        carSystem: request.carSystem,
        title: request.title,
        creatorName,
        chosenOptionLabel: opt?.label ?? "Selected option",
        basePriceCents,
        shippingCents: request.shippingCents,
        importFeeCents: request.importFeeCents,
        committedTotalCents,
        varianceCents: finalAmountCents - committedTotalCents,
        finalAmountCents,
        effectiveDate,
        invoicedByName: request.invoicedById ? (userNameMap.get(request.invoicedById) ?? "Approver") : "Approver",
        attachments: atts.map(a => ({
          id: a.id,
          kind: a.kind,
          originalName: a.originalName,
          storageKey: a.storageKey
        }))
      };
    })
    .filter(s => isInDateWindow(s.effectiveDate));

  const provisionalSpendingsList = requestRows
    .filter(({ request }) => request.status === "order")
    .map(({ request, creatorName }) => {
      const opt = request.selectedOptionId ? optionById.get(request.selectedOptionId) : null;
      const atts = reqAttMap.get(request.id) ?? [];
      const effectiveDate = (request.orderedAt ?? request.createdAt).toISOString();
      const totalCents =
        (request.selectedOptionPriceCents ?? 0) + request.shippingCents + request.importFeeCents;
      return {
        id: request.id,
        requestCode: request.requestCode,
        department: request.department,
        carSystem: request.carSystem,
        title: request.title,
        creatorName,
        chosenOptionLabel: opt?.label ?? "Selected option",
        basePriceCents: request.selectedOptionPriceCents ?? 0,
        shippingCents: request.shippingCents,
        importFeeCents: request.importFeeCents,
        provisionalTotalCents: totalCents,
        orderedAt: effectiveDate,
        orderedByName: request.orderedById ? (userNameMap.get(request.orderedById) ?? "Approver") : "Approver",
        attachments: atts.map(a => ({
          id: a.id,
          kind: a.kind,
          originalName: a.originalName,
          storageKey: a.storageKey
        }))
      };
    })
    .filter(o => isInDateWindow(o.orderedAt));

  const mappedEntries = entryRows
    .map(({ entry, creatorName }) => {
      const atts = entryAttMap.get(entry.id) ?? [];
      const effectiveDate =
        entry.status === "confirmed" && entry.confirmedAt
          ? entry.confirmedAt.toISOString()
          : entry.entryDate;
      return {
        id: entry.id,
        seasonId: entry.seasonId,
        entryCode: entry.entryCode,
        title: entry.title,
        category: entry.category,
        status: entry.status,
        initialAmountCents: entry.initialAmountCents,
        confirmedAmountCents: entry.confirmedAmountCents,
        effectiveAmountCents:
          entry.status === "confirmed" && entry.confirmedAmountCents !== null
            ? entry.confirmedAmountCents
            : entry.initialAmountCents,
        entryDate: entry.entryDate,
        effectiveDate,
        comment: entry.comment,
        createdById: entry.createdById,
        creatorName,
        confirmedById: entry.confirmedById ?? null,
        confirmedByName: entry.confirmedById ? (userNameMap.get(entry.confirmedById) ?? null) : null,
        confirmedAt: entry.confirmedAt ? entry.confirmedAt.toISOString() : null,
        createdAt: entry.createdAt.toISOString(),
        attachments: atts.map(a => ({
          id: a.id,
          kind: a.kind,
          originalName: a.originalName,
          storageKey: a.storageKey
        }))
      };
    })
    .filter(e => isInDateWindow(e.effectiveDate));

  return {
    season: {
      id: season.id,
      name: season.name,
      yearCode: season.yearCode,
      startDate: season.startDate,
      deadlineDate: season.deadlineDate,
      openingBalanceCents: season.openingBalanceCents,
      status: season.status
    },
    departmentAllocations,
    analytics,
    spendings: spendingsList,
    provisionalSpendings: provisionalSpendingsList,
    entries: mappedEntries
  };
}

export interface EntryItemLogEvent {
  id: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  comment: string;
  metadataJson: Record<string, unknown> | null;
  createdAt: string;
  actorName: string;
  actorTitle: string;
  actorRole: string;
  actorAvatarId: string | null;
}

/**
 * Returns chronological item log events for a money entry, merging native `entry_timeline`
 * rows with historical `audit_logs` records created before `entry_timeline` existed.
 */
export async function getMoneyEntryItemLog(entryId: string): Promise<{
  entry: { id: string; entryCode: string; title: string; status: EntryStatus };
  events: EntryItemLogEvent[];
} | null> {
  await ensureDbReady();
  const db = getDb();

  const [entry] = await db
    .select({
      id: moneyEntries.id,
      entryCode: moneyEntries.entryCode,
      title: moneyEntries.title,
      status: moneyEntries.status
    })
    .from(moneyEntries)
    .where(eq(moneyEntries.id, entryId))
    .limit(1);
  if (!entry) return null;

  const [timelineRows, auditRows] = await Promise.all([
    db
      .select({
        id: entryTimeline.id,
        eventType: entryTimeline.eventType,
        fromStatus: entryTimeline.fromStatus,
        toStatus: entryTimeline.toStatus,
        comment: entryTimeline.comment,
        metadataJson: entryTimeline.metadataJson,
        createdAt: entryTimeline.createdAt,
        actorName: users.fullName,
        actorTitle: users.title,
        actorRole: users.role,
        actorAvatarId: users.avatarAttachmentId
      })
      .from(entryTimeline)
      .innerJoin(users, eq(entryTimeline.actorId, users.id))
      .where(eq(entryTimeline.entryId, entry.id))
      .orderBy(asc(entryTimeline.createdAt)),
    db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        summary: auditLogs.summary,
        detailsJson: auditLogs.detailsJson,
        actorLabel: auditLogs.actorLabel,
        createdAt: auditLogs.createdAt
      })
      .from(auditLogs)
      .where(and(eq(auditLogs.targetType, "entry"), eq(auditLogs.targetId, entry.id)))
      .orderBy(asc(auditLogs.createdAt))
  ]);

  const events: EntryItemLogEvent[] = timelineRows.map(r => ({
    id: r.id,
    eventType: r.eventType,
    fromStatus: r.fromStatus,
    toStatus: r.toStatus,
    comment: r.comment,
    metadataJson: r.metadataJson,
    createdAt: r.createdAt.toISOString(),
    actorName: r.actorName,
    actorTitle: r.actorTitle,
    actorRole: r.actorRole,
    actorAvatarId: r.actorAvatarId ?? null
  }));

  const auditToTimelineEvent: Record<string, string> = {
    master_entry_edited: "master_edited"
  };

  for (const log of auditRows) {
    const mappedEvent = auditToTimelineEvent[log.action] ?? log.action;
    const matched = timelineRows.some(
      t =>
        (t.eventType === log.action || t.eventType === mappedEvent) &&
        Math.abs(t.createdAt.getTime() - log.createdAt.getTime()) <= 5000
    );
    if (!matched) {
      events.push({
        id: `audit-${log.id}`,
        eventType: log.action,
        fromStatus: null,
        toStatus: null,
        comment: log.summary,
        metadataJson: log.detailsJson,
        createdAt: log.createdAt.toISOString(),
        actorName: log.actorLabel,
        actorTitle: "Audit Record",
        actorRole: "approver",
        actorAvatarId: null
      });
    }
  }

  events.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  return { entry, events };
}

export interface MasterUpdateEntryParams {
  entryId: string;
  entryCode: string;
  seasonId: string;
  title: string;
  category: EntryCategory;
  status: EntryStatus;
  initialAmountEur: string;
  confirmedAmountEur?: string | null;
  entryDate: string;
  comment: string;
  createdById: string;
  confirmedById?: string | null;
  confirmedAt?: string | null;
  createdAt: string;
  attachmentUpdates: Array<{
    id: string;
    originalName: string;
    kind: "supporting_doc" | "invoice";
  }>;
  removeAttachmentIds: string[];
  newSupportingFiles: File[];
  newInvoiceFiles: File[];
  editReason?: string;
}

/** Master-only unrestricted full edit across every field, timestamp, and attachment of a money entry. */
export async function masterUpdateMoneyEntry(
  actor: PublicUser,
  params: MasterUpdateEntryParams
): Promise<{ entryCode: string; changedCount: number }> {
  if (actor.role !== "master") {
    throw new Error("FORBIDDEN: Master account privileges required.");
  }
  await ensureDbReady();

  const initialAmountCents = parseEurToCents(params.initialAmountEur, { allowZero: true });
  if (initialAmountCents === null) {
    throw new Error("Initial amount must be a valid non-negative Euro amount.");
  }

  let confirmedAmountCents: number | null = null;
  if (params.confirmedAmountEur && params.confirmedAmountEur.trim().length > 0) {
    confirmedAmountCents = parseEurToCents(params.confirmedAmountEur, { allowZero: true });
    if (confirmedAmountCents === null) {
      throw new Error("Confirmed amount must be blank or a valid non-negative Euro amount.");
    }
  }

  const createdAt = parseRequiredTimestamp(params.createdAt, "Created timestamp");
  const confirmedAt = parseOptionalTimestamp(params.confirmedAt, "Confirmed timestamp");
  const nextEntryDate = toIsoDateInput(params.entryDate);

  const savedUploads = await saveUploadGroups([
    { kind: "supporting_doc" as const, files: params.newSupportingFiles, mode: "document" },
    { kind: "invoice" as const, files: params.newInvoiceFiles, mode: "document" }
  ]);

  try {
    const db = getDb();
    let removedKeys: string[] = [];

    const result = await db.transaction(async tx => {
      const [entry] = await tx
        .select()
        .from(moneyEntries)
        .where(eq(moneyEntries.id, params.entryId))
        .limit(1);
      if (!entry) throw new Error("Money entry not found.");

      const nextEntryCode = params.entryCode.trim().toUpperCase();
      if (nextEntryCode !== entry.entryCode) {
        const [dup] = await tx
          .select({ id: moneyEntries.id })
          .from(moneyEntries)
          .where(and(eq(moneyEntries.entryCode, nextEntryCode), ne(moneyEntries.id, entry.id)))
          .limit(1);
        if (dup) {
          throw new Error(`Entry ID "${nextEntryCode}" is already used by another money entry.`);
        }
      }

      const seasonIds = Array.from(new Set([entry.seasonId, params.seasonId]));
      const seasonRows = await tx
        .select({ id: seasons.id, name: seasons.name, yearCode: seasons.yearCode })
        .from(seasons)
        .where(inArray(seasons.id, seasonIds));
      const seasonMap = new Map(seasonRows.map(s => [s.id, `${s.name} (${s.yearCode})`]));
      if (!seasonMap.has(params.seasonId)) {
        throw new Error("Selected season does not exist.");
      }

      const nextConfirmedById = params.confirmedById?.trim() || null;
      const userIdsNeeded = Array.from(
        new Set(
          [entry.createdById, params.createdById, entry.confirmedById, nextConfirmedById].filter(
            (id): id is string => Boolean(id)
          )
        )
      );
      const userRows =
        userIdsNeeded.length > 0
          ? await tx
              .select({ id: users.id, fullName: users.fullName })
              .from(users)
              .where(inArray(users.id, userIdsNeeded))
          : [];
      const userMap = new Map(userRows.map(u => [u.id, u.fullName]));
      if (!userMap.has(params.createdById)) throw new Error("Selected creator user not found.");
      if (nextConfirmedById && !userMap.has(nextConfirmedById)) {
        throw new Error("Selected confirmed-by user not found.");
      }

      const attSync = await syncEntityAttachments(tx, {
        entityType: "entry",
        entityId: entry.id,
        actorId: actor.id,
        updates: params.attachmentUpdates,
        removeIds: params.removeAttachmentIds,
        savedUploads
      });
      removedKeys = attSync.removedKeys;

      const nextTitle = params.title.trim();
      const nextComment = params.comment.trim();
      const fmtNullableEur = (cents: number | null) => (cents === null ? "None" : formatEur(cents));
      const fmtNullableTs = (d: Date | null) => (d ? formatDateTime(d) : "None");
      const fmtUser = (id: string | null) => (id ? (userMap.get(id) ?? id) : "None");

      const changes = diffRecordFields([
        { field: "entryCode", label: "Entry ID", before: entry.entryCode, after: nextEntryCode },
        {
          field: "seasonId",
          label: "Season",
          before: seasonMap.get(entry.seasonId) ?? entry.seasonId,
          after: seasonMap.get(params.seasonId) ?? params.seasonId
        },
        { field: "title", label: "Title", before: entry.title, after: nextTitle },
        {
          field: "category",
          label: "Category",
          before: ENTRY_CATEGORY_MAP[entry.category]?.label ?? entry.category,
          after: ENTRY_CATEGORY_MAP[params.category]?.label ?? params.category
        },
        {
          field: "status",
          label: "Status",
          before: ENTRY_STATUS_LABELS[entry.status],
          after: ENTRY_STATUS_LABELS[params.status]
        },
        {
          field: "initialAmountCents",
          label: "Initial / Expected Amount",
          before: formatEur(entry.initialAmountCents),
          after: formatEur(initialAmountCents)
        },
        {
          field: "confirmedAmountCents",
          label: "Confirmed Amount",
          before: fmtNullableEur(entry.confirmedAmountCents),
          after: fmtNullableEur(confirmedAmountCents)
        },
        { field: "entryDate", label: "Entry Date", before: entry.entryDate, after: nextEntryDate },
        { field: "comment", label: "Comment", before: entry.comment, after: nextComment },
        {
          field: "createdById",
          label: "Creator",
          before: fmtUser(entry.createdById),
          after: fmtUser(params.createdById)
        },
        {
          field: "confirmedById",
          label: "Confirmed By",
          before: fmtUser(entry.confirmedById),
          after: fmtUser(nextConfirmedById)
        },
        {
          field: "confirmedAt",
          label: "Confirmed At",
          before: fmtNullableTs(entry.confirmedAt),
          after: fmtNullableTs(confirmedAt)
        },
        {
          field: "createdAt",
          label: "Created At",
          before: formatDateTime(entry.createdAt),
          after: formatDateTime(createdAt)
        }
      ]);

      const totalChanges = changes.length + attSync.changeNotes.length;
      const cleanReason = params.editReason?.trim() || "";
      if (totalChanges === 0 && !cleanReason) {
        return { entryCode: entry.entryCode, changedCount: 0 };
      }

      const now = new Date();
      await tx
        .update(moneyEntries)
        .set({
          entryCode: nextEntryCode,
          seasonId: params.seasonId,
          title: nextTitle,
          category: params.category,
          status: params.status,
          initialAmountCents,
          confirmedAmountCents,
          entryDate: nextEntryDate,
          comment: nextComment,
          createdById: params.createdById,
          confirmedById: nextConfirmedById,
          confirmedAt,
          createdAt,
          updatedAt: now
        })
        .where(eq(moneyEntries.id, entry.id));

      const logText = formatDiffSummaryLines({
        changes,
        extraLines: attSync.changeNotes,
        reason: cleanReason
      });

      await tx.insert(entryTimeline).values({
        entryId: entry.id,
        actorId: actor.id,
        eventType: "master_edited",
        fromStatus: entry.status,
        toStatus: params.status,
        comment: logText,
        metadataJson: {
          reason: cleanReason || null,
          changes,
          attachmentChanges: attSync.changeNotes
        }
      });

      const changedLabels = [
        ...changes.map(c => c.label),
        ...(attSync.changeNotes.length > 0 ? ["Attachments"] : [])
      ];

      await recordAuditLog(tx, {
        seasonId: params.seasonId,
        actorId: actor.id,
        actorLabel: `${actor.fullName} (Master)`,
        action: "master_entry_edited",
        targetType: "entry",
        targetId: entry.id,
        targetCode: nextEntryCode,
        summary: `Master edited entry ${nextEntryCode} "${nextTitle}" (${changedLabels.join(", ") || "note added"})`,
        details: {
          previousEntryCode: entry.entryCode,
          nextEntryCode,
          reason: cleanReason || null,
          changes,
          attachmentChanges: attSync.changeNotes
        }
      });

      return { entryCode: nextEntryCode, changedCount: Math.max(1, totalChanges) };
    });

    await Promise.all(removedKeys.map(k => deleteStoredFileQuietly(k)));
    return result;
  } catch (err) {
    await Promise.all(savedUploads.map(u => deleteStoredFileQuietly(u.saved.storageKey)));
    throw err;
  }
}

/** Master-only permanent deletion of a money entry, its item log, and attachments. */
export async function masterDeleteMoneyEntry(
  actor: PublicUser,
  entryId: string,
  reason: string
): Promise<{ entryCode: string; title: string }> {
  if (actor.role !== "master") {
    throw new Error("FORBIDDEN: Master account privileges required.");
  }
  await ensureDbReady();
  const db = getDb();
  const cleanReason = reason.trim();

  let removedKeys: string[] = [];
  const deletedInfo = await db.transaction(async tx => {
    const [entry] = await tx
      .select()
      .from(moneyEntries)
      .where(eq(moneyEntries.id, entryId))
      .limit(1);
    if (!entry) throw new Error("Money entry not found.");

    const attResult = await purgeEntityAttachments(tx, "entry", entry.id);
    removedKeys = attResult.removedKeys;

    await tx.delete(moneyEntries).where(eq(moneyEntries.id, entry.id));

    await recordAuditLog(tx, {
      seasonId: entry.seasonId,
      actorId: actor.id,
      actorLabel: `${actor.fullName} (Master)`,
      action: "master_entry_deleted",
      targetType: "entry",
      targetId: entry.id,
      targetCode: entry.entryCode,
      summary: `Master deleted entry ${entry.entryCode} "${entry.title}" (${ENTRY_STATUS_LABELS[entry.status]})${cleanReason ? ` — Reason: ${cleanReason}` : ""}`,
      details: {
        reason: cleanReason || null,
        deletedAttachmentCount: attResult.count,
        snapshot: {
          entryCode: entry.entryCode,
          category: entry.category,
          title: entry.title,
          status: entry.status,
          initialAmountCents: entry.initialAmountCents,
          confirmedAmountCents: entry.confirmedAmountCents,
          entryDate: entry.entryDate
        }
      }
    });

    return { entryCode: entry.entryCode, title: entry.title };
  });

  await Promise.all(removedKeys.map(k => deleteStoredFileQuietly(k)));
  return deletedInfo;
}
