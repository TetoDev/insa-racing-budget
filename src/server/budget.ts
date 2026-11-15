import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { computeBudgetAnalytics } from "~/lib/budget-analytics";
import {
  DEPARTMENT_MAP,
  ENTRY_CATEGORY_MAP,
  type DepartmentId,
  type EntryCategory,
  type RatePeriod
} from "~/lib/constants";
import { formatEur, parseEurToCents, toIsoDateInput } from "~/lib/format";
import { canTransitionEntry } from "~/lib/workflow";
import { recordAuditLog } from "./audit";
import type { PublicUser } from "./auth";
import { getDb } from "./db";
import { ensureDbReady } from "./db/bootstrap";
import {
  attachments,
  buyingOptions,
  departmentBudgets,
  entryCounters,
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
        creatorName,
        confirmedByName: entry.confirmedById ? (userNameMap.get(entry.confirmedById) ?? null) : null,
        confirmedAt: entry.confirmedAt ? entry.confirmedAt.toISOString() : null,
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
