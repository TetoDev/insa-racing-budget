import { useSession } from "@solidjs/start/http";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { PublicUser, UserRole, UserStatus } from "~/lib/constants";
import { recordAuditLog } from "./audit";
import {
  generateToken,
  hashPassword,
  hashToken,
  verifyPassword,
  verifyPlaintextConstantTime
} from "./crypto";
import { getDb } from "./db";
import { ensureDbReady } from "./db/bootstrap";
import { attachments, authTokens, users } from "./db/schema";
import { getEnv } from "./env";
import { sendPasswordResetEmail } from "./mailer";
import { deleteStoredFileQuietly, saveUploadedFile } from "./storage";

export type { PublicUser };

interface SessionPayload {
  userId?: string;
}

const SESSION_COOKIE_NAME = "insa_achats_session";

export function getAppSession() {
  const env = getEnv();
  return useSession<SessionPayload>({
    name: SESSION_COOKIE_NAME,
    password: env.sessionSecret,
    cookie: {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: env.cookieSecure,
      maxAge: 60 * 60 * 24 * 14
    }
  });
}

export function toPublicUser(row: typeof users.$inferSelect): PublicUser {
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    title: row.title,
    role: row.role,
    status: row.status,
    avatarAttachmentId: row.avatarAttachmentId ?? null,
    isEnvMaster: row.isEnvMaster
  };
}

export async function getCurrentUser(): Promise<PublicUser | null> {
  await ensureDbReady();
  const session = await getAppSession();
  const userId = session.data.userId;
  if (!userId) return null;

  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.status !== "active") {
    await session.update({ userId: undefined });
    return null;
  }
  return toPublicUser(user);
}

export async function requireUser(): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("UNAUTHORIZED");
  }
  return user;
}

export async function requireApproverOrMaster(): Promise<PublicUser> {
  const user = await requireUser();
  if (user.role !== "approver" && user.role !== "master") {
    throw new Error("FORBIDDEN: Approver or Master role is required.");
  }
  return user;
}

export async function requireMaster(): Promise<PublicUser> {
  const user = await requireUser();
  if (user.role !== "master") {
    throw new Error("FORBIDDEN: Master account is required.");
  }
  return user;
}

export async function authenticateWithPassword(emailRaw: string, password: string): Promise<PublicUser> {
  await ensureDbReady();
  const env = getEnv();
  const email = emailRaw.trim().toLowerCase();
  const db = getDb();

  if (email === env.masterEmail) {
    const isMasterPwValid = env.masterPassword.startsWith("scrypt:")
      ? await verifyPassword(password, env.masterPassword)
      : verifyPlaintextConstantTime(password, env.masterPassword);

    if (!isMasterPwValid) {
      throw new Error("Invalid email or password.");
    }

    const [master] = await db.select().from(users).where(eq(users.isEnvMaster, true)).limit(1);
    if (!master) {
      throw new Error("Master account failed to initialize.");
    }
    await db
      .update(users)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, master.id));

    const session = await getAppSession();
    await session.update({ userId: master.id });
    return toPublicUser(master);
  }

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    throw new Error("Invalid email or password.");
  }
  if (user.status === "invited") {
    throw new Error("Your invitation has not been completed yet. Please use your invite link.");
  }
  if (user.status === "suspended") {
    throw new Error("Your account access has been suspended by the Master administrator.");
  }
  if (!user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    throw new Error("Invalid email or password.");
  }

  await db
    .update(users)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, user.id));

  const session = await getAppSession();
  await session.update({ userId: user.id });
  return toPublicUser(user);
}

export async function signOutCurrentUser(): Promise<void> {
  const session = await getAppSession();
  await session.update({ userId: undefined });
}

export async function inspectInviteToken(rawToken: string) {
  await ensureDbReady();
  const db = getDb();
  const tokenHash = hashToken(rawToken);

  const rows = await db
    .select({
      tokenId: authTokens.id,
      expiresAt: authTokens.expiresAt,
      consumedAt: authTokens.consumedAt,
      userId: users.id,
      email: users.email,
      role: users.role,
      title: users.title,
      status: users.status
    })
    .from(authTokens)
    .innerJoin(users, eq(authTokens.userId, users.id))
    .where(and(eq(authTokens.tokenHash, tokenHash), eq(authTokens.purpose, "invite")))
    .limit(1);

  if (rows.length === 0) return { valid: false as const, reason: "Invitation link is invalid." };
  const row = rows[0];
  if (row.consumedAt) return { valid: false as const, reason: "This invitation has already been used." };
  if (row.expiresAt < new Date()) return { valid: false as const, reason: "This invitation link has expired." };
  if (row.status === "suspended") return { valid: false as const, reason: "This invitation was revoked." };

  return {
    valid: true as const,
    email: row.email,
    role: row.role,
    suggestedTitle: row.title
  };
}

