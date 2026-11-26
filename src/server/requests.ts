import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import {
  DEPARTMENT_MAP,
  REQUEST_STATUS_LABELS,
  type DepartmentId,
  type RequestStatus
} from "~/lib/constants";
import { formatDateTime, formatEur, parseEurToCents } from "~/lib/format";
import {
  diffRecordFields,
  formatDiffSummaryLines,
  parseOptionalTimestamp,
  parseRequiredTimestamp
} from "~/lib/master-diff";
import {
  canEditOrWithdrawUnreviewedRequest,
  canRespondToCounterProposition
} from "~/lib/permissions";
import {
  computeOptionTotalCents,
  computeOrderTotalCents,
  parseRequestQuantity,
  resolveRequestTransition
} from "~/lib/workflow";
import { purgeEntityAttachments, saveUploadGroups, syncEntityAttachments } from "./attachment-sync";
import { recordAuditLog } from "./audit";
import type { PublicUser } from "./auth";
import { getDb } from "./db";
import { ensureDbReady } from "./db/bootstrap";
import {
  attachments,
  buyingOptions,
  departmentBudgets,
  departmentCounters,
  purchaseRequests,
  requestTimeline,
  seasons,
  users
} from "./db/schema";
import { deleteStoredFileQuietly, saveUploadedFile } from "./storage";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RequestOptionInput {
  label: string;
  productUrl?: string | null;
  unitPriceEur?: string;
  priceEur?: string;
  drawbacks: string;
  notes?: string | null;
}

function parseBuyingOptionsForQuantity<T extends RequestOptionInput>(
  options: T[],
  rawQuantity: number,
  opts: { allowZero: boolean }
): Array<{
  sortOrder: number;
  label: string;
  productUrl: string | null;
  unitPriceCents: number;
  priceCents: number;
  drawbacks: string;
  notes: string | null;
  source: T;
}> {
  const quantity = parseRequestQuantity(rawQuantity);
  if (quantity === null) {
    throw new Error("Quantity must be a whole number between 1 and 100,000.");
  }
  return options.map((opt, idx) => {
    const rawUnit = (opt.unitPriceEur ?? opt.priceEur ?? "").trim();
    const unitPriceCents = parseEurToCents(rawUnit, { allowZero: opts.allowZero });
    if (unitPriceCents === null) {
      throw new Error(`Option #${idx + 1} (${opt.label || "untitled"}) has an invalid unit EUR price.`);
    }
    const priceCents = computeOptionTotalCents(unitPriceCents, quantity);
    if (priceCents === null) {
      throw new Error(
        `Option #${idx + 1} (${opt.label || "untitled"}) total price (unit price × quantity) exceeds maximum supported Euro amount.`
      );
    }
    return {
      sortOrder: idx,
      label: opt.label.trim(),
      productUrl: opt.productUrl?.trim() || null,
      unitPriceCents,
      priceCents,
      drawbacks: opt.drawbacks.trim(),
      notes: opt.notes?.trim() || null,
      source: opt
    };
  });
}

export async function getActiveSeasonOrThrow() {
  await ensureDbReady();
  const db = getDb();
  const [season] = await db
    .select()
    .from(seasons)
    .where(eq(seasons.status, "active"))
    .orderBy(desc(seasons.createdAt))
    .limit(1);
  if (!season) {
    throw new Error("No active season budget found. Ask the Master account to create one.");
  }
  return season;
}

async function assertSeasonActiveForMutation(seasonId: string) {
  const db = getDb();
  const [season] = await db.select().from(seasons).where(eq(seasons.id, seasonId)).limit(1);
  if (!season) throw new Error("Season not found.");
  if (season.status !== "active") {
    throw new Error(`Season "${season.name}" is archived and read-only.`);
  }
  return season;
}

export async function createPurchaseRequest(
  actor: PublicUser,
  params: {
    title: string;
    quantity?: number;
    department: DepartmentId;
    carSystem: string;
    explanation: string;
    options: RequestOptionInput[];
    photoFiles: File[];
    documentFiles: File[];
  }
) {
  await ensureDbReady();
  const activeSeason = await getActiveSeasonOrThrow();

  if (params.options.length === 0) {
    throw new Error("At least one buying option is required.");
  }

  const quantity = parseRequestQuantity(params.quantity ?? 1);
  if (quantity === null) {
    throw new Error("Quantity must be a whole number between 1 and 100,000.");
  }

  const parsedOptions = parseBuyingOptionsForQuantity(params.options, quantity, {
    allowZero: false
  }).map(({ source: _source, ...row }) => row);

  const savedFiles: Array<{
    kind: "photo" | "document";
    saved: Awaited<ReturnType<typeof saveUploadedFile>>;
  }> = [];

  try {
    for (const photo of params.photoFiles) {
      if (photo.size > 0) {
        savedFiles.push({
          kind: "photo",
          saved: await saveUploadedFile({ file: photo, mode: "image_only" })
        });
      }
    }
    for (const doc of params.documentFiles) {
      if (doc.size > 0) {
        savedFiles.push({
          kind: "document",
          saved: await saveUploadedFile({ file: doc, mode: "document" })
        });
      }
    }

    const db = getDb();
    const created = await db.transaction(async tx => {
      const [counter] = await tx
        .insert(departmentCounters)
        .values({
          seasonId: activeSeason.id,
          department: params.department,
          lastSeq: 1
        })
        .onConflictDoUpdate({
          target: [departmentCounters.seasonId, departmentCounters.department],
          set: {
            lastSeq: sql`${departmentCounters.lastSeq} + 1`
          }
        })
        .returning({ lastSeq: departmentCounters.lastSeq });

      const deptMeta = DEPARTMENT_MAP[params.department];
      const requestCode = `${activeSeason.yearCode}-${deptMeta.code}-${String(counter.lastSeq).padStart(3, "0")}`;

      const [reqRow] = await tx
        .insert(purchaseRequests)
        .values({
          requestCode,
          seasonId: activeSeason.id,
          department: params.department,
          carSystem: params.carSystem.trim(),
          quantity,
          title: params.title.trim(),
          explanation: params.explanation.trim(),
          status: "pending_review",
          creatorId: actor.id
        })
        .returning();

      await tx.insert(buyingOptions).values(
        parsedOptions.map(opt => ({
          requestId: reqRow.id,
          ...opt
        }))
      );

      if (savedFiles.length > 0) {
        await tx.insert(attachments).values(
          savedFiles.map(item => ({
            entityType: "request" as const,
            entityId: reqRow.id,
            kind: item.kind,
            originalName: item.saved.originalName,
            storageKey: item.saved.storageKey,
            mimeType: item.saved.mimeType,
            sizeBytes: item.saved.sizeBytes,
            uploadedById: actor.id
          }))
        );
      }

      await tx.insert(requestTimeline).values({
        requestId: reqRow.id,
        actorId: actor.id,
        eventType: "submitted",
        fromStatus: null,
        toStatus: "pending_review",
        comment: `Submitted purchase request (qty ${quantity}) with ${parsedOptions.length} option(s).`,
        metadataJson: {
          quantity,
          optionCount: parsedOptions.length,
          attachmentsCount: savedFiles.length
        }
      });

      await recordAuditLog(tx, {
        seasonId: activeSeason.id,
        actorId: actor.id,
        actorLabel: `${actor.fullName} (${actor.title})`,
        action: "request_created",
        targetType: "request",
        targetId: reqRow.id,
        targetCode: reqRow.requestCode,
        summary: `Created request ${reqRow.requestCode} "${reqRow.title}" (qty ${quantity} · ${deptMeta.label} · ${reqRow.carSystem})`
      });

      return reqRow;
    });

    return created;
  } catch (err) {
    await Promise.all(savedFiles.map(f => deleteStoredFileQuietly(f.saved.storageKey)));
    throw err;
  }
}

