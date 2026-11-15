import { action, query, redirect } from "@solidjs/router";
import { getRequestHeaders, getRequestIP } from "@solidjs/start/http";
import type {
  AssignableRole,
  DepartmentId,
  RatePeriod,
  RequestStatus
} from "~/lib/constants";
import {
  createSeasonSchema,
  forgotPasswordSchema,
  inviteUserSchema,
  loginSchema,
  resetPasswordSchema,
  reviewCommentSchema
} from "~/lib/schemas";
import {
  archiveSeasonByMaster,
  createSeasonByMaster,
  getSeasonUnresolvedSummary,
  inviteOrReinviteUser,
  listAllSeasons,
  listAllUsersForAdmin,
  resendInviteForUser,
  revokeInviteForUser,
  setUserStatusByMaster,
  updateUserRoleByMaster
} from "./admin";
import { listAuditLogs } from "./audit";
import {
  authenticateWithPassword,
  completePasswordReset,
  getCurrentUser,
  initiatePasswordReset,
  inspectInviteToken,
  requireApproverOrMaster,
  requireMaster,
  requireUser,
  signOutCurrentUser
} from "./auth";
import { cancelProvisionalEntry, getMoneyEntryItemLog, getSeasonBudgetSnapshot } from "./budget";
import {
  addRequestComment,
  cancelActiveOrder,
  getPurchaseRequestDetail,
  listPurchaseRequests,
  performApproverReview,
  resolveStageTwoSelection,
  respondToCounterProposition,
  withdrawUnreviewedRequest
} from "./requests";
import { consumeRateLimit, extractClientIp, resetRateLimit } from "./rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

function getRpcClientIp(): string {
  try {
    const headers = getRequestHeaders();
    const ip = getRequestIP({ xForwardedFor: true });
    return extractClientIp(headers as Record<string, string | undefined>, ip);
  } catch {
    return "unknown";
  }
}

const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password", "/accept-invite"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + "/"));
}

export const queryAppContext = query(async (pathname: string) => {
  "use server";
  const user = await getCurrentUser();
  if (!user) {
    if (!isPublicPath(pathname)) {
      const next = pathname && pathname !== "/" ? `?redirect=${encodeURIComponent(pathname)}` : "";
      throw redirect(`/login${next}`);
    }
    return { user: null, seasons: [] };
  }

  if (pathname === "/login") {
    throw redirect("/");
  }

  const seasons = await listAllSeasons();
  return { user, seasons };
}, "app-context");

export const loginFormAction = action(async (formData: FormData) => {
  "use server";
  const rawEmail = String(formData.get("email") ?? "");
  const rawPassword = String(formData.get("password") ?? "");
  const redirectTarget = String(formData.get("redirect") ?? "/");

  const parsed = loginSchema.safeParse({ email: rawEmail, password: rawPassword });
  if (!parsed.success) {
    return new Error(parsed.error.issues[0]?.message ?? "Invalid login credentials.");
  }

  const clientIp = getRpcClientIp();
  const limitKey = `login:${clientIp}:${parsed.data.email.toLowerCase()}`;
  const rate = consumeRateLimit(limitKey, 15, FIFTEEN_MINUTES_MS);
  if (!rate.allowed) {
    return new Error(
      `Too many sign-in attempts. Please wait ${Math.ceil(rate.retryAfterSeconds / 60)} minute(s) before trying again.`
    );
  }

  try {
    await authenticateWithPassword(parsed.data.email, parsed.data.password);
    resetRateLimit(limitKey);
  } catch (err) {
    return err instanceof Error ? err : new Error("Authentication failed.");
  }

  const safeDest =
    redirectTarget.startsWith("/") && !redirectTarget.startsWith("//") ? redirectTarget : "/";
  throw redirect(safeDest, { revalidate: "app-context" });
});

export const logoutAction = action(async () => {
  "use server";
  await signOutCurrentUser();
  throw redirect("/login", { revalidate: "app-context" });
});

export const forgotPasswordAction = action(async (formData: FormData) => {
  "use server";
  const parsed = forgotPasswordSchema.safeParse({
    email: String(formData.get("email") ?? "")
  });
  if (!parsed.success) {
    return new Error(parsed.error.issues[0]?.message ?? "Valid email is required.");
  }

  const clientIp = getRpcClientIp();
  const ipLimit = consumeRateLimit(`forgot_ip:${clientIp}`, 10, FIFTEEN_MINUTES_MS);
  const emailLimit = consumeRateLimit(
    `forgot_email:${parsed.data.email.toLowerCase()}`,
    5,
    FIFTEEN_MINUTES_MS
  );
  if (!ipLimit.allowed || !emailLimit.allowed) {
    return new Error("Too many password reset requests. Please wait 15 minutes before retrying.");
  }

  try {
    await initiatePasswordReset(parsed.data.email);
  } catch (err) {
    console.error("[mailer] Password reset delivery failed:", err);
  }
  return {
    ok: true,
    message:
      "If that email belongs to an active member account, a password reset link has been sent from contact@insa-racing.fr."
  };
});

