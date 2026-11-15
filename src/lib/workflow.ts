import type { EntryStatus, RequestStatus } from "./constants";

export type RequestTransitionAction =
  | "approver_approve"
  | "approver_deny"
  | "approver_counter_propose"
  | "requestor_accept_counter"
  | "requestor_counter_argue"
  | "requestor_deny_counter"
  | "approver_select_option"
  | "approver_deny_stage2"
  | "approver_update_order_fees"
  | "approver_cancel_order"
  | "approver_upload_invoice"
  | "requestor_withdraw";

const ALLOWED_TRANSITIONS: Record<RequestTransitionAction, { from: RequestStatus[]; to: RequestStatus }> = {
  approver_approve: {
    from: ["pending_review"],
    to: "option_selection"
  },
  approver_deny: {
    from: ["pending_review"],
    to: "denied_archived"
  },
  approver_counter_propose: {
    from: ["pending_review"],
    to: "counter_proposed"
  },
  requestor_accept_counter: {
    from: ["counter_proposed"],
    to: "option_selection"
  },
  requestor_counter_argue: {
    from: ["counter_proposed"],
    to: "pending_review"
  },
  requestor_deny_counter: {
    from: ["counter_proposed"],
    to: "denied_archived"
  },
  approver_select_option: {
    from: ["option_selection"],
    to: "order"
  },
  approver_deny_stage2: {
    from: ["option_selection"],
    to: "denied_archived"
  },
  approver_update_order_fees: {
    from: ["order"],
    to: "order"
  },
  approver_cancel_order: {
    from: ["order"],
    to: "order_cancelled_archived"
  },
  approver_upload_invoice: {
    from: ["order"],
    to: "spending"
  },
  requestor_withdraw: {
    from: ["pending_review"],
    to: "withdrawn_archived"
  }
};

export function resolveRequestTransition(
  current: RequestStatus,
  action: RequestTransitionAction
): RequestStatus {
  const rule = ALLOWED_TRANSITIONS[action];
  if (!rule.from.includes(current)) {
    throw new Error(
      `Invalid workflow transition: cannot perform "${action}" when request is in "${current}" status.`
    );
  }
  return rule.to;
}

export function isRequestTerminal(status: RequestStatus): boolean {
  return (
    status === "spending" ||
    status === "denied_archived" ||
    status === "withdrawn_archived" ||
    status === "order_cancelled_archived"
  );
}

export function computeOrderTotalCents(req: {
  selectedOptionPriceCents: number | null;
  shippingCents: number;
  importFeeCents: number;
  finalAmountCents: number | null;
  status: RequestStatus;
}): number {
  if (req.status === "spending" && req.finalAmountCents !== null) {
    return req.finalAmountCents;
  }
  const base = req.selectedOptionPriceCents ?? 0;
  return base + req.shippingCents + req.importFeeCents;
}

export function canTransitionEntry(
  current: EntryStatus,
  action: "confirm_with_invoice" | "cancel"
): EntryStatus {
  if (current !== "provisional") {
    throw new Error(`Cannot ${action} an entry that is already "${current}".`);
  }
  return action === "confirm_with_invoice" ? "confirmed" : "cancelled";
}