export async function listPurchaseRequests(params: {
  seasonId: string;
  department?: DepartmentId | "all";
  status?: RequestStatus | "all" | "archived";
  search?: string;
}) {
  await ensureDbReady();
  const db = getDb();

  const conditions = [eq(purchaseRequests.seasonId, params.seasonId)];
  if (params.department && params.department !== "all") {
    conditions.push(eq(purchaseRequests.department, params.department));
  }
  if (params.status && params.status !== "all") {
    if (params.status === "archived") {
      conditions.push(
        inArray(purchaseRequests.status, [
          "denied_archived",
          "withdrawn_archived",
          "order_cancelled_archived"
        ])
      );
    } else {
      conditions.push(eq(purchaseRequests.status, params.status));
    }
  }
  if (params.search && params.search.trim()) {
    const q = `%${params.search.trim()}%`;
    conditions.push(
      or(
        ilike(purchaseRequests.requestCode, q),
        ilike(purchaseRequests.title, q),
        ilike(purchaseRequests.carSystem, q),
        ilike(purchaseRequests.explanation, q)
      )!
    );
  }

  const rows = await db
    .select({
      request: purchaseRequests,
      creatorName: users.fullName,
      creatorTitle: users.title,
      creatorAvatarId: users.avatarAttachmentId
    })
    .from(purchaseRequests)
    .innerJoin(users, eq(purchaseRequests.creatorId, users.id))
    .where(and(...conditions))
    .orderBy(desc(purchaseRequests.createdAt));

  if (rows.length === 0) return [];

  const reqIds = rows.map(r => r.request.id);
  const allOpts = await db
    .select()
    .from(buyingOptions)
    .where(inArray(buyingOptions.requestId, reqIds))
    .orderBy(asc(buyingOptions.sortOrder));

  const allAttachments = await db
    .select({
      id: attachments.id,
      entityId: attachments.entityId,
      kind: attachments.kind,
      originalName: attachments.originalName,
      mimeType: attachments.mimeType
    })
    .from(attachments)
    .where(and(eq(attachments.entityType, "request"), inArray(attachments.entityId, reqIds)));

  const optMap = new Map<string, typeof allOpts>();
  for (const o of allOpts) {
    const arr = optMap.get(o.requestId) ?? [];
    arr.push(o);
    optMap.set(o.requestId, arr);
  }

  const attMap = new Map<string, typeof allAttachments>();
  for (const a of allAttachments) {
    const arr = attMap.get(a.entityId) ?? [];
    arr.push(a);
    attMap.set(a.entityId, arr);
  }

  return rows.map(({ request, creatorName, creatorTitle, creatorAvatarId }) => {
    const opts = optMap.get(request.id) ?? [];
    const atts = attMap.get(request.id) ?? [];
    const minPriceCents = opts.length > 0 ? Math.min(...opts.map(o => o.priceCents)) : 0;
    const maxPriceCents = opts.length > 0 ? Math.max(...opts.map(o => o.priceCents)) : 0;
    const effectiveTotalCents =
      request.status === "order" || request.status === "spending"
        ? computeOrderTotalCents(request)
        : null;

    return {
      id: request.id,
      requestCode: request.requestCode,
      seasonId: request.seasonId,
      department: request.department,
      carSystem: request.carSystem,
      quantity: request.quantity,
      title: request.title,
      explanation: request.explanation,
      status: request.status,
      creatorId: request.creatorId,
      creatorName,
      creatorTitle,
      creatorAvatarId: creatorAvatarId ?? null,
      hasApproverResponse: request.hasApproverResponse,
      optionCount: opts.length,
      minPriceCents,
      maxPriceCents,
      selectedOptionPriceCents: request.selectedOptionPriceCents,
      shippingCents: request.shippingCents,
      importFeeCents: request.importFeeCents,
      finalAmountCents: request.finalAmountCents,
      effectiveTotalCents,
      photoCount: atts.filter(a => a.kind === "photo").length,
      docCount: atts.filter(a => a.kind === "document").length,
      invoiceAttachmentId: atts.find(a => a.kind === "invoice")?.id ?? null,
      firstPhotoId: atts.find(a => a.kind === "photo")?.id ?? null,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
      orderedAt: request.orderedAt ? request.orderedAt.toISOString() : null,
      invoicedAt: request.invoicedAt ? request.invoicedAt.toISOString() : null
    };
  });
}

export async function getPurchaseRequestDetail(idOrCode: string) {
  await ensureDbReady();
  const db = getDb();
  const trimmed = idOrCode.trim();

  const whereClause = UUID_RE.test(trimmed)
    ? eq(purchaseRequests.id, trimmed)
    : eq(purchaseRequests.requestCode, trimmed.toUpperCase());

  const [reqRow] = await db.select().from(purchaseRequests).where(whereClause).limit(1);
  if (!reqRow) return null;

  const [season] = await db.select().from(seasons).where(eq(seasons.id, reqRow.seasonId)).limit(1);
  const options = await db
    .select()
    .from(buyingOptions)
    .where(eq(buyingOptions.requestId, reqRow.id))
    .orderBy(asc(buyingOptions.sortOrder));

  const files = await db
    .select({
      id: attachments.id,
      kind: attachments.kind,
      originalName: attachments.originalName,
      mimeType: attachments.mimeType,
      sizeBytes: attachments.sizeBytes,
      createdAt: attachments.createdAt,
      uploaderName: users.fullName
    })
    .from(attachments)
    .innerJoin(users, eq(attachments.uploadedById, users.id))
    .where(and(eq(attachments.entityType, "request"), eq(attachments.entityId, reqRow.id)))
    .orderBy(asc(attachments.createdAt));

  const timeline = await db
    .select({
      id: requestTimeline.id,
      eventType: requestTimeline.eventType,
      fromStatus: requestTimeline.fromStatus,
      toStatus: requestTimeline.toStatus,
      comment: requestTimeline.comment,
      metadataJson: requestTimeline.metadataJson,
      createdAt: requestTimeline.createdAt,
      actorId: users.id,
      actorName: users.fullName,
      actorTitle: users.title,
      actorRole: users.role,
      actorAvatarId: users.avatarAttachmentId
    })
    .from(requestTimeline)
    .innerJoin(users, eq(requestTimeline.actorId, users.id))
    .where(eq(requestTimeline.requestId, reqRow.id))
    .orderBy(asc(requestTimeline.createdAt));

  const [creator] = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      title: users.title,
      role: users.role,
      avatarAttachmentId: users.avatarAttachmentId
    })
    .from(users)
    .where(eq(users.id, reqRow.creatorId))
    .limit(1);

  const [deptAlloc] = await db
    .select({ allocatedCents: departmentBudgets.allocatedCents })
    .from(departmentBudgets)
    .where(
      and(
        eq(departmentBudgets.seasonId, reqRow.seasonId),
        eq(departmentBudgets.department, reqRow.department)
      )
    )
    .limit(1);

  const deptSpendRows = await db
    .select({
      status: purchaseRequests.status,
      selectedOptionPriceCents: purchaseRequests.selectedOptionPriceCents,
      shippingCents: purchaseRequests.shippingCents,
      importFeeCents: purchaseRequests.importFeeCents,
      finalAmountCents: purchaseRequests.finalAmountCents
    })
    .from(purchaseRequests)
    .where(
      and(
        eq(purchaseRequests.seasonId, reqRow.seasonId),
        eq(purchaseRequests.department, reqRow.department),
        inArray(purchaseRequests.status, ["order", "spending"])
      )
    );

  const deptSpentAndCommittedCents = deptSpendRows.reduce(
    (sum, r) => sum + computeOrderTotalCents(r),
    0
  );

  return {
    id: reqRow.id,
    requestCode: reqRow.requestCode,
    seasonId: reqRow.seasonId,
    seasonName: season?.name ?? "Season",
    seasonStatus: season?.status ?? "active",
    department: reqRow.department,
    carSystem: reqRow.carSystem,
    quantity: reqRow.quantity,
    departmentBudgetContext: {
      allocatedCents: deptAlloc && deptAlloc.allocatedCents > 0 ? deptAlloc.allocatedCents : null,
      spentAndCommittedCents: deptSpentAndCommittedCents
    },
    title: reqRow.title,
    explanation: reqRow.explanation,
    status: reqRow.status,
    hasApproverResponse: reqRow.hasApproverResponse,
    selectedOptionId: reqRow.selectedOptionId,
    selectedOptionPriceCents: reqRow.selectedOptionPriceCents,
    shippingCents: reqRow.shippingCents,
    importFeeCents: reqRow.importFeeCents,
    finalAmountCents: reqRow.finalAmountCents,
    effectiveTotalCents: computeOrderTotalCents(reqRow),
    version: reqRow.version,
    createdAt: reqRow.createdAt.toISOString(),
    updatedAt: reqRow.updatedAt.toISOString(),
    orderedById: reqRow.orderedById ?? null,
    orderedAt: reqRow.orderedAt ? reqRow.orderedAt.toISOString() : null,
    invoicedById: reqRow.invoicedById ?? null,
    invoicedAt: reqRow.invoicedAt ? reqRow.invoicedAt.toISOString() : null,
    archivedAt: reqRow.archivedAt ? reqRow.archivedAt.toISOString() : null,
    creator: creator
      ? { ...creator, avatarAttachmentId: creator.avatarAttachmentId ?? null }
      : { id: reqRow.creatorId, fullName: "Unknown", title: "", role: "requestor" as const, avatarAttachmentId: null },
    options: options.map(o => ({
      id: o.id,
      label: o.label,
      productUrl: o.productUrl,
      unitPriceCents: o.unitPriceCents,
      priceCents: o.priceCents,
      drawbacks: o.drawbacks,
      notes: o.notes
    })),
    attachments: files.map(f => ({
      id: f.id,
      kind: f.kind,
      originalName: f.originalName,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      uploaderName: f.uploaderName,
      createdAt: f.createdAt.toISOString()
    })),
    timeline: timeline.map(t => ({
      id: t.id,
      eventType: t.eventType,
      fromStatus: t.fromStatus,
      toStatus: t.toStatus,
      comment: t.comment,
      metadataJson: t.metadataJson,
      createdAt: t.createdAt.toISOString(),
      actorId: t.actorId,
      actorName: t.actorName,
      actorTitle: t.actorTitle,
      actorRole: t.actorRole,
      actorAvatarId: t.actorAvatarId ?? null
    }))
  };
}