export const resetPasswordAction = action(async (formData: FormData) => {
  "use server";
  const parsed = resetPasswordSchema.safeParse({
    token: String(formData.get("token") ?? ""),
    password: String(formData.get("password") ?? "")
  });
  if (!parsed.success) {
    return new Error(parsed.error.issues[0]?.message ?? "Invalid password reset submission.");
  }

  const clientIp = getRpcClientIp();
  const rate = consumeRateLimit(`reset:${clientIp}`, 15, FIFTEEN_MINUTES_MS);
  if (!rate.allowed) {
    return new Error("Too many password reset attempts. Please wait 15 minutes before retrying.");
  }

  try {
    await completePasswordReset(parsed.data.token, parsed.data.password);
    return { ok: true };
  } catch (err) {
    return err instanceof Error ? err : new Error("Failed to reset password.");
  }
});

export const queryInviteDetails = query(async (token: string) => {
  "use server";
  if (!token) return { valid: false as const, reason: "Missing invitation token." };
  return inspectInviteToken(token);
}, "invite-details");

export const queryRequestsList = query(
  async (params: {
    seasonId: string;
    department?: DepartmentId | "all";
    status?: RequestStatus | "all" | "archived";
    search?: string;
  }) => {
    "use server";
    await requireUser();
    if (!params.seasonId) return [];
    return listPurchaseRequests(params);
  },
  "requests-list"
);

export const queryRequestDetail = query(async (idOrCode: string) => {
  "use server";
  await requireUser();
  return getPurchaseRequestDetail(idOrCode);
}, "request-detail");

export const queryBudgetSnapshot = query(
  async (params: {
    seasonId: string;
    periodUnit: RatePeriod;
    fromDate?: string;
    toDate?: string;
  }) => {
    "use server";
    await requireUser();
    if (!params.seasonId) return null;
    return getSeasonBudgetSnapshot(params);
  },
  "budget-snapshot"
);

export const queryAuditLogs = query(
  async (params: { seasonId?: string; action?: string; search?: string }) => {
    "use server";
    await requireUser();
    const rows = await listAuditLogs(params);
    return rows.map(r => ({
      ...r,
      createdAt: r.createdAt.toISOString()
    }));
  },
  "audit-logs"
);

export const queryAdminPanelData = query(async () => {
  "use server";
  await requireMaster();
  const [users, seasons] = await Promise.all([listAllUsersForAdmin(), listAllSeasons()]);
  const activeSeason = seasons.find(s => s.status === "active");
  const activeUnresolved = activeSeason
    ? await getSeasonUnresolvedSummary(activeSeason.id)
    : null;
  return { users, seasons, activeUnresolved };
}, "admin-panel");

export const queryMasterUsers = query(async () => {
  "use server";
  await requireMaster();
  return listAllUsersForAdmin();
}, "master-users");

export const queryEntryItemLog = query(async (entryId: string) => {
  "use server";
  await requireUser();
  if (!entryId) return null;
  return getMoneyEntryItemLog(entryId);
}, "entry-item-log");

export const postCommentAction = action(async (formData: FormData) => {
  "use server";
  const user = await requireUser();
  const requestId = String(formData.get("requestId") ?? "");
  const parsed = reviewCommentSchema.safeParse({ comment: String(formData.get("comment") ?? "") });
  if (!parsed.success) {
    return new Error(parsed.error.issues[0]?.message ?? "Comment cannot be empty.");
  }
  try {
    await addRequestComment(user, requestId, parsed.data.comment);
    return { ok: true };
  } catch (err) {
    return err instanceof Error ? err : new Error("Failed to add comment.");
  }
});

