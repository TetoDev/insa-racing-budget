import type { RequestStatus, UserRole } from "./constants";

export function isApproverOrMaster(role: UserRole | null | undefined): boolean {
  return role === "approver" || role === "master";
}

export function isMaster(role: UserRole | null | undefined): boolean {
  return role === "master";
}

export function canCreateRequest(role: UserRole | null | undefined): boolean {
  return role === "requestor" || role === "approver" || role === "master";
}

export function canCommentOnRequests(role: UserRole | null | undefined): boolean {
  return role === "requestor" || role === "approver" || role === "master";
}

export function canReviewRequest(role: UserRole | null | undefined): boolean {
  return role === "approver" || role === "master";
}

export function canSelectOptionOrManageOrder(role: UserRole | null | undefined): boolean {
  return role === "approver" || role === "master";
}

export function canManageBudgetEntries(role: UserRole | null | undefined): boolean {
  return role === "approver" || role === "master";
}

export function canExportBudget(role: UserRole | null | undefined): boolean {
  return role === "approver" || role === "master";
}

export function canManageUsersAndSeasons(role: UserRole | null | undefined): boolean {
  return role === "master";
}

export function canEditOrWithdrawUnreviewedRequest(params: {
  role: UserRole | null | undefined;
  userId: string;
  creatorId: string;
  status: RequestStatus;
  hasApproverResponse: boolean;
}): boolean {
  if (!params.role || params.role === "viewer") return false;
  if (params.status !== "pending_review" || params.hasApproverResponse) return false;
  return params.userId === params.creatorId || params.role === "master";
}

export function canRespondToCounterProposition(params: {
  role: UserRole | null | undefined;
  userId: string;
  creatorId: string;
  status: RequestStatus;
}): boolean {
  if (!params.role || params.role === "viewer") return false;
  if (params.status !== "counter_proposed") return false;
  return params.userId === params.creatorId || params.role === "master";
}