export async function editUnreviewedPurchaseRequest(
  actor: PublicUser,
  params: {
    requestId: string;
    title: string;
    quantity?: number;
    carSystem: string;
    explanation: string;
    options: RequestOptionInput[];
    newPhotoFiles: File[];
    newDocumentFiles: File[];
    removeAttachmentIds: string[];
  }
) {
  await ensureDbReady();
  const db = getDb();

  const quantity = parseRequestQuantity(params.quantity ?? 1);
  if (quantity === null) {
    throw new Error("Quantity must be a whole number between 1 and 100,000.");
  }

  const parsedOptions = parseBuyingOptionsForQuantity(params.options, quantity, {
    allowZero: false
  }).map(({ source: _source, ...row }) => row);

  const savedFiles: Array<{
    kind: "photo" | "document";
    saved: Awaited<ReturnType<typeof saveUploadedFile>>;
  }> = [];

  try {
    for (const photo of params.newPhotoFiles) {
      if (photo.size > 0) {
        savedFiles.push({
          kind: "photo",
          saved: await saveUploadedFile({ file: photo, mode: "image_only" })
        });
      }
    }
    for (const doc of params.newDocumentFiles) {
      if (doc.size > 0) {
        savedFiles.push({
          kind: "document",
          saved: await saveUploadedFile({ file: doc, mode: "document" })
        });
      }
    }

    const removedKeys: string[] = [];

    await db.transaction(async tx => {
      const [reqRow] = await tx
        .select()
        .from(purchaseRequests)
        .where(eq(purchaseRequests.id, params.requestId))
        .limit(1);
      if (!reqRow) throw new Error("Request not found.");
      await assertSeasonActiveForMutation(reqRow.seasonId);

      if (
        !canEditOrWithdrawUnreviewedRequest({
          role: actor.role,
          userId: actor.id,
          creatorId: reqRow.creatorId,
          status: reqRow.status,
          hasApproverResponse: reqRow.hasApproverResponse
        })
      ) {
        throw new Error("You can only edit your own request before an approver has responded.");
      }

      const [updated] = await tx
        .update(purchaseRequests)
        .set({
          title: params.title.trim(),
          quantity,
          carSystem: params.carSystem.trim(),
          explanation: params.explanation.trim(),
          version: reqRow.version + 1,
          updatedAt: new Date()
        })
        .where(and(eq(purchaseRequests.id, reqRow.id), eq(purchaseRequests.version, reqRow.version)))
        .returning();

      if (!updated) throw new Error("Request was updated concurrently. Please reload and retry.");

      await tx.delete(buyingOptions).where(eq(buyingOptions.requestId, reqRow.id));
      await tx.insert(buyingOptions).values(
        parsedOptions.map(opt => ({
          requestId: reqRow.id,
          ...opt
        }))
      );

      if (params.removeAttachmentIds.length > 0) {
        const toDelete = await tx
          .select()
          .from(attachments)
          .where(
            and(
              eq(attachments.entityType, "request"),
              eq(attachments.entityId, reqRow.id),
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
            entityType: "request" as const,
            entityId: reqRow.id,
            kind: f.kind,
            originalName: f.saved.originalName,
            storageKey: f.saved.storageKey,
            mimeType: f.saved.mimeType,
            sizeBytes: f.saved.sizeBytes,
            uploadedById: actor.id
          }))
        );
      }

      await tx.insert(requestTimeline).values({
        requestId: reqRow.id,
        actorId: actor.id,
        eventType: "edited_before_review",
        fromStatus: reqRow.status,
        toStatus: reqRow.status,
        comment: `Edited request details (qty ${quantity}, ${parsedOptions.length} options).`
      });

      await recordAuditLog(tx, {
        seasonId: reqRow.seasonId,
        actorId: actor.id,
        actorLabel: `${actor.fullName} (${actor.title})`,
        action: "request_edited",
        targetType: "request",
        targetId: reqRow.id,
        targetCode: reqRow.requestCode,
        summary: `Edited unreviewed request ${reqRow.requestCode} "${updated.title}"`
      });
    });

    await Promise.all(removedKeys.map(k => deleteStoredFileQuietly(k)));
  } catch (err) {
    await Promise.all(savedFiles.map(f => deleteStoredFileQuietly(f.saved.storageKey)));
    throw err;
  }
}

export async function withdrawUnreviewedRequest(
  actor: PublicUser,
  requestId: string,
  reason: string
) {
  await ensureDbReady();
  const db = getDb();

  await db.transaction(async tx => {
    const [reqRow] = await tx
      .select()
      .from(purchaseRequests)
      .where(eq(purchaseRequests.id, requestId))
      .limit(1);
    if (!reqRow) throw new Error("Request not found.");
    await assertSeasonActiveForMutation(reqRow.seasonId);

    if (
      !canEditOrWithdrawUnreviewedRequest({
        role: actor.role,
        userId: actor.id,
        creatorId: reqRow.creatorId,
        status: reqRow.status,
        hasApproverResponse: reqRow.hasApproverResponse
      })
    ) {
      throw new Error("Cannot withdraw a request after an approver has responded.");
    }

    const nextStatus = resolveRequestTransition(reqRow.status, "requestor_withdraw");
    const [updated] = await tx
      .update(purchaseRequests)
      .set({
        status: nextStatus,
        archivedAt: new Date(),
        version: reqRow.version + 1,
        updatedAt: new Date()
      })
      .where(and(eq(purchaseRequests.id, reqRow.id), eq(purchaseRequests.version, reqRow.version)))
      .returning();

    if (!updated) throw new Error("Concurrent modification detected. Please refresh.");

    const note = reason.trim() || "Withdrawn by requestor before review.";
    await tx.insert(requestTimeline).values({
      requestId: reqRow.id,
      actorId: actor.id,
      eventType: "requestor_withdrawn",
      fromStatus: reqRow.status,
      toStatus: nextStatus,
      comment: note
    });

    await recordAuditLog(tx, {
      seasonId: reqRow.seasonId,
      actorId: actor.id,
      actorLabel: `${actor.fullName} (${actor.title})`,
      action: "request_withdrawn",
      targetType: "request",
      targetId: reqRow.id,
      targetCode: reqRow.requestCode,
      summary: `Withdrew request ${reqRow.requestCode} before review`
    });
  });
}

