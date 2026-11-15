import { describe, expect, it } from "vitest";
import { fromDateTimeLocalInput, toDateTimeLocalInput } from "~/lib/format";
import {
  diffRecordFields,
  formatDiffSummaryLines,
  parseOptionalTimestamp,
  parseRequiredTimestamp
} from "~/lib/master-diff";
import {
  masterDeleteRecordSchema,
  masterUpdateEntrySchema,
  masterUpdateRequestSchema
} from "~/lib/schemas";

describe("Master record diff and timestamp utilities", () => {
  it("computes only changed fields and formats readable item log entries", () => {
    const changes = diffRecordFields([
      { field: "title", label: "Title", before: "Front Wing", after: "Rear Wing" },
      { field: "department", label: "Department", before: "Aero", after: "Aero" },
      { field: "finalAmountCents", label: "Final Amount", before: "100,00 €", after: "125,50 €" }
    ]);

    expect(changes).toEqual([
      { field: "title", label: "Title", before: "Front Wing", after: "Rear Wing" },
      { field: "finalAmountCents", label: "Final Amount", before: "100,00 €", after: "125,50 €" }
    ]);

    const logText = formatDiffSummaryLines({
      changes,
      extraLines: ["Added attachment [invoice] fact_2026.pdf"],
      reason: "Corrected supplier bill"
    });
    expect(logText).toContain("Master edited record — Reason: Corrected supplier bill");
    expect(logText).toContain("• Title: Front Wing → Rear Wing");
    expect(logText).toContain("• Final Amount: 100,00 € → 125,50 €");
    expect(logText).toContain("• Added attachment [invoice] fact_2026.pdf");
  });

  it("parses optional and required timestamps cleanly and round-trips datetime-local format", () => {
    expect(parseOptionalTimestamp("", "Ordered At")).toBeNull();
    expect(parseOptionalTimestamp(null, "Archived At")).toBeNull();
    const dt = parseRequiredTimestamp("2026-09-15T14:30:00.000Z", "Created At");
    expect(dt.toISOString()).toBe("2026-09-15T14:30:00.000Z");

    expect(() => parseRequiredTimestamp("", "Created At")).toThrow(/Created At is required/);
    expect(() => parseOptionalTimestamp("not-a-date", "Ordered At")).toThrow(
      /Ordered At must be a valid date\/time/
    );

    const localInput = toDateTimeLocalInput("2026-09-15T14:30:00.000Z");
    expect(localInput).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    const roundTripped = fromDateTimeLocalInput(localInput);
    expect(roundTripped).not.toBeNull();
    expect(new Date(roundTripped!).getMinutes()).toBe(new Date("2026-09-15T14:30:00.000Z").getMinutes());
  });
});

describe("Master record validation schemas", () => {
  const sampleUuid = "11111111-1111-4111-8111-111111111111";
  const sampleUuid2 = "22222222-2222-4222-8222-222222222222";

  it("validates masterUpdateRequestSchema with all editable request fields", () => {
    const parsed = masterUpdateRequestSchema.safeParse({
      requestCode: "26-AERO-001",
      seasonId: sampleUuid,
      department: "aero",
      carSystem: "",
      title: "Carbon Endplate Sheets",
      explanation: "Imported order",
      status: "spending",
      creatorId: sampleUuid2,
      hasApproverResponse: true,
      selectedOptionClientKey: sampleUuid,
      selectedOptionPriceEur: "120.00",
      shippingEur: "15.00",
      importFeeEur: "0.00",
      finalAmountEur: "135.00",
      orderedById: sampleUuid2,
      orderedAt: "2026-05-01T10:00:00.000Z",
      invoicedById: sampleUuid2,
      invoicedAt: "2026-05-03T12:00:00.000Z",
      archivedAt: null,
      createdAt: "2026-04-28T08:00:00.000Z",
      options: [
        {
          id: sampleUuid,
          clientKey: sampleUuid,
          label: "Easy Composites",
          productUrl: "https://example.com/item",
          priceEur: "120.00",
          drawbacks: "2-week shipping",
          notes: "Preferred"
        }
      ],
      attachmentUpdates: [
        {
          id: sampleUuid,
          originalName: "renamed_invoice.pdf",
          kind: "invoice"
        }
      ],
      removeAttachmentIds: [],
      editReason: "Fix VAT rounding"
    });

    expect(parsed.success).toBe(true);
  });

  it("validates masterUpdateEntrySchema and masterDeleteRecordSchema", () => {
    const validEntry = masterUpdateEntrySchema.safeParse({
      entryCode: "26-ENT-007",
      seasonId: sampleUuid,
      title: "Sponsor Payment — Renault",
      category: "sponsorship",
      status: "confirmed",
      initialAmountEur: "5000.00",
      confirmedAmountEur: "4850.00",
      entryDate: "2026-03-10",
      comment: "Bank wire received",
      createdById: sampleUuid2,
      confirmedById: sampleUuid2,
      confirmedAt: "2026-03-12T09:00:00.000Z",
      createdAt: "2026-03-01T08:00:00.000Z",
      attachmentUpdates: [],
      removeAttachmentIds: [],
      editReason: "Adjusted net bank receipt"
    });
    expect(validEntry.success).toBe(true);

    const invalidCode = masterUpdateEntrySchema.safeParse({
      entryCode: "bad code with spaces!",
      seasonId: sampleUuid,
      title: "Bad",
      category: "sponsorship",
      status: "provisional",
      initialAmountEur: "100",
      entryDate: "2026-03-10",
      createdById: sampleUuid2,
      createdAt: "2026-03-01T08:00:00.000Z"
    });
    expect(invalidCode.success).toBe(false);

    expect(masterDeleteRecordSchema.safeParse({ reason: "Duplicate entry" }).success).toBe(true);
    expect(masterDeleteRecordSchema.safeParse({}).success).toBe(true);
  });
});