export const withdrawRequestAction = action(async (formData: FormData) => {
  "use server";
  const user = await requireUser();
  const requestId = String(formData.get("requestId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  try {
    await withdrawUnreviewedRequest(user, requestId, reason);
    return { ok: true };
  } catch (err) {
    return err instanceof Error ? err : new Error("Failed to withdraw request.");
  }
});

export const reviewRequestAction = action(async (formData: FormData) => {
  "use server";
  const user = await requireApproverOrMaster();
  const requestId = String(formData.get("requestId") ?? "");
  const decision = String(formData.get("decision") ?? "") as "approve" | "deny" | "counter_propose";
  const parsed = reviewCommentSchema.safeParse({ comment: String(formData.get("comment") ?? "") });
  if (!parsed.success) {
    return new Error(parsed.error.issues[0]?.message ?? "A comment is required.");
  }
  try {
    await performApproverReview(user, { requestId, decision, comment: parsed.data.comment });
    return { ok: true };
  } catch (err) {
    return err instanceof Error ? err : new Error("Review action failed.");
  }
});

export const counterResponseAction = action(async (formData: FormData) => {
  "use server";
  const user = await requireUser();
  const requestId = String(formData.get("requestId") ?? "");
  const decision = String(formData.get("decision") ?? "") as "accept" | "counter_argue" | "deny";
  const comment = String(formData.get("comment") ?? "");
  try {
    await respondToCounterProposition(user, { requestId, decision, comment });
    return { ok: true };
  } catch (err) {
    return err instanceof Error ? err : new Error("Counter-proposition response failed.");
  }
});

export const stageTwoSelectionAction = action(async (formData: FormData) => {
  "use server";
  const user = await requireApproverOrMaster();
  const requestId = String(formData.get("requestId") ?? "");
  const decision = String(formData.get("decision") ?? "") as "confirm_option" | "deny";
  const optionId = String(formData.get("optionId") ?? "");
  const comment = String(formData.get("comment") ?? "");
  try {
    await resolveStageTwoSelection(user, { requestId, decision, optionId, comment });
    return { ok: true };
  } catch (err) {
    return err instanceof Error ? err : new Error("Stage 2 decision failed.");
  }
});

export const cancelOrderAction = action(async (formData: FormData) => {
  "use server";
  const user = await requireApproverOrMaster();
  const requestId = String(formData.get("requestId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  try {
    await cancelActiveOrder(user, requestId, reason);
    return { ok: true };
  } catch (err) {
    return err instanceof Error ? err : new Error("Failed to cancel order.");
  }
});

export const cancelEntryAction = action(async (formData: FormData) => {
  "use server";
  const user = await requireApproverOrMaster();
  const entryId = String(formData.get("entryId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  try {
    await cancelProvisionalEntry(user, entryId, reason);
    return { ok: true };
  } catch (err) {
    return err instanceof Error ? err : new Error("Failed to cancel provisional entry.");
  }
});

export const inviteUserAction = action(async (formData: FormData) => {
  "use server";
  const master = await requireMaster();
  const parsed = inviteUserSchema.safeParse({
    email: String(formData.get("email") ?? ""),
    role: String(formData.get("role") ?? "requestor"),
    title: String(formData.get("title") ?? "")
  });
  if (!parsed.success) {
    return new Error(parsed.error.issues[0]?.message ?? "Invalid invite payload.");
  }
  try {
    return await inviteOrReinviteUser(master, parsed.data);
  } catch (err) {
    return err instanceof Error ? err : new Error("Failed to invite user.");
  }
});

export const resendInviteAction = action(async (formData: FormData) => {
  "use server";
  const master = await requireMaster();
  const userId = String(formData.get("userId") ?? "");
  try {
    return await resendInviteForUser(master, userId);
  } catch (err) {
    return err instanceof Error ? err : new Error("Failed to resend invite.");
  }
});

export const revokeInviteAction = action(async (formData: FormData) => {
  "use server";
  const master = await requireMaster();
  const userId = String(formData.get("userId") ?? "");
  try {
    await revokeInviteForUser(master, userId);
    return { ok: true };
  } catch (err) {
    return err instanceof Error ? err : new Error("Failed to revoke invite.");
  }
});

export const updateUserRoleAction = action(async (formData: FormData) => {
  "use server";
  const master = await requireMaster();
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "") as AssignableRole;
  try {
    await updateUserRoleByMaster(master, userId, role);
    return { ok: true };
  } catch (err) {
    return err instanceof Error ? err : new Error("Failed to update user role.");
  }
});

export const toggleUserStatusAction = action(async (formData: FormData) => {
  "use server";
  const master = await requireMaster();
  const userId = String(formData.get("userId") ?? "");
  const nextStatus = String(formData.get("nextStatus") ?? "") as "active" | "suspended";
  try {
    await setUserStatusByMaster(master, userId, nextStatus);
    return { ok: true };
  } catch (err) {
    return err instanceof Error ? err : new Error("Failed to update user status.");
  }
});

export const createSeasonAction = action(async (formData: FormData) => {
  "use server";
  const master = await requireMaster();
  const parsed = createSeasonSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    yearCode: String(formData.get("yearCode") ?? ""),
    startDate: String(formData.get("startDate") ?? ""),
    deadlineDate: String(formData.get("deadlineDate") ?? ""),
    openingBalanceEur: String(formData.get("openingBalanceEur") ?? "0")
  });
  if (!parsed.success) {
    return new Error(parsed.error.issues[0]?.message ?? "Invalid season parameters.");
  }
  const archiveCurrentActive = formData.get("archiveCurrentActive") === "true";
  try {
    await createSeasonByMaster(master, { ...parsed.data, archiveCurrentActive });
    return { ok: true };
  } catch (err) {
    return err instanceof Error ? err : new Error("Failed to create season.");
  }
});

export const archiveSeasonAction = action(async (formData: FormData) => {
  "use server";
  const master = await requireMaster();
  const seasonId = String(formData.get("seasonId") ?? "");
  try {
    await archiveSeasonByMaster(master, seasonId);
    return { ok: true };
  } catch (err) {
    return err instanceof Error ? err : new Error("Failed to archive season.");
  }
});