export async function addRequestComment(actor: PublicUser, requestId: string, comment: string) {
  await ensureDbReady();
  if (actor.role === "viewer") {
    throw new Error("Viewers have read-only access and cannot post comments.");
  }
  const clean = comment.trim();
  if (!clean) throw new Error("Comment cannot be empty.");

  const db = getDb();
  await db.transaction(async tx => {
    const [reqRow] = await tx
      .select()
      .from(purchaseRequests)
      .where(eq(purchaseRequests.id, requestId))
      .limit(1);
    if (!reqRow) throw new Error("Request not found.");
    await assertSeasonActiveForMutation(reqRow.seasonId);

    await tx.insert(requestTimeline).values({
      requestId: reqRow.id,
      actorId: actor.id,
      eventType: "discussion_comment",
      fromStatus: reqRow.status,
      toStatus: reqRow.status,
      comment: clean
    });

    await recordAuditLog(tx, {
      seasonId: reqRow.seasonId,
      actorId: actor.id,
      actorLabel: `${actor.fullName} (${actor.title})`,
      action: "request_commented",
      targetType: "request",
      targetId: reqRow.id,
      targetCode: reqRow.requestCode,
      summary: `Commented on ${reqRow.requestCode}: "${clean.slice(0, 80)}${clean.length > 80 ? "..." : ""}"`
    });
  });
}

export async function performApproverReview(
  actor: PublicUser,
  params: {
    requestId: string;
    decision: "approve" | "deny" | "counter_propose";
    comment: string;
  }
) {
  await ensureDbReady();
  const db = getDb();
  const cleanComment = params.comment.trim();
  if (!cleanComment) {
    throw new Error("A comment is required when reviewing a request.");
  }

  const actionMap = {
    approve: "approver_approve",
    deny: "approver_deny",
    counter_propose: "approver_counter_propose"
  } as const;

  await db.transaction(async tx => {
    const [reqRow] = await tx
      .select()
      .from(purchaseRequests)
      .where(eq(purchaseRequests.id, params.requestId))
      .limit(1);
    if (!reqRow) throw new Error("Request not found.");
    await assertSeasonActiveForMutation(reqRow.seasonId);

    const nextStatus = resolveRequestTransition(reqRow.status, actionMap[params.decision]);

    const [updated] = await tx
      .update(purchaseRequests)
      .set({
        status: nextStatus,
        hasApproverResponse: true,
        archivedAt: nextStatus === "denied_archived" ? new Date() : null,
        version: reqRow.version + 1,
        updatedAt: new Date()
      })
      .where(and(eq(purchaseRequests.id, reqRow.id), eq(purchaseRequests.version, reqRow.version)))
      .returning();

    if (!updated) throw new Error("Request was updated by another member. Please refresh.");

    await tx.insert(requestTimeline).values({
      requestId: reqRow.id,
      actorId: actor.id,
      eventType: actionMap[params.decision],
      fromStatus: reqRow.status,
      toStatus: nextStatus,
      comment: cleanComment
    });

    await recordAuditLog(tx, {
      seasonId: reqRow.seasonId,
      actorId: actor.id,
      actorLabel: `${actor.fullName} (${actor.title})`,
      action: actionMap[params.decision],
      targetType: "request",
      targetId: reqRow.id,
      targetCode: reqRow.requestCode,
      summary: `${REQUEST_STATUS_LABELS[nextStatus]} — ${reqRow.requestCode}: "${cleanComment.slice(0, 80)}"`
    });
  });
}

export async function respondToCounterProposition(
  actor: PublicUser,
  params: {
    requestId: string;
    decision: "accept" | "counter_argue" | "deny";
    comment: string;
  }
) {
  await ensureDbReady();
  const db = getDb();
  const cleanComment = params.comment.trim();
  if (params.decision === "counter_argue" && !cleanComment) {
    throw new Error("Please explain your counter-argument.");
  }

  const actionMap = {
    accept: "requestor_accept_counter",
    counter_argue: "requestor_counter_argue",
    deny: "requestor_deny_counter"
  } as const;

  const defaultComments = {
    accept: "Accepted the approver's counter-proposition.",
    counter_argue: cleanComment,
    deny: "Declined the counter-proposition; request archived."
  };

  await db.transaction(async tx => {
    const [reqRow] = await tx
      .select()
      .from(purchaseRequests)
      .where(eq(purchaseRequests.id, params.requestId))
      .limit(1);
    if (!reqRow) throw new Error("Request not found.");
    await assertSeasonActiveForMutation(reqRow.seasonId);

    if (
      !canRespondToCounterProposition({
        role: actor.role,
        userId: actor.id,
        creatorId: reqRow.creatorId,
        status: reqRow.status
      })
    ) {
      throw new Error("Only the original requestor (or Master) can respond to this counter-proposition.");
    }

    const nextStatus = resolveRequestTransition(reqRow.status, actionMap[params.decision]);

    const [updated] = await tx
      .update(purchaseRequests)
      .set({
        status: nextStatus,
        archivedAt: nextStatus === "denied_archived" ? new Date() : null,
        version: reqRow.version + 1,
        updatedAt: new Date()
      })
      .where(and(eq(purchaseRequests.id, reqRow.id), eq(purchaseRequests.version, reqRow.version)))
      .returning();

    if (!updated) throw new Error("Concurrent modification detected. Please refresh.");

    const finalComment = cleanComment || defaultComments[params.decision];

    await tx.insert(requestTimeline).values({
      requestId: reqRow.id,
      actorId: actor.id,
      eventType: actionMap[params.decision],
      fromStatus: reqRow.status,
      toStatus: nextStatus,
      comment: finalComment
    });

    await recordAuditLog(tx, {
      seasonId: reqRow.seasonId,
      actorId: actor.id,
      actorLabel: `${actor.fullName} (${actor.title})`,
      action: actionMap[params.decision],
      targetType: "request",
      targetId: reqRow.id,
      targetCode: reqRow.requestCode,
      summary: `Requestor responded (${params.decision.replace("_", " ")}) on ${reqRow.requestCode}`
    });
  });
}

