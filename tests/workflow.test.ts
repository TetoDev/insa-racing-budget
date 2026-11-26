import { describe, expect, it } from "vitest";
import { createRequestPayloadSchema, editRequestPayloadSchema } from "~/lib/schemas";
import {
  canTransitionEntry,
  computeOptionTotalCents,
  computeOrderTotalCents,
  isRequestTerminal,
  parseRequestQuantity,
  resolveRequestTransition
} from "~/lib/workflow";

describe("purchase request workflow transitions", () => {
  it("supports direct approval -> Stage 2 option selection -> order -> invoice -> spending", () => {
    let status = resolveRequestTransition("pending_review", "approver_approve");
    expect(status).toBe("option_selection");
    expect(isRequestTerminal(status)).toBe(false);

    status = resolveRequestTransition(status, "approver_select_option");
    expect(status).toBe("order");
    expect(isRequestTerminal(status)).toBe(false);

    status = resolveRequestTransition(status, "approver_update_order_fees");
    expect(status).toBe("order");

    status = resolveRequestTransition(status, "approver_upload_invoice");
    expect(status).toBe("spending");
    expect(isRequestTerminal(status)).toBe(true);
  });

  it("supports multi-round counter-proposition negotiation and eventual acceptance or denial", () => {
    // Round 1: approver counters -> requestor counter-argues -> returns to pending_review
    let status = resolveRequestTransition("pending_review", "approver_counter_propose");
    expect(status).toBe("counter_proposed");

    status = resolveRequestTransition(status, "requestor_counter_argue");
    expect(status).toBe("pending_review");

    // Round 2: approver counters -> requestor accepts -> Stage 2 option selection
    status = resolveRequestTransition(status, "approver_counter_propose");
    expect(status).toBe("counter_proposed");

    status = resolveRequestTransition(status, "requestor_accept_counter");
    expect(status).toBe("option_selection");

    // Stage 2 denial archives the request
    const deniedStage2 = resolveRequestTransition(status, "approver_deny_stage2");
    expect(deniedStage2).toBe("denied_archived");
    expect(isRequestTerminal(deniedStage2)).toBe(true);

    // Requestor denying a counter-proposition also archives as denied
    expect(resolveRequestTransition("counter_proposed", "requestor_deny_counter")).toBe(
      "denied_archived"
    );
  });

  it("supports Stage 1 denial, unreviewed withdrawal, and active order cancellation", () => {
    expect(resolveRequestTransition("pending_review", "approver_deny")).toBe("denied_archived");
    expect(resolveRequestTransition("pending_review", "requestor_withdraw")).toBe(
      "withdrawn_archived"
    );
    expect(resolveRequestTransition("order", "approver_cancel_order")).toBe(
      "order_cancelled_archived"
    );
  });

  it("rejects out-of-stage transitions", () => {
    expect(() =>
      resolveRequestTransition("pending_review", "approver_upload_invoice")
    ).toThrow(/Invalid workflow transition/);

    expect(() =>
      resolveRequestTransition("option_selection", "approver_counter_propose")
    ).toThrow(/Invalid workflow transition/);

    expect(() =>
      resolveRequestTransition("order", "requestor_withdraw")
    ).toThrow(/Invalid workflow transition/);

    expect(() =>
      resolveRequestTransition("spending", "approver_cancel_order")
    ).toThrow(/Invalid workflow transition/);
  });

  it("computes order provisional totals vs invoiced final totals accurately", () => {
    const orderTotal = computeOrderTotalCents({
      status: "order",
      selectedOptionPriceCents: 45_000,
      shippingCents: 3_500,
      importFeeCents: 1_250,
      finalAmountCents: null
    });
    expect(orderTotal).toBe(49_750);

    const invoicedOverride = computeOrderTotalCents({
      status: "spending",
      selectedOptionPriceCents: 45_000,
      shippingCents: 3_500,
      importFeeCents: 1_250,
      finalAmountCents: 51_000
    });
    expect(invoicedOverride).toBe(51_000);

    const invoicedFallback = computeOrderTotalCents({
      status: "spending",
      selectedOptionPriceCents: 45_000,
      shippingCents: 3_500,
      importFeeCents: 0,
      finalAmountCents: null
    });
    expect(invoicedFallback).toBe(48_500);
  });

  it("validates provisional money entry transitions", () => {
    expect(canTransitionEntry("provisional", "confirm_with_invoice")).toBe("confirmed");
    expect(canTransitionEntry("provisional", "cancel")).toBe("cancelled");
    expect(() => canTransitionEntry("confirmed", "cancel")).toThrow();
    expect(() => canTransitionEntry("cancelled", "confirm_with_invoice")).toThrow();
  });

  it("validates required carSystem field on create and edit request payloads", () => {
    const valid = createRequestPayloadSchema.safeParse({
      title: "Inconel Exhaust Collector",
      department: "powertrain",
      carSystem: "Powertrain / Exhaust & Engine",
      explanation: "Required for FSG endurance thermal reliability.",
      options: [
        {
          label: "Custom Fab FR",
          priceEur: "640.00",
          drawbacks: "3 week lead time"
        }
      ]
    });
    expect(valid.success).toBe(true);

    const missingCarSystem = createRequestPayloadSchema.safeParse({
      title: "Inconel Exhaust Collector",
      department: "powertrain",
      carSystem: " ",
      explanation: "Required for FSG endurance thermal reliability.",
      options: [
        {
          label: "Custom Fab FR",
          priceEur: "640.00",
          drawbacks: "3 week lead time"
        }
      ]
    });
    expect(missingCarSystem.success).toBe(false);

    const validEdit = editRequestPayloadSchema.safeParse({
      title: "Inconel Exhaust Collector v2",
      quantity: 3,
      carSystem: "Powertrain / Engine & Drivetrain",
      explanation: "Updated with second supplier option.",
      options: [
        {
          label: "Custom Fab FR",
          unitPriceEur: "640.00",
          drawbacks: "3 week lead time"
        }
      ]
    });
    expect(validEdit.success).toBe(true);
    if (validEdit.success) {
      expect(validEdit.data.quantity).toBe(3);
    }
  });

  it("parses request quantities and computes total cents from unit prices accurately", () => {
    expect(parseRequestQuantity(1)).toBe(1);
    expect(parseRequestQuantity("12")).toBe(12);
    expect(parseRequestQuantity("  25 ")).toBe(25);
    expect(parseRequestQuantity(0)).toBeNull();
    expect(parseRequestQuantity(-2)).toBeNull();
    expect(parseRequestQuantity("1.5")).toBeNull();
    expect(parseRequestQuantity("abc")).toBeNull();
    expect(parseRequestQuantity(100_001)).toBeNull();

    expect(computeOptionTotalCents(1250, 10)).toBe(12_500);
    expect(computeOptionTotalCents(42050, 3)).toBe(126_150);
    expect(computeOptionTotalCents(100_000_000, 100)).toBeNull(); // exceeds MAX_MONEY_CENTS
    expect(computeOptionTotalCents(1250, 0)).toBeNull();

    const invalidQty = createRequestPayloadSchema.safeParse({
      title: "M6 Titanium Bolts",
      quantity: 0,
      department: "chassis",
      carSystem: "Chassis / Fasteners",
      explanation: "Need 20 bolts for front wing mounts.",
      options: [{ label: "ProBolt", unitPriceEur: "2.50", drawbacks: "None" }]
    });
    expect(invalidQty.success).toBe(false);

    const fractionalQty = createRequestPayloadSchema.safeParse({
      title: "M6 Titanium Bolts",
      quantity: 2.5,
      department: "chassis",
      carSystem: "Chassis / Fasteners",
      explanation: "Need bolts for mounts.",
      options: [{ label: "ProBolt", unitPriceEur: "2.50", drawbacks: "None" }]
    });
    expect(fractionalQty.success).toBe(false);
  });
});
