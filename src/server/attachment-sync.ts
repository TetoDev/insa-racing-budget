import { and, eq, inArray } from "drizzle-orm";
import type { getDb } from "./db";
import { attachments } from "./db/schema";
import { deleteStoredFileQuietly, saveUploadedFile } from "./storage";

type DbOrTx = Pick<ReturnType<typeof getDb>, "select" | "insert" | "update" | "delete">;

export type RecordAttachmentKind = "photo" | "document" | "invoice" | "fee_proof" | "supporting_doc";

export interface SavedUploadGroupItem<K extends RecordAttachmentKind> {
  kind: K;
  saved: Awaited<ReturnType<typeof saveUploadedFile>>;
}

/**
 * Validates and persists multiple upload groups to disk; cleans up any written files if one fails.
 */
export async function saveUploadGroups<K extends RecordAttachmentKind>(
  groups: Array<{ kind: K; files: File[]; mode: "image_only" | "document" }>
): Promise<Array<SavedUploadGroupItem<K>>> {
  const saved: Array<SavedUploadGroupItem<K>> = [];
  try {
    for (const group of groups) {
      for (const file of group.files) {
        if (file.size > 0) {
          saved.push({
            kind: group.kind,
            saved: await saveUploadedFile({ file, mode: group.mode })
          });
        }
      }
    }
    return saved;
  } catch (err) {
    await Promise.all(saved.map(item => deleteStoredFileQuietly(item.saved.storageKey)));
    throw err;
  }
}

/**
 * Applies attachment renames/reclassifications, removals, and newly uploaded files for a record,
 * returning storage keys to unlink after DB commit and human-readable log lines.
 */
export async function syncEntityAttachments<K extends RecordAttachmentKind>(
  tx: DbOrTx,
  params: {
    entityType: "request" | "entry";
    entityId: string;
    actorId: string;
    updates: Array<{ id: string; originalName: string; kind: K }>;
    removeIds: string[];
    savedUploads: Array<SavedUploadGroupItem<K>>;
  }
): Promise<{ removedKeys: string[]; changeNotes: string[] }> {
  const existing = await tx
    .select()
    .from(attachments)
    .where(and(eq(attachments.entityType, params.entityType), eq(attachments.entityId, params.entityId)));

  const existingById = new Map(existing.map(a => [a.id, a]));
  const removeSet = new Set(params.removeIds);
  const changeNotes: string[] = [];
  const removedKeys: string[] = [];

  for (const upd of params.updates) {
    if (removeSet.has(upd.id)) continue;
    const prev = existingById.get(upd.id);
    if (!prev) continue;
    const cleanName = upd.originalName.trim().slice(0, 180);
    if (!cleanName) throw new Error("Attachment name cannot be empty.");
    if (prev.originalName !== cleanName || prev.kind !== upd.kind) {
      await tx
        .update(attachments)
        .set({ originalName: cleanName, kind: upd.kind })
        .where(eq(attachments.id, prev.id));
      const parts: string[] = [];
      if (prev.kind !== upd.kind) parts.push(`type ${prev.kind} → ${upd.kind}`);
      if (prev.originalName !== cleanName) parts.push(`name "${prev.originalName}" → "${cleanName}"`);
      changeNotes.push(`Updated attachment "${prev.originalName}" (${parts.join(", ")})`);
    }
  }

  const toRemove = existing.filter(a => removeSet.has(a.id));
  if (toRemove.length > 0) {
    await tx.delete(attachments).where(inArray(attachments.id, toRemove.map(a => a.id)));
    for (const a of toRemove) {
      removedKeys.push(a.storageKey);
      changeNotes.push(`Removed attachment [${a.kind}] ${a.originalName}`);
    }
  }

  if (params.savedUploads.length > 0) {
    await tx.insert(attachments).values(
      params.savedUploads.map(u => ({
        entityType: params.entityType,
        entityId: params.entityId,
        kind: u.kind,
        originalName: u.saved.originalName,
        storageKey: u.saved.storageKey,
        mimeType: u.saved.mimeType,
        sizeBytes: u.saved.sizeBytes,
        uploadedById: params.actorId
      }))
    );
    for (const u of params.savedUploads) {
      changeNotes.push(`Added attachment [${u.kind}] ${u.saved.originalName}`);
    }
  }

  return { removedKeys, changeNotes };
}

/** Deletes all DB attachment rows for an entity and returns storage keys for disk cleanup. */
export async function purgeEntityAttachments(
  tx: DbOrTx,
  entityType: "request" | "entry",
  entityId: string
): Promise<{ removedKeys: string[]; count: number }> {
  const rows = await tx
    .select({ id: attachments.id, storageKey: attachments.storageKey })
    .from(attachments)
    .where(and(eq(attachments.entityType, entityType), eq(attachments.entityId, entityId)));

  if (rows.length > 0) {
    await tx.delete(attachments).where(inArray(attachments.id, rows.map(r => r.id)));
  }

  return { removedKeys: rows.map(r => r.storageKey), count: rows.length };
}