export async function completeUserInvite(params: {
  token: string;
  fullName: string;
  title: string;
  password: string;
  avatarFile: File | null;
}): Promise<PublicUser> {
  await ensureDbReady();
  const db = getDb();
  const tokenHash = hashToken(params.token);
  const pwHash = await hashPassword(params.password);

  let savedAvatar: Awaited<ReturnType<typeof saveUploadedFile>> | null = null;
  if (params.avatarFile && params.avatarFile.size > 0) {
    savedAvatar = await saveUploadedFile({ file: params.avatarFile, mode: "image_only" });
  }

  try {
    const activatedUser = await db.transaction(async tx => {
      const [tokenRow] = await tx
        .select()
        .from(authTokens)
        .where(
          and(
            eq(authTokens.tokenHash, tokenHash),
            eq(authTokens.purpose, "invite"),
            isNull(authTokens.consumedAt),
            gt(authTokens.expiresAt, new Date())
          )
        )
        .limit(1);

      if (!tokenRow) {
        throw new Error("Invitation token is invalid or expired.");
      }

      const [userRow] = await tx
        .select()
        .from(users)
        .where(eq(users.id, tokenRow.userId))
        .limit(1);

      if (!userRow || userRow.status === "suspended") {
        throw new Error("This invitation is no longer active.");
      }

      let avatarAttachmentId = userRow.avatarAttachmentId;
      if (savedAvatar) {
        const [att] = await tx
          .insert(attachments)
          .values({
            entityType: "avatar",
            entityId: userRow.id,
            kind: "avatar",
            originalName: savedAvatar.originalName,
            storageKey: savedAvatar.storageKey,
            mimeType: savedAvatar.mimeType,
            sizeBytes: savedAvatar.sizeBytes,
            uploadedById: userRow.id
          })
          .returning();
        avatarAttachmentId = att.id;
      }

      const [updated] = await tx
        .update(users)
        .set({
          fullName: params.fullName.trim(),
          title: params.title.trim(),
          passwordHash: pwHash,
          status: "active",
          avatarAttachmentId,
          lastLoginAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(users.id, userRow.id))
        .returning();

      await tx
        .update(authTokens)
        .set({ consumedAt: new Date() })
        .where(eq(authTokens.id, tokenRow.id));

      await recordAuditLog(tx, {
        actorId: updated.id,
        actorLabel: `${updated.fullName} (${updated.email})`,
        action: "user_activated",
        targetType: "user",
        targetId: updated.id,
        targetCode: updated.email,
        summary: `${updated.fullName} completed account setup (${updated.role})`
      });

      return updated;
    });

    const session = await getAppSession();
    await session.update({ userId: activatedUser.id });
    return toPublicUser(activatedUser);
  } catch (err) {
    if (savedAvatar) {
      await deleteStoredFileQuietly(savedAvatar.storageKey);
    }
    throw err;
  }
}

export async function initiatePasswordReset(emailRaw: string): Promise<void> {
  await ensureDbReady();
  const env = getEnv();
  const email = emailRaw.trim().toLowerCase();
  if (email === env.masterEmail) {
    return;
  }

  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || user.status !== "active") {
    return;
  }

  const { raw, hash } = generateToken();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  await db.transaction(async tx => {
    await tx
      .update(authTokens)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(authTokens.userId, user.id),
          eq(authTokens.purpose, "password_reset"),
          isNull(authTokens.consumedAt)
        )
      );

    await tx.insert(authTokens).values({
      userId: user.id,
      tokenHash: hash,
      purpose: "password_reset",
      expiresAt
    });
  });

  const resetUrl = `${env.appUrl}/reset-password?token=${encodeURIComponent(raw)}`;
  await sendPasswordResetEmail({
    toEmail: user.email,
    fullName: user.fullName,
    resetUrl
  });
}