export async function resolveStageTwoSelection(
  actor: PublicUser,
  params: {
    requestId: string;
    decision: "confirm_option" | "deny";
    optionId?: string;
    comment?: string;
  }
) {
  await ensureDbReady();
  const db = getDb();

  await db.transaction(async tx => {
    const [reqRow] = await tx
      .select()
      .from(purchaseRequests)
      .where(eq(purchaseRequests.id, params.requestId))
      .limit(1);
    if (!reqRow) throw new Error("Request not found.");
    await assertSeasonActiveForMutation(reqRow.seasonId);

    if (params.decision === "deny") {
      const cleanComment = (params.comment || "").trim();
      if (!cleanComment) throw new Error("Please add a comment explaining why the request is denied.");

      const nextStatus = resolveRequestTransition(reqRow.status, "approver_deny_stage2");
      const [updated] = await tx
        .update(purchaseRequests)
        .set({
          status: nextStatus,
          archivedAt: new Date(),
          version: reqRow.version + 1,
          updatedAt: new Date()
        })
        .where(and(eq(purchaseRequests.id, reqRow.id), eq(purchaseRequests.version, reqRow.version)))
        .returning();

      if (!updated) throw new Error("Concurrent modification detected. Please refresh.");

      await tx.insert(requestTimeline).values({
        requestId: reqRow.id,
        actorId: actor.id,
        eventType: "approver_deny_stage2",
        fromStatus: reqRow.status,
        toStatus: nextStatus,
        comment: cleanComment
      });

      await recordAuditLog(tx, {
        seasonId: reqRow.seasonId,
        actorId: actor.id,
        actorLabel: `${actor.fullName} (${actor.title})`,
        action: "stage2_denied",
        targetType: "request",
        targetId: reqRow.id,
        targetCode: reqRow.requestCode,
        summary: `Denied request ${reqRow.requestCode} during option selection`
      });
      return;
    }

    if (!params.optionId) {
      throw new Error("Please select one of the initial buying options.");
    }

    const [option] = await tx
      .select()
      .from(buyingOptions)
      .where(and(eq(buyingOptions.id, params.optionId), eq(buyingOptions.requestId, reqRow.id)))
      .limit(1);

    if (!option) {
      throw new Error("Selected option does not belong to this request.");
    }

    const nextStatus = resolveRequestTransition(reqRow.status, "approver_select_option");
    const now = new Date();
    const [updated] = await tx
      .update(purchaseRequests)
      .set({
        status: nextStatus,
        selectedOptionId: option.id,
        selectedOptionPriceCents: option.priceCents,
        orderedById: actor.id,
        orderedAt: now,
        version: reqRow.version + 1,
        updatedAt: now
      })
      .where(and(eq(purchaseRequests.id, reqRow.id), eq(purchaseRequests.version, reqRow.version)))
      .returning();

    if (!updated) throw new Error("Concurrent modification detected. Please refresh.");

    const qtyNote =
      reqRow.quantity > 1
        ? ` (${formatEur(option.priceCents)} = ${reqRow.quantity} × ${formatEur(option.unitPriceCents)})`
        : ` (${formatEur(option.priceCents)})`;
    const note =
      (params.comment || "").trim() ||
      `Confirmed option "${option.label}"${qtyNote}. Relabeled as Order (Provisional Spending).`;

    await tx.insert(requestTimeline).values({
      requestId: reqRow.id,
      actorId: actor.id,
      eventType: "option_selected_order_created",
      fromStatus: reqRow.status,
      toStatus: nextStatus,
      comment: note,
      metadataJson: {
        optionId: option.id,
        optionLabel: option.label,
        quantity: reqRow.quantity,
        unitPriceCents: option.unitPriceCents,
        priceCents: option.priceCents
      }
    });

    await recordAuditLog(tx, {
      seasonId: reqRow.seasonId,
      actorId: actor.id,
      actorLabel: `${actor.fullName} (${actor.title})`,
      action: "order_confirmed",
      targetType: "request",
      targetId: reqRow.id,
      targetCode: reqRow.requestCode,
      summary: `Confirmed option "${option.label}"${qtyNote} -> ${reqRow.requestCode} relabeled as Order`
    });
  });
}

export async function updateOrderSupplementalFees(
  actor: PublicUser,
  params: {
    requestId: string;
    shippingEur: string;
    importFeeEur: string;
    comment?: string;
    proofFiles?: File[];
  }
) {
  await ensureDbReady();
  const shippingCents = parseEurToCents(params.shippingEur || "0", { allowZero: true });
  const importFeeCents = parseEurToCents(params.importFeeEur || "0", { allowZero: true });
  if (shippingCents === null || importFeeCents === null) {
    throw new Error("Shipping and import fees must be valid non-negative Euro amounts.");
  }

  const savedProofs: Array<Awaited<ReturnType<typeof saveUploadedFile>>> = [];
  try {
    for (const file of params.proofFiles ?? []) {
      if (file.size > 0) {
        savedProofs.push(await saveUploadedFile({ file, mode: "document" }));
      }
    }

    const db = getDb();
    await db.transaction(async tx => {
      const [reqRow] = await tx
        .select()
        .from(purchaseRequests)
        .where(eq(purchaseRequests.id, params.requestId))
        .limit(1);
      if (!reqRow) throw new Error("Order not found.");
      await assertSeasonActiveForMutation(reqRow.seasonId);

      resolveRequestTransition(reqRow.status, "approver_update_order_fees");

      const [updated] = await tx
        .update(purchaseRequests)
        .set({
          shippingCents,
          importFeeCents,
          version: reqRow.version + 1,
          updatedAt: new Date()
        })
        .where(and(eq(purchaseRequests.id, reqRow.id), eq(purchaseRequests.version, reqRow.version)))
        .returning();

      if (!updated) throw new Error("Concurrent modification detected. Please refresh.");

      if (savedProofs.length > 0) {
        await tx.insert(attachments).values(
          savedProofs.map(p => ({
            entityType: "request" as const,
            entityId: reqRow.id,
            kind: "fee_proof" as const,
            originalName: p.originalName,
            storageKey: p.storageKey,
            mimeType: p.mimeType,
            sizeBytes: p.sizeBytes,
            uploadedById: actor.id
          }))
        );
      }

      const newTotal = computeOrderTotalCents(updated);
      const note =
        (params.comment || "").trim() ||
        `Updated supplemental charges: Shipping ${formatEur(shippingCents)}, Import fees ${formatEur(importFeeCents)}. Provisional total: ${formatEur(newTotal)}.`;

      await tx.insert(requestTimeline).values({
        requestId: reqRow.id,
        actorId: actor.id,
        eventType: "order_fees_updated",
        fromStatus: reqRow.status,
        toStatus: reqRow.status,
        comment: note,
        metadataJson: {
          shippingCents,
          importFeeCents,
          provisionalTotalCents: newTotal
        }
      });

      await recordAuditLog(tx, {
        seasonId: reqRow.seasonId,
        actorId: actor.id,
        actorLabel: `${actor.fullName} (${actor.title})`,
        action: "order_fees_updated",
        targetType: "request",
        targetId: reqRow.id,
        targetCode: reqRow.requestCode,
        summary: `Updated charges on ${reqRow.requestCode}: Shipping ${formatEur(shippingCents)}, Import ${formatEur(importFeeCents)} (Total ${formatEur(newTotal)})`
      });
    });
  } catch (err) {
    await Promise.all(savedProofs.map(p => deleteStoredFileQuietly(p.storageKey)));
    throw err;
  }
}

export async function cancelActiveOrder(actor: PublicUser, requestId: string, reason: string) {
  await ensureDbReady();
  const cleanReason = reason.trim();
  if (!cleanReason) {
    throw new Error("Please provide a reason for cancelling this order.");
  }

  const db = getDb();
  await db.transaction(async tx => {
    const [reqRow] = await tx
      .select()
      .from(purchaseRequests)
      .where(eq(purchaseRequests.id, requestId))
      .limit(1);
    if (!reqRow) throw new Error("Order not found.");
    await assertSeasonActiveForMutation(reqRow.seasonId);

    const nextStatus = resolveRequestTransition(reqRow.status, "approver_cancel_order");
    const [updated] = await tx
      .update(purchaseRequests)
      .set({
        status: nextStatus,
        archivedAt: new Date(),
        version: reqRow.version + 1,
        updatedAt: new Date()
      })
      .where(and(eq(purchaseRequests.id, reqRow.id), eq(purchaseRequests.version, reqRow.version)))
      .returning();

    if (!updated) throw new Error("Concurrent modification detected. Please refresh.");

    await tx.insert(requestTimeline).values({
      requestId: reqRow.id,
      actorId: actor.id,
      eventType: "order_cancelled",
      fromStatus: reqRow.status,
      toStatus: nextStatus,
      comment: cleanReason
    });

    await recordAuditLog(tx, {
      seasonId: reqRow.seasonId,
      actorId: actor.id,
      actorLabel: `${actor.fullName} (${actor.title})`,
      action: "order_cancelled",
      targetType: "request",
      targetId: reqRow.id,
      targetCode: reqRow.requestCode,
      summary: `Cancelled order ${reqRow.requestCode} (removed from provisional spendings): ${cleanReason}`
    });
  });
}

