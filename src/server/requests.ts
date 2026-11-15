import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import {
  DEPARTMENT_MAP,
  REQUEST_STATUS_LABELS,
  type DepartmentId,
  type RequestStatus
} from "~/lib/constants";
import { formatEur, parseEurToCents } from "~/lib/format";
import {
  canEditOrWithdrawUnreviewedRequest,
  canRespondToCounterProposition
} from "~/lib/permissions";
import { computeOrderTotalCents, resolveRequestTransition } from "~/lib/workflow";
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
  productUrl?: string;
  priceEur: string;
  drawbacks: string;
  notes?: string;
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

  const parsedOptions = params.options.map((opt, idx) => {
    const priceCents = parseEurToCents(opt.priceEur, { allowZero: false });
    if (priceCents === null) {
      throw new Error(`Option #${idx + 1} (${opt.label || "untitled"}) has an invalid EUR price.`);
    }
    return {
      sortOrder: idx,
      label: opt.label.trim(),
      productUrl: opt.productUrl?.trim() || null,
      priceCents,
      drawbacks: opt.drawbacks.trim(),
      notes: opt.notes?.trim() || null
    };
  });

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
        comment: `Submitted purchase request with ${parsedOptions.length} option(s).`,
        metadataJson: {
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
        summary: `Created request ${reqRow.requestCode} "${reqRow.title}" (${deptMeta.label} · ${reqRow.carSystem})`
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
    orderedAt: reqRow.orderedAt ? reqRow.orderedAt.toISOString() : null,
    invoicedAt: reqRow.invoicedAt ? reqRow.invoicedAt.toISOString() : null,
    archivedAt: reqRow.archivedAt ? reqRow.archivedAt.toISOString() : null,
    creator: creator
      ? { ...creator, avatarAttachmentId: creator.avatarAttachmentId ?? null }
      : { id: reqRow.creatorId, fullName: "Unknown", title: "", role: "requestor" as const, avatarAttachmentId: null },
    options: options.map(o => ({
      id: o.id,
      label: o.label,
      productUrl: o.productUrl,
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

  const parsedOptions = params.options.map((opt, idx) => {
    const priceCents = parseEurToCents(opt.priceEur, { allowZero: false });
    if (priceCents === null) {
      throw new Error(`Option #${idx + 1} has an invalid EUR price.`);
    }
    return {
      sortOrder: idx,
      label: opt.label.trim(),
      productUrl: opt.productUrl?.trim() || null,
      priceCents,
      drawbacks: opt.drawbacks.trim(),
      notes: opt.notes?.trim() || null
    };
  });

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
        comment: `Edited request details (${parsedOptions.length} options).`
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

    const note =
      (params.comment || "").trim() ||
      `Confirmed option "${option.label}" (${formatEur(option.priceCents)}). Relabeled as Order (Provisional Spending).`;

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
      summary: `Confirmed option "${option.label}" (${formatEur(option.priceCents)}) -> ${reqRow.requestCode} relabeled as Order`
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
