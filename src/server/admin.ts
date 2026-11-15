import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { ROLE_LABELS, type AssignableRole } from "~/lib/constants";
import { parseEurToCents } from "~/lib/format";
import { recordAuditLog } from "./audit";
import type { PublicUser } from "./auth";
import { generateToken } from "./crypto";
import { getDb } from "./db";
import { ensureDbReady } from "./db/bootstrap";
import { authTokens, moneyEntries, purchaseRequests, seasons, users } from "./db/schema";
import { getEnv } from "./env";
import { sendInviteEmail } from "./mailer";

export async function listAllUsersForAdmin() {
  await ensureDbReady();
  const db = getDb();
  const rows = await db.select().from(users).orderBy(asc(users.createdAt));
  return rows.map(u => ({
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    title: u.title,
    role: u.role,
    status: u.status,
    avatarAttachmentId: u.avatarAttachmentId ?? null,
    isEnvMaster: u.isEnvMaster,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null
  }));
}

export async function inviteOrReinviteUser(
  master: PublicUser,
  params: { email: string; role: AssignableRole; title?: string }
) {
  await ensureDbReady();
  const env = getEnv();
  const db = getDb();
  const email = params.email.trim().toLowerCase();

  if (email === env.masterEmail) {
    throw new Error("The Master email cannot be invited as a regular member.");
  }

  const { raw, hash } = generateToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const defaultTitle = (params.title || "").trim() || ROLE_LABELS[params.role];

  const userRecord = await db.transaction(async tx => {
    const [existing] = await tx.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing && existing.status !== "invited") {
      throw new Error(`An account for ${email} already exists (${existing.status}).`);
    }

    let targetUser: typeof users.$inferSelect;
    if (existing) {
      await tx
        .update(authTokens)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(authTokens.userId, existing.id),
            eq(authTokens.purpose, "invite"),
            isNull(authTokens.consumedAt)
          )
        );
      const [updated] = await tx
        .update(users)
        .set({
          role: params.role,
          title: defaultTitle,
          updatedAt: new Date()
        })
        .where(eq(users.id, existing.id))
        .returning();
      targetUser = updated;
    } else {
      const [inserted] = await tx
        .insert(users)
        .values({
          email,
          fullName: email.split("@")[0] || "Team Member",
          title: defaultTitle,
          role: params.role,
          status: "invited",
          isEnvMaster: false
        })
        .returning();
      targetUser = inserted;
    }

    await tx.insert(authTokens).values({
      userId: targetUser.id,
      tokenHash: hash,
      purpose: "invite",
      expiresAt
    });

    await recordAuditLog(tx, {
      actorId: master.id,
      actorLabel: `${master.fullName} (Master)`,
      action: "user_invited",
      targetType: "user",
      targetId: targetUser.id,
      targetCode: targetUser.email,
      summary: `Pre-approved & invited ${email} as ${ROLE_LABELS[params.role]}`
    });

    return targetUser;
  });

  const inviteUrl = `${env.appUrl}/accept-invite?token=${encodeURIComponent(raw)}`;
  const emailResult = await sendInviteEmail({
    toEmail: userRecord.email,
    role: params.role,
    inviteUrl,
    invitedByName: master.fullName
  });

  return {
    userId: userRecord.id,
    email: userRecord.email,
    emailSent: emailResult.sent,
    fallbackInviteUrl: emailResult.sent ? null : inviteUrl
  };
}

export async function resendInviteForUser(master: PublicUser, userId: string) {
  await ensureDbReady();
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error("User not found.");
  if (user.status !== "invited") throw new Error("Only pending invited accounts can be re-invited.");

  return inviteOrReinviteUser(master, {
    email: user.email,
    role: user.role === "master" ? "approver" : user.role,
    title: user.title
  });
}

export async function revokeInviteForUser(master: PublicUser, userId: string) {
  await ensureDbReady();
  const db = getDb();
  await db.transaction(async tx => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new Error("User not found.");
    if (user.status !== "invited") {
      throw new Error("Only pending invitations can be revoked.");
    }
    await tx.delete(users).where(eq(users.id, userId));
    await recordAuditLog(tx, {
      actorId: master.id,
      actorLabel: `${master.fullName} (Master)`,
      action: "invite_revoked",
      targetType: "user",
      targetId: user.id,
      targetCode: user.email,
      summary: `Revoked pending invitation for ${user.email}`
    });
  });
}

export async function updateUserRoleByMaster(
  master: PublicUser,
  userId: string,
  role: AssignableRole
) {
  await ensureDbReady();
  const db = getDb();
  await db.transaction(async tx => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new Error("User not found.");
    if (user.isEnvMaster) throw new Error("The environment Master account role cannot be downgraded.");

    const oldRole = user.role;
    await tx
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, userId));

    await recordAuditLog(tx, {
      actorId: master.id,
      actorLabel: `${master.fullName} (Master)`,
      action: "user_role_changed",
      targetType: "user",
      targetId: user.id,
      targetCode: user.email,
      summary: `Changed ${user.fullName} (${user.email}) role from ${oldRole} to ${role}`
    });
  });
}