export async function completePasswordReset(rawToken: string, newPassword: string): Promise<void> {
  await ensureDbReady();
  const db = getDb();
  const tokenHash = hashToken(rawToken);
  const newHash = await hashPassword(newPassword);

  await db.transaction(async tx => {
    const [tokenRow] = await tx
      .select()
      .from(authTokens)
      .where(
        and(
          eq(authTokens.tokenHash, tokenHash),
          eq(authTokens.purpose, "password_reset"),
          isNull(authTokens.consumedAt),
          gt(authTokens.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!tokenRow) {
      throw new Error("Reset link is invalid or has expired.");
    }

    const [user] = await tx.select().from(users).where(eq(users.id, tokenRow.userId)).limit(1);
    if (!user || user.status !== "active" || user.isEnvMaster) {
      throw new Error("Unable to reset password for this account.");
    }

    await tx
      .update(users)
      .set({ passwordHash: newHash, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    await tx
      .update(authTokens)
      .set({ consumedAt: new Date() })
      .where(eq(authTokens.id, tokenRow.id));

    await recordAuditLog(tx, {
      actorId: user.id,
      actorLabel: `${user.fullName} (${user.email})`,
      action: "password_reset",
      targetType: "user",
      targetId: user.id,
      targetCode: user.email,
      summary: `${user.fullName} reset their password via email link`
    });
  });
}

export async function updateOwnProfile(params: {
  userId: string;
  fullName: string;
  title: string;
  avatarFile: File | null;
  currentPassword?: string;
  newPassword?: string;
}): Promise<PublicUser> {
  const db = getDb();
  let savedAvatar: Awaited<ReturnType<typeof saveUploadedFile>> | null = null;
  if (params.avatarFile && params.avatarFile.size > 0) {
    savedAvatar = await saveUploadedFile({ file: params.avatarFile, mode: "image_only" });
  }

  let oldAvatarKey: string | null = null;
  try {
    const updated = await db.transaction(async tx => {
      const [user] = await tx.select().from(users).where(eq(users.id, params.userId)).limit(1);
      if (!user) throw new Error("User not found.");

      let passwordHash = user.passwordHash;
      if (params.newPassword && params.newPassword.length > 0) {
        if (user.isEnvMaster) {
          throw new Error("Master account password is managed in the server environment file (.env).");
        }
        if (!params.currentPassword || !user.passwordHash || !(await verifyPassword(params.currentPassword, user.passwordHash))) {
          throw new Error("Current password is incorrect.");
        }
        if (params.newPassword.length < 8) {
          throw new Error("New password must be at least 8 characters.");
        }
        passwordHash = await hashPassword(params.newPassword);
      }

      let avatarAttachmentId = user.avatarAttachmentId;
      if (savedAvatar) {
        if (user.avatarAttachmentId) {
          const [oldAtt] = await tx
            .select()
            .from(attachments)
            .where(eq(attachments.id, user.avatarAttachmentId))
            .limit(1);
          if (oldAtt) {
            oldAvatarKey = oldAtt.storageKey;
            await tx.delete(attachments).where(eq(attachments.id, oldAtt.id));
          }
        }
        const [newAtt] = await tx
          .insert(attachments)
          .values({
            entityType: "avatar",
            entityId: user.id,
            kind: "avatar",
            originalName: savedAvatar.originalName,
            storageKey: savedAvatar.storageKey,
            mimeType: savedAvatar.mimeType,
            sizeBytes: savedAvatar.sizeBytes,
            uploadedById: user.id
          })
          .returning();
        avatarAttachmentId = newAtt.id;
      }

      const [nextUser] = await tx
        .update(users)
        .set({
          fullName: params.fullName.trim(),
          title: params.title.trim(),
          passwordHash,
          avatarAttachmentId,
          updatedAt: new Date()
        })
        .where(eq(users.id, user.id))
        .returning();

      await recordAuditLog(tx, {
        actorId: user.id,
        actorLabel: `${nextUser.fullName} (${nextUser.email})`,
        action: "profile_updated",
        targetType: "user",
        targetId: user.id,
        targetCode: user.email,
        summary: `${nextUser.fullName} updated their profile`
      });

      return nextUser;
    });

    if (oldAvatarKey) {
      await deleteStoredFileQuietly(oldAvatarKey);
    }
    return toPublicUser(updated);
  } catch (err) {
    if (savedAvatar) {
      await deleteStoredFileQuietly(savedAvatar.storageKey);
    }
    throw err;
  }
}
