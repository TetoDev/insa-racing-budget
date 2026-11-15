import { describe, expect, it } from "vitest";
import {
  canCommentOnRequests,
  canCreateRequest,
  canEditOrWithdrawUnreviewedRequest,
  canExportBudget,
  canManageBudgetEntries,
  canManageUsersAndSeasons,
  canMasterEditOrDeleteRecord,
  canRespondToCounterProposition,
  canReviewRequest,
  canSelectOptionOrManageOrder
} from "~/lib/permissions";

describe("RBAC permissions matrix", () => {
  it("keeps viewer strictly read-only and blocks unauthenticated users", () => {
    for (const role of ["viewer", null, undefined] as const) {
      expect(canCreateRequest(role)).toBe(false);
      expect(canCommentOnRequests(role)).toBe(false);
      expect(canReviewRequest(role)).toBe(false);
      expect(canSelectOptionOrManageOrder(role)).toBe(false);
      expect(canManageBudgetEntries(role)).toBe(false);
      expect(canExportBudget(role)).toBe(false);
      expect(canManageUsersAndSeasons(role)).toBe(false);
      expect(
        canEditOrWithdrawUnreviewedRequest({
          role,
          userId: "u1",
          creatorId: "u1",
          status: "pending_review",
          hasApproverResponse: false
        })
      ).toBe(false);
      expect(
        canRespondToCounterProposition({
          role,
          userId: "u1",
          creatorId: "u1",
          status: "counter_proposed"
        })
      ).toBe(false);
    }
  });

  it("allows requestors to create/comment and manage only their own unreviewed/countered requests", () => {
    expect(canCreateRequest("requestor")).toBe(true);
    expect(canCommentOnRequests("requestor")).toBe(true);
    expect(canReviewRequest("requestor")).toBe(false);
    expect(canSelectOptionOrManageOrder("requestor")).toBe(false);
    expect(canManageBudgetEntries("requestor")).toBe(false);
    expect(canExportBudget("requestor")).toBe(false);
    expect(canManageUsersAndSeasons("requestor")).toBe(false);

    expect(
      canEditOrWithdrawUnreviewedRequest({
        role: "requestor",
        userId: "u1",
        creatorId: "u1",
        status: "pending_review",
        hasApproverResponse: false
      })
    ).toBe(true);

    // Locked once an approver has already responded in negotiation
    expect(
      canEditOrWithdrawUnreviewedRequest({
        role: "requestor",
        userId: "u1",
        creatorId: "u1",
        status: "pending_review",
        hasApproverResponse: true
      })
    ).toBe(false);

    // Cannot edit someone else's request
    expect(
      canEditOrWithdrawUnreviewedRequest({
        role: "requestor",
        userId: "u2",
        creatorId: "u1",
        status: "pending_review",
        hasApproverResponse: false
      })
    ).toBe(false);

    expect(
      canRespondToCounterProposition({
        role: "requestor",
        userId: "u1",
        creatorId: "u1",
        status: "counter_proposed"
      })
    ).toBe(true);
  });

  it("allows approvers to submit requests, approve/manage orders, log entries, and export, but not admin", () => {
    expect(canCreateRequest("approver")).toBe(true);
    expect(canCommentOnRequests("approver")).toBe(true);
    expect(canReviewRequest("approver")).toBe(true);
    expect(canSelectOptionOrManageOrder("approver")).toBe(true);
    expect(canManageBudgetEntries("approver")).toBe(true);
    expect(canExportBudget("approver")).toBe(true);
    expect(canManageUsersAndSeasons("approver")).toBe(false);
    expect(canMasterEditOrDeleteRecord("approver")).toBe(false);
    expect(canMasterEditOrDeleteRecord("requestor")).toBe(false);
    expect(canMasterEditOrDeleteRecord("viewer")).toBe(false);
    expect(canMasterEditOrDeleteRecord(null)).toBe(false);
  });

  it("grants master full rights across workflow, exports, admin, and overrides", () => {
    expect(canCreateRequest("master")).toBe(true);
    expect(canCommentOnRequests("master")).toBe(true);
    expect(canReviewRequest("master")).toBe(true);
    expect(canSelectOptionOrManageOrder("master")).toBe(true);
    expect(canManageBudgetEntries("master")).toBe(true);
    expect(canExportBudget("master")).toBe(true);
    expect(canManageUsersAndSeasons("master")).toBe(true);
    expect(canMasterEditOrDeleteRecord("master")).toBe(true);

    expect(
      canEditOrWithdrawUnreviewedRequest({
        role: "master",
        userId: "master-id",
        creatorId: "other-user",
        status: "pending_review",
        hasApproverResponse: false
      })
    ).toBe(true);

    expect(
      canRespondToCounterProposition({
        role: "master",
        userId: "master-id",
        creatorId: "other-user",
        status: "counter_proposed"
      })
    ).toBe(true);
  });
});