export async function setUserStatusByMaster(
  master: PublicUser,
  userId: string,
  nextStatus: "active" | "suspended"
) {
  await ensureDbReady();
  const db = getDb();
  await db.transaction(async tx => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new Error("User not found.");
    if (user.isEnvMaster) throw new Error("The environment Master account cannot be suspended.");
    if (user.status === "invited") {
      throw new Error("User must accept their invitation before activation or suspension.");
    }

    await tx
      .update(users)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(eq(users.id, userId));

    await recordAuditLog(tx, {
      actorId: master.id,
      actorLabel: `${master.fullName} (Master)`,
      action: nextStatus === "suspended" ? "user_suspended" : "user_reactivated",
      targetType: "user",
      targetId: user.id,
      targetCode: user.email,
      summary: `${nextStatus === "suspended" ? "Suspended" : "Reactivated"} access for ${user.fullName} (${user.email})`
    });
  });
}

export async function listAllSeasons() {
  await ensureDbReady();
  const db = getDb();
  const rows = await db.select().from(seasons).orderBy(desc(seasons.createdAt));
  return rows.map(s => ({
    id: s.id,
    name: s.name,
    yearCode: s.yearCode,
    startDate: s.startDate,
    deadlineDate: s.deadlineDate,
    openingBalanceCents: s.openingBalanceCents,
    status: s.status,
    archivedAt: s.archivedAt ? s.archivedAt.toISOString() : null,
    createdAt: s.createdAt.toISOString()
  }));
}

export async function getSeasonUnresolvedSummary(seasonId: string) {
  await ensureDbReady();
  const db = getDb();

  const openRequests = await db
    .select({ id: purchaseRequests.id, status: purchaseRequests.status })
    .from(purchaseRequests)
    .where(
      and(
        eq(purchaseRequests.seasonId, seasonId),
        inArray(purchaseRequests.status, [
          "pending_review",
          "counter_proposed",
          "option_selection",
          "order"
        ])
      )
    );

  const openEntries = await db
    .select({ id: moneyEntries.id })
    .from(moneyEntries)
    .where(and(eq(moneyEntries.seasonId, seasonId), eq(moneyEntries.status, "provisional")));

  return {
    pendingRequests: openRequests.filter(r => r.status !== "order").length,
    provisionalOrders: openRequests.filter(r => r.status === "order").length,
    provisionalEntries: openEntries.length
  };
}

export async function createSeasonByMaster(
  master: PublicUser,
  params: {
    name: string;
    yearCode: string;
    startDate: string;
    deadlineDate: string;
    openingBalanceEur: string;
    archiveCurrentActive: boolean;
  }
) {
  await ensureDbReady();
  if (params.startDate > params.deadlineDate) {
    throw new Error("Season deadline date must be on or after the starting date.");
  }

  const openingCents = parseEurToCents(params.openingBalanceEur || "0", {
    allowZero: true,
    allowNegative: true
  });
  if (openingCents === null) {
    throw new Error("Opening balance must be a valid Euro amount.");
  }

  const db = getDb();
  const code = params.yearCode.trim().toUpperCase();

  return db.transaction(async tx => {
    const existingCode = await tx
      .select({ id: seasons.id })
      .from(seasons)
      .where(eq(seasons.yearCode, code))
      .limit(1);

    if (existingCode.length > 0) {
      throw new Error(`Season year code "${code}" is already in use.`);
    }

    const activeSeasons = await tx
      .select()
      .from(seasons)
      .where(eq(seasons.status, "active"));

    if (activeSeasons.length > 0) {
      if (!params.archiveCurrentActive) {
        throw new Error(
          `Season "${activeSeasons[0].name}" is currently active. Enable archiving the previous season to create a new one.`
        );
      }
      for (const active of activeSeasons) {
        await tx
          .update(seasons)
          .set({ status: "archived", archivedAt: new Date() })
          .where(eq(seasons.id, active.id));

        await recordAuditLog(tx, {
          seasonId: active.id,
          actorId: master.id,
          actorLabel: `${master.fullName} (Master)`,
          action: "season_archived",
          targetType: "season",
          targetId: active.id,
          targetCode: active.yearCode,
          summary: `Archived season budget "${active.name}"`
        });
      }
    }

    const [created] = await tx
      .insert(seasons)
      .values({
        name: params.name.trim(),
        yearCode: code,
        startDate: params.startDate,
        deadlineDate: params.deadlineDate,
        openingBalanceCents: openingCents,
        status: "active",
        createdById: master.id
      })
      .returning();

    await recordAuditLog(tx, {
      seasonId: created.id,
      actorId: master.id,
      actorLabel: `${master.fullName} (Master)`,
      action: "season_created",
      targetType: "season",
      targetId: created.id,
      targetCode: created.yearCode,
      summary: `Created active season budget "${created.name}" (${created.startDate} to ${created.deadlineDate})`
    });

    return created;
  });
}

export async function archiveSeasonByMaster(master: PublicUser, seasonId: string) {
  await ensureDbReady();
  const db = getDb();

  await db.transaction(async tx => {
    const [season] = await tx.select().from(seasons).where(eq(seasons.id, seasonId)).limit(1);
    if (!season) throw new Error("Season not found.");
    if (season.status === "archived") throw new Error("Season is already archived.");

    await tx
      .update(seasons)
      .set({ status: "archived", archivedAt: new Date() })
      .where(eq(seasons.id, seasonId));

    await recordAuditLog(tx, {
      seasonId: season.id,
      actorId: master.id,
      actorLabel: `${master.fullName} (Master)`,
      action: "season_archived",
      targetType: "season",
      targetId: season.id,
      targetCode: season.yearCode,
      summary: `Archived season budget "${season.name}"`
    });
  });
}