export async function finalizeOrderWithInvoice(
  actor: PublicUser,
  params: {
    requestId: string;
    invoiceFile: File;
    finalAmountEur?: string;
    comment?: string;
  }
) {
  await ensureDbReady();
  if (!params.invoiceFile || params.invoiceFile.size <= 0) {
    throw new Error("An invoice file is required to mark an order as a final spending.");
  }

  let customFinalCents: number | null = null;
  if (params.finalAmountEur && params.finalAmountEur.trim().length > 0) {
    customFinalCents = parseEurToCents(params.finalAmountEur, { allowZero: false });
    if (customFinalCents === null) {
      throw new Error("Adjusted final invoice amount must be a valid positive Euro amount.");
    }
  }

  const savedInvoice = await saveUploadedFile({ file: params.invoiceFile, mode: "document" });

  try {
    const db = getDb();
    await db.transaction(async tx => {
      const [reqRow] = await tx
        .select()
        .from(purchaseRequests)
        .where(eq(purchaseRequests.id, params.requestId))
        .limit(1);
      if (!reqRow) throw new Error("Order not found.");
      await assertSeasonActiveForMutation(reqRow.seasonId);

      const nextStatus = resolveRequestTransition(reqRow.status, "approver_upload_invoice");
      const estimatedTotal = computeOrderTotalCents(reqRow);
      const finalAmountCents = customFinalCents ?? estimatedTotal;
      const now = new Date();

      const [updated] = await tx
        .update(purchaseRequests)
        .set({
          status: nextStatus,
          finalAmountCents,
          invoicedById: actor.id,
          invoicedAt: now,
          version: reqRow.version + 1,
          updatedAt: now
        })
        .where(and(eq(purchaseRequests.id, reqRow.id), eq(purchaseRequests.version, reqRow.version)))
        .returning();

      if (!updated) throw new Error("Concurrent modification detected. Please refresh.");

      await tx.insert(attachments).values({
        entityType: "request",
        entityId: reqRow.id,
        kind: "invoice",
        originalName: savedInvoice.originalName,
        storageKey: savedInvoice.storageKey,
        mimeType: savedInvoice.mimeType,
        sizeBytes: savedInvoice.sizeBytes,
        uploadedById: actor.id
      });

      const note =
        (params.comment || "").trim() ||
        `Uploaded invoice (${savedInvoice.originalName}). Finalized spending at ${formatEur(finalAmountCents)}.`;

      await tx.insert(requestTimeline).values({
        requestId: reqRow.id,
        actorId: actor.id,
        eventType: "invoice_uploaded_spending",
        fromStatus: reqRow.status,
        toStatus: nextStatus,
        comment: note,
        metadataJson: {
          estimatedCents: estimatedTotal,
          finalAmountCents,
          invoiceName: savedInvoice.originalName
        }
      });

      await recordAuditLog(tx, {
        seasonId: reqRow.seasonId,
        actorId: actor.id,
        actorLabel: `${actor.fullName} (${actor.title})`,
        action: "spending_finalized",
        targetType: "request",
        targetId: reqRow.id,
        targetCode: reqRow.requestCode,
        summary: `Uploaded invoice on ${reqRow.requestCode} -> Final Spending (${formatEur(finalAmountCents)})`
      });
    });
  } catch (err) {
    await deleteStoredFileQuietly(savedInvoice.storageKey);
    throw err;
  }
}

export interface MasterOptionPayload {
  id?: string | null;
  clientKey: string;
  label: string;
  productUrl?: string | null;
  unitPriceEur?: string;
  priceEur?: string;
  drawbacks: string;
  notes?: string | null;
}

export interface MasterUpdateRequestParams {
  requestId: string;
  requestCode: string;
  seasonId: string;
  department: DepartmentId;
  carSystem: string;
  quantity?: number;
  title: string;
  explanation: string;
  status: RequestStatus;
  creatorId: string;
  hasApproverResponse: boolean;
  selectedOptionClientKey?: string | null;
  selectedOptionPriceEur?: string | null;
  shippingEur: string;
  importFeeEur: string;
  finalAmountEur?: string | null;
  orderedById?: string | null;
  orderedAt?: string | null;
  invoicedById?: string | null;
  invoicedAt?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  options: MasterOptionPayload[];
  attachmentUpdates: Array<{
    id: string;
    originalName: string;
    kind: "photo" | "document" | "invoice" | "fee_proof";
  }>;
  removeAttachmentIds: string[];
  newPhotoFiles: File[];
  newDocumentFiles: File[];
  newFeeProofFiles: File[];
  newInvoiceFiles: File[];
  editReason?: string;
}

function parseNullableEurField(
  raw: string | null | undefined,
  fieldLabel: string
): number | null {
  if (!raw || !raw.trim()) return null;
  const cents = parseEurToCents(raw, { allowZero: true });
  if (cents === null) {
    throw new Error(`${fieldLabel} must be blank or a valid non-negative Euro amount.`);
  }
  return cents;
}

async function syncRequestBuyingOptions(
  tx: Pick<ReturnType<typeof getDb>, "select" | "insert" | "update" | "delete">,
  params: {
    requestId: string;
    incoming: Array<{
      id?: string | null;
      clientKey: string;
      sortOrder: number;
      label: string;
      productUrl: string | null;
      unitPriceCents: number;
      priceCents: number;
      drawbacks: string;
      notes: string | null;
    }>;
    selectedClientKey?: string | null;
  }
): Promise<{
  selectedOptionId: string | null;
  selectedOptionLabel: string | null;
  prevSelectedOptionLabel: string | null;
  changeNotes: string[];
  prevSelectedOptionIdWasSet: string | null;
}> {
  const existingRows = await tx
    .select()
    .from(buyingOptions)
    .where(eq(buyingOptions.requestId, params.requestId))
    .orderBy(asc(buyingOptions.sortOrder));

  const existingById = new Map(existingRows.map(r => [r.id, r]));
  const keptExistingIds = new Set<string>();
  const clientKeyToDbId = new Map<string, string>();
  const dbIdToLabel = new Map<string, string>();
  const changeNotes: string[] = [];

  for (const opt of params.incoming) {
    const existing = opt.id ? existingById.get(opt.id) : undefined;
    if (existing) {
      keptExistingIds.add(existing.id);
      clientKeyToDbId.set(opt.clientKey, existing.id);
      dbIdToLabel.set(existing.id, opt.label);

      const diffs: string[] = [];
      if (existing.sortOrder !== opt.sortOrder) diffs.push(`order ${existing.sortOrder + 1} → ${opt.sortOrder + 1}`);
      if (existing.label !== opt.label) diffs.push(`label "${existing.label}" → "${opt.label}"`);
      if (existing.unitPriceCents !== opt.unitPriceCents) {
        diffs.push(`unit price ${formatEur(existing.unitPriceCents)} → ${formatEur(opt.unitPriceCents)}`);
      }
      if (existing.priceCents !== opt.priceCents) {
        diffs.push(`price ${formatEur(existing.priceCents)} → ${formatEur(opt.priceCents)}`);
      }
      if ((existing.productUrl ?? null) !== opt.productUrl) {
        diffs.push(`URL "${existing.productUrl ?? "—"}" → "${opt.productUrl ?? "—"}"`);
      }
      if (existing.drawbacks !== opt.drawbacks) {
        diffs.push(`drawbacks updated`);
      }
      if ((existing.notes ?? null) !== opt.notes) {
        diffs.push(`notes "${existing.notes ?? "—"}" → "${opt.notes ?? "—"}"`);
      }

      if (diffs.length > 0) {
        await tx
          .update(buyingOptions)
          .set({
            sortOrder: opt.sortOrder,
            label: opt.label,
            productUrl: opt.productUrl,
            unitPriceCents: opt.unitPriceCents,
            priceCents: opt.priceCents,
            drawbacks: opt.drawbacks,
            notes: opt.notes
          })
          .where(eq(buyingOptions.id, existing.id));
        changeNotes.push(`Updated Option #${opt.sortOrder + 1} "${opt.label}": ${diffs.join(", ")}`);
      }
    } else {
      const [inserted] = await tx
        .insert(buyingOptions)
        .values({
          requestId: params.requestId,
          sortOrder: opt.sortOrder,
          label: opt.label,
          productUrl: opt.productUrl,
          unitPriceCents: opt.unitPriceCents,
          priceCents: opt.priceCents,
          drawbacks: opt.drawbacks,
          notes: opt.notes
        })
        .returning({ id: buyingOptions.id });
      clientKeyToDbId.set(opt.clientKey, inserted.id);
      dbIdToLabel.set(inserted.id, opt.label);
      changeNotes.push(`Added Option #${opt.sortOrder + 1} "${opt.label}" (${formatEur(opt.priceCents)})`);
    }
  }

  const removedIds: string[] = [];
  for (const prev of existingRows) {
    if (!keptExistingIds.has(prev.id)) {
      removedIds.push(prev.id);
      changeNotes.push(`Removed Option "${prev.label}" (${formatEur(prev.priceCents)})`);
    }
  }
  if (removedIds.length > 0) {
    await tx.delete(buyingOptions).where(inArray(buyingOptions.id, removedIds));
  }

  let selectedOptionId: string | null = null;
  let selectedOptionLabel: string | null = null;
  const cleanKey = params.selectedClientKey?.trim() || "";
  if (cleanKey) {
    const resolvedId = clientKeyToDbId.get(cleanKey);
    if (!resolvedId) {
      throw new Error("Selected buying option does not match any remaining option on this request.");
    }
    selectedOptionId = resolvedId;
    selectedOptionLabel = dbIdToLabel.get(resolvedId) ?? resolvedId;
  }

  return {
    selectedOptionId,
    selectedOptionLabel,
    prevSelectedOptionLabel: null,
    changeNotes,
    prevSelectedOptionIdWasSet: existingRows.map(r => `${r.id}:${r.label}`).join("|")
  };
}

/** Master-only full edit across every field, buying option, timestamp, and attachment of a purchase request. */
export async function masterUpdatePurchaseRequest(
  actor: PublicUser,
  params: MasterUpdateRequestParams
): Promise<{ requestCode: string; changedCount: number }> {
  if (actor.role !== "master") {
    throw new Error("FORBIDDEN: Master account privileges required.");
  }
  await ensureDbReady();

  const quantity = parseRequestQuantity(params.quantity ?? 1);
  if (quantity === null) {
    throw new Error("Quantity must be a whole number between 1 and 100,000.");
  }

  const shippingCents = parseEurToCents(params.shippingEur, { allowZero: true });
  if (shippingCents === null) throw new Error("Shipping fee must be a non-negative Euro amount.");

  const importFeeCents = parseEurToCents(params.importFeeEur, { allowZero: true });
  if (importFeeCents === null) throw new Error("Import fee must be a non-negative Euro amount.");

  const selectedOptionPriceCents = parseNullableEurField(
    params.selectedOptionPriceEur,
    "Selected option base price"
  );
  const finalAmountCents = parseNullableEurField(params.finalAmountEur, "Final invoiced amount");

  const parsedOptions = parseBuyingOptionsForQuantity(params.options, quantity, {
    allowZero: true
  }).map(({ source, ...row }) => ({
    ...row,
    id: source.id || null,
    clientKey: source.clientKey
  }));

  const createdAt = parseRequiredTimestamp(params.createdAt, "Created timestamp");
  const orderedAt = parseOptionalTimestamp(params.orderedAt, "Ordered timestamp");
  const invoicedAt = parseOptionalTimestamp(params.invoicedAt, "Invoiced timestamp");
  const archivedAt = parseOptionalTimestamp(params.archivedAt, "Archived timestamp");

  const savedUploads = await saveUploadGroups([
    { kind: "photo" as const, files: params.newPhotoFiles, mode: "image_only" },
    { kind: "document" as const, files: params.newDocumentFiles, mode: "document" },
    { kind: "fee_proof" as const, files: params.newFeeProofFiles, mode: "document" },
    { kind: "invoice" as const, files: params.newInvoiceFiles, mode: "document" }
  ]);

  try {
    const db = getDb();
    let removedKeys: string[] = [];

    const result = await db.transaction(async tx => {
      const [reqRow] = await tx
        .select()
        .from(purchaseRequests)
        .where(eq(purchaseRequests.id, params.requestId))
        .limit(1);
      if (!reqRow) throw new Error("Purchase request not found.");

      const nextRequestCode = params.requestCode.trim().toUpperCase();
      if (nextRequestCode !== reqRow.requestCode) {
        const [dup] = await tx
          .select({ id: purchaseRequests.id })
          .from(purchaseRequests)
          .where(
            and(
              eq(purchaseRequests.requestCode, nextRequestCode),
              ne(purchaseRequests.id, reqRow.id)
            )
          )
          .limit(1);
        if (dup) {
          throw new Error(`Request ID "${nextRequestCode}" is already used by another request.`);
        }
      }

      const seasonIdsToCheck = Array.from(new Set([reqRow.seasonId, params.seasonId]));
      const seasonRows = await tx
        .select({ id: seasons.id, name: seasons.name, yearCode: seasons.yearCode })
        .from(seasons)
        .where(inArray(seasons.id, seasonIdsToCheck));
      const seasonMap = new Map(seasonRows.map(s => [s.id, `${s.name} (${s.yearCode})`]));
      if (!seasonMap.has(params.seasonId)) {
        throw new Error("Selected season does not exist.");
      }

      const nextOrderedById = params.orderedById?.trim() || null;
      const nextInvoicedById = params.invoicedById?.trim() || null;
      const userIdsNeeded = Array.from(
        new Set(
          [
            reqRow.creatorId,
            params.creatorId,
            reqRow.orderedById,
            nextOrderedById,
            reqRow.invoicedById,
            nextInvoicedById
          ].filter((id): id is string => Boolean(id))
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
      if (!userMap.has(params.creatorId)) throw new Error("Selected creator user not found.");
      if (nextOrderedById && !userMap.has(nextOrderedById)) {
        throw new Error("Selected ordered-by user not found.");
      }
      if (nextInvoicedById && !userMap.has(nextInvoicedById)) {
        throw new Error("Selected invoiced-by user not found.");
      }

      const prevSelectedOptRow = reqRow.selectedOptionId
        ? await tx
            .select({ label: buyingOptions.label })
            .from(buyingOptions)
            .where(eq(buyingOptions.id, reqRow.selectedOptionId))
            .limit(1)
        : [];
      const prevSelectedOptLabel =
        prevSelectedOptRow[0]?.label ?? (reqRow.selectedOptionId ? reqRow.selectedOptionId : "None");

      const optionSync = await syncRequestBuyingOptions(tx, {
        requestId: reqRow.id,
        incoming: parsedOptions,
        selectedClientKey: params.selectedOptionClientKey
      });

      const attSync = await syncEntityAttachments(tx, {
        entityType: "request",
        entityId: reqRow.id,
        actorId: actor.id,
        updates: params.attachmentUpdates,
        removeIds: params.removeAttachmentIds,
        savedUploads
      });
      removedKeys = attSync.removedKeys;

      const nextTitle = params.title.trim();
      const nextCarSystem = params.carSystem.trim();
      const nextExplanation = params.explanation.trim();

      const fmtNullableEur = (cents: number | null) => (cents === null ? "None" : formatEur(cents));
      const fmtNullableTs = (d: Date | null) => (d ? formatDateTime(d) : "None");
      const fmtUser = (id: string | null) => (id ? (userMap.get(id) ?? id) : "None");

      const changes = diffRecordFields([
        { field: "requestCode", label: "Request ID", before: reqRow.requestCode, after: nextRequestCode },
        {
          field: "seasonId",
          label: "Season",
          before: seasonMap.get(reqRow.seasonId) ?? reqRow.seasonId,
          after: seasonMap.get(params.seasonId) ?? params.seasonId
        },
        {
          field: "department",
          label: "Department",
          before: DEPARTMENT_MAP[reqRow.department]?.label ?? reqRow.department,
          after: DEPARTMENT_MAP[params.department]?.label ?? params.department
        },
        { field: "carSystem", label: "Car System", before: reqRow.carSystem || "—", after: nextCarSystem || "—" },
        { field: "quantity", label: "Quantity", before: String(reqRow.quantity), after: String(quantity) },
        { field: "title", label: "Title", before: reqRow.title, after: nextTitle },
        { field: "explanation", label: "Explanation", before: reqRow.explanation, after: nextExplanation },
        {
          field: "status",
          label: "Status",
          before: REQUEST_STATUS_LABELS[reqRow.status],
          after: REQUEST_STATUS_LABELS[params.status]
        },
        {
          field: "creatorId",
          label: "Creator",
          before: fmtUser(reqRow.creatorId),
          after: fmtUser(params.creatorId)
        },
        {
          field: "hasApproverResponse",
          label: "Approver Responded",
          before: reqRow.hasApproverResponse ? "Yes" : "No",
          after: params.hasApproverResponse ? "Yes" : "No"
        },
        {
          field: "selectedOptionId",
          label: "Selected Option",
          before: prevSelectedOptLabel,
          after: optionSync.selectedOptionLabel ?? "None"
        },
        {
          field: "selectedOptionPriceCents",
          label: "Selected Base Price",
          before: fmtNullableEur(reqRow.selectedOptionPriceCents),
          after: fmtNullableEur(selectedOptionPriceCents)
        },
        {
          field: "shippingCents",
          label: "Shipping Fee",
          before: formatEur(reqRow.shippingCents),
          after: formatEur(shippingCents)
        },
        {
          field: "importFeeCents",
          label: "Import / Customs Fee",
          before: formatEur(reqRow.importFeeCents),
          after: formatEur(importFeeCents)
        },
        {
          field: "finalAmountCents",
          label: "Final Invoiced Amount",
          before: fmtNullableEur(reqRow.finalAmountCents),
          after: fmtNullableEur(finalAmountCents)
        },
        {
          field: "orderedById",
          label: "Ordered By",
          before: fmtUser(reqRow.orderedById),
          after: fmtUser(nextOrderedById)
        },
        {
          field: "orderedAt",
          label: "Ordered At",
          before: fmtNullableTs(reqRow.orderedAt),
          after: fmtNullableTs(orderedAt)
        },
        {
          field: "invoicedById",
          label: "Invoiced By",
          before: fmtUser(reqRow.invoicedById),
          after: fmtUser(nextInvoicedById)
        },
        {
          field: "invoicedAt",
          label: "Invoiced At",
          before: fmtNullableTs(reqRow.invoicedAt),
          after: fmtNullableTs(invoicedAt)
        },
        {
          field: "archivedAt",
          label: "Archived At",
          before: fmtNullableTs(reqRow.archivedAt),
          after: fmtNullableTs(archivedAt)
        },
        {
          field: "createdAt",
          label: "Created At",
          before: formatDateTime(reqRow.createdAt),
          after: formatDateTime(createdAt)
        }
      ]);

      const extraLines = [...optionSync.changeNotes, ...attSync.changeNotes];
      const totalChanges = changes.length + extraLines.length;
      const cleanReason = params.editReason?.trim() || "";

      if (totalChanges === 0 && !cleanReason) {
        return { requestCode: reqRow.requestCode, changedCount: 0 };
      }

      const now = new Date();
      await tx
        .update(purchaseRequests)
        .set({
          requestCode: nextRequestCode,
          seasonId: params.seasonId,
          department: params.department,
          carSystem: nextCarSystem,
          quantity,
          title: nextTitle,
          explanation: nextExplanation,
          status: params.status,
          creatorId: params.creatorId,
          hasApproverResponse: params.hasApproverResponse,
          selectedOptionId: optionSync.selectedOptionId,
          selectedOptionPriceCents,
          shippingCents,
          importFeeCents,
          finalAmountCents,
          orderedById: nextOrderedById,
          orderedAt,
          invoicedById: nextInvoicedById,
          invoicedAt,
          archivedAt,
          createdAt,
          version: reqRow.version + 1,
          updatedAt: now
        })
        .where(eq(purchaseRequests.id, reqRow.id));

      const logText = formatDiffSummaryLines({
        changes,
        extraLines,
        reason: cleanReason
      });

      await tx.insert(requestTimeline).values({
        requestId: reqRow.id,
        actorId: actor.id,
        eventType: "master_edited",
        fromStatus: reqRow.status,
        toStatus: params.status,
        comment: logText,
        metadataJson: {
          reason: cleanReason || null,
          changes,
          optionChanges: optionSync.changeNotes,
          attachmentChanges: attSync.changeNotes
        }
      });

      const changedLabels = [
        ...changes.map(c => c.label),
        ...(optionSync.changeNotes.length > 0 ? ["Buying Options"] : []),
        ...(attSync.changeNotes.length > 0 ? ["Attachments"] : [])
      ];

      await recordAuditLog(tx, {
        seasonId: params.seasonId,
        actorId: actor.id,
        actorLabel: `${actor.fullName} (Master)`,
        action: "master_request_edited",
        targetType: "request",
        targetId: reqRow.id,
        targetCode: nextRequestCode,
        summary: `Master edited ${nextRequestCode} "${nextTitle}" (${changedLabels.join(", ") || "note added"})`,
        details: {
          previousRequestCode: reqRow.requestCode,
          nextRequestCode,
          reason: cleanReason || null,
          changes,
          optionChanges: optionSync.changeNotes,
          attachmentChanges: attSync.changeNotes
        }
      });

      return { requestCode: nextRequestCode, changedCount: Math.max(1, totalChanges) };
    });

    await Promise.all(removedKeys.map(k => deleteStoredFileQuietly(k)));
    return result;
  } catch (err) {
    await Promise.all(savedUploads.map(u => deleteStoredFileQuietly(u.saved.storageKey)));
    throw err;
  }
}

/** Master-only permanent deletion of a purchase request, its options, timeline, and attachments. */
export async function masterDeletePurchaseRequest(
  actor: PublicUser,
  requestId: string,
  reason: string
): Promise<{ requestCode: string; title: string }> {
  if (actor.role !== "master") {
    throw new Error("FORBIDDEN: Master account privileges required.");
  }
  await ensureDbReady();
  const db = getDb();
  const cleanReason = reason.trim();

  let removedKeys: string[] = [];
  const deletedInfo = await db.transaction(async tx => {
    const [reqRow] = await tx
      .select()
      .from(purchaseRequests)
      .where(eq(purchaseRequests.id, requestId))
      .limit(1);
    if (!reqRow) throw new Error("Purchase request not found.");

    const attResult = await purgeEntityAttachments(tx, "request", reqRow.id);
    removedKeys = attResult.removedKeys;

    await tx.delete(purchaseRequests).where(eq(purchaseRequests.id, reqRow.id));

    await recordAuditLog(tx, {
      seasonId: reqRow.seasonId,
      actorId: actor.id,
      actorLabel: `${actor.fullName} (Master)`,
      action: "master_request_deleted",
      targetType: "request",
      targetId: reqRow.id,
      targetCode: reqRow.requestCode,
      summary: `Master deleted request ${reqRow.requestCode} "${reqRow.title}" (${REQUEST_STATUS_LABELS[reqRow.status]})${cleanReason ? ` — Reason: ${cleanReason}` : ""}`,
      details: {
        reason: cleanReason || null,
        deletedAttachmentCount: attResult.count,
        snapshot: {
          requestCode: reqRow.requestCode,
          department: reqRow.department,
          title: reqRow.title,
          status: reqRow.status,
          finalAmountCents: reqRow.finalAmountCents,
          selectedOptionPriceCents: reqRow.selectedOptionPriceCents,
          shippingCents: reqRow.shippingCents,
          importFeeCents: reqRow.importFeeCents
        }
      }
    });

    return { requestCode: reqRow.requestCode, title: reqRow.title };
  });

  await Promise.all(removedKeys.map(k => deleteStoredFileQuietly(k)));
  return deletedInfo;
}
