import { describe, expect, it } from "vitest";
import {
  computeBudgetAnalytics,
  filterBudgetItemsByQuery,
  type AnalyticsEntryItem,
  type AnalyticsRequestItem
} from "~/lib/budget-analytics";
import { DEPARTMENTS, ENTRY_CATEGORIES } from "~/lib/constants";
import { formatEur, parseEurToCents, slugifyFilename } from "~/lib/format";

describe("EUR parsing, formatting, and filenames", () => {
  it("parses French/European and plain decimal Euro inputs into exact cents", () => {
    expect(parseEurToCents("1 234,50 €")).toBe(123_450);
    expect(parseEurToCents("1234.5")).toBe(123_450);
    expect(parseEurToCents("42")).toBe(4_200);
    expect(parseEurToCents("0")).toBeNull();
    expect(parseEurToCents("0", { allowZero: true })).toBe(0);
    expect(parseEurToCents("-10.00")).toBeNull();
    expect(parseEurToCents("-10.00", { allowNegative: true })).toBe(-1_000);
    expect(parseEurToCents("12.345")).toBeNull();
    expect(parseEurToCents("not-a-number")).toBeNull();
  });

  it("formats cents in EUR and sanitizes filenames safely", () => {
    expect(formatEur(123_450)).toContain("€");
    expect(slugifyFilename("Aérodynamique / Carbon Plate #1")).toBe(
      "Aerodynamique_Carbon_Plate_1"
    );
  });
});

describe("budget analytics and period rates", () => {
  const sampleRequests: AnalyticsRequestItem[] = [
    {
      id: "r1",
      requestCode: "26-AERO-001",
      title: "Prepreg Carbon Roll",
      department: "aero",
      status: "spending",
      selectedOptionPriceCents: 100_000,
      shippingCents: 5_000,
      importFeeCents: 2_500,
      finalAmountCents: 110_000,
      createdAt: "2026-01-10T10:00:00.000Z",
      orderedAt: "2026-01-12T10:00:00.000Z",
      invoicedAt: "2026-01-20T10:00:00.000Z"
    },
    {
      id: "r2",
      requestCode: "26-PT-001",
      title: "ECU Wiring Harness",
      department: "powertrain",
      status: "order",
      selectedOptionPriceCents: 40_000,
      shippingCents: 2_000,
      importFeeCents: 1_000,
      finalAmountCents: null,
      createdAt: "2026-02-02T09:00:00.000Z",
      orderedAt: "2026-02-05T09:00:00.000Z",
      invoicedAt: null
    },
    {
      id: "r3",
      requestCode: "26-ELEC-001",
      title: "BMS Telemetry Board",
      department: "electronics",
      status: "pending_review",
      selectedOptionPriceCents: null,
      shippingCents: 0,
      importFeeCents: 0,
      finalAmountCents: null,
      createdAt: "2026-02-10T09:00:00.000Z",
      orderedAt: null,
      invoicedAt: null
    },
    {
      id: "r4",
      requestCode: "26-CHAS-001",
      title: "Cancelled Tubing Order",
      department: "chassis",
      status: "order_cancelled_archived",
      selectedOptionPriceCents: 80_000,
      shippingCents: 0,
      importFeeCents: 0,
      finalAmountCents: null,
      createdAt: "2026-01-15T09:00:00.000Z",
      orderedAt: "2026-01-16T09:00:00.000Z",
      invoicedAt: null
    },
    {
      id: "r5",
      requestCode: "26-SUSP-001",
      title: "Denied Pushrod Quote",
      department: "suspension",
      status: "denied_archived",
      selectedOptionPriceCents: null,
      shippingCents: 0,
      importFeeCents: 0,
      finalAmountCents: null,
      createdAt: "2026-01-18T09:00:00.000Z",
      orderedAt: null,
      invoicedAt: null
    }
  ];

  const sampleEntries: AnalyticsEntryItem[] = [
    {
      id: "e1",
      entryCode: "26-ENT-001",
      title: "INSA Subvention Q1",
      category: "insa",
      status: "confirmed",
      initialAmountCents: 300_000,
      confirmedAmountCents: 320_000,
      entryDate: "2026-01-05",
      confirmedAt: "2026-01-08T12:00:00.000Z"
    },
    {
      id: "e2",
      entryCode: "26-ENT-002",
      title: "Aluminum Sponsor Grant",
      category: "sponsorship",
      status: "provisional",
      initialAmountCents: 150_000,
      confirmedAmountCents: null,
      entryDate: "2026-02-14",
      confirmedAt: null
    },
    {
      id: "e3",
      entryCode: "26-ENT-003",
      title: "Cancelled Donor Pledge",
      category: "donor",
      status: "cancelled",
      initialAmountCents: 99_900,
      confirmedAmountCents: null,
      entryDate: "2026-01-25",
      confirmedAt: null
    }
  ];

  it("computes actual vs projected balances, all 7 departments, all 5 categories, and period rates", () => {
    const report = computeBudgetAnalytics({
      openingBalanceCents: 50_000,
      requests: sampleRequests,
      entries: sampleEntries,
      periodUnit: "month"
    });

    // Confirmed entries: e1 (320_000). Cancelled e3 excluded.
    expect(report.confirmedEntriesCents).toBe(320_000);
    // Provisional entries: e2 (150_000).
    expect(report.provisionalEntriesCents).toBe(150_000);
    // Final spendings: r1 (110_000 final override). Cancelled/denied excluded.
    expect(report.finalSpendingsCents).toBe(110_000);
    // Provisional spendings: r2 (40_000 + 2_000 + 1_000 = 43_000).
    expect(report.provisionalSpendingsCents).toBe(43_000);

    // Actual Cash Left = 50_000 + 320_000 - 110_000 = 260_000
    expect(report.actualCashLeftCents).toBe(260_000);
    // Projected Balance = 260_000 + 150_000 - 43_000 = 367_000
    expect(report.projectedBalanceCents).toBe(367_000);

    expect(report.counts).toEqual({
      pendingReview: 1,
      counterProposed: 0,
      optionSelection: 0,
      activeOrders: 1,
      finalSpendings: 1,
      archivedRequests: 2,
      provisionalEntries: 1,
      confirmedEntries: 1
    });

    expect(report.byDepartment).toHaveLength(DEPARTMENTS.length);
    const aero = report.byDepartment.find(d => d.department === "aero")!;
    expect(aero.finalSpendingsCents).toBe(110_000);
    expect(aero.shareOfFinalPct).toBe(100);

    const elec = report.byDepartment.find(d => d.department === "electronics")!;
    expect(elec.openRequestCount).toBe(1);

    expect(report.byCategory).toHaveLength(ENTRY_CATEGORIES.length);
    const insa = report.byCategory.find(c => c.category === "insa")!;
    expect(insa.confirmedCents).toBe(320_000);
    expect(insa.shareOfConfirmedPct).toBe(100);

    // Two distinct months: 2026-01 and 2026-02
    expect(report.timeSeries.map(b => b.bucketKey)).toEqual(["2026-01", "2026-02"]);
    expect(report.rates.periodUnit).toBe("month");
    expect(report.rates.periodCount).toBe(2);
    expect(report.rates.actualInputPerPeriodCents).toBe(160_000);
    expect(report.rates.actualOutputPerPeriodCents).toBe(55_000);
    expect(report.rates.actualInputOutputRatio).toBeCloseTo(2.91, 2);
  });

  it("supports variable period granularity (week/quarter) and date-window filtering", () => {
    const qReport = computeBudgetAnalytics({
      openingBalanceCents: 0,
      requests: sampleRequests,
      entries: sampleEntries,
      periodUnit: "quarter"
    });
    expect(qReport.timeSeries.map(b => b.bucketKey)).toEqual(["2026-Q1"]);

    const febOnly = computeBudgetAnalytics({
      openingBalanceCents: 0,
      requests: sampleRequests,
      entries: sampleEntries,
      periodUnit: "week",
      fromDate: "2026-02-01",
      toDate: "2026-02-28"
    });
    expect(febOnly.finalSpendingsCents).toBe(0);
    expect(febOnly.provisionalSpendingsCents).toBe(43_000);
    expect(febOnly.confirmedEntriesCents).toBe(0);
    expect(febOnly.provisionalEntriesCents).toBe(150_000);
  });

  it("filters final spendings and provisional orders by ID, name, option, department, or car system", () => {
    const items = [
      {
        requestCode: "26-AERO-001",
        title: "Carbon Rear Wing Skins",
        chosenOptionLabel: "EasyComposites 2x2",
        carSystem: "Aerodynamics / Rear Wing",
        department: "aero" as const,
        creatorName: "Claire Aero"
      },
      {
        requestCode: "26-PT-004",
        title: "Cell Monitoring Harness",
        chosenOptionLabel: "TE Connectivity",
        carSystem: "Powertrain / High-Voltage Accumulator",
        department: "powertrain" as const,
        creatorName: "Lucas PT"
      }
    ];

    expect(filterBudgetItemsByQuery(items, "").length).toBe(2);
    expect(filterBudgetItemsByQuery(items, "26-AERO-001").map(i => i.requestCode)).toEqual(["26-AERO-001"]);
    expect(filterBudgetItemsByQuery(items, "carbon").map(i => i.requestCode)).toEqual(["26-AERO-001"]);
    expect(filterBudgetItemsByQuery(items, "accumulator").map(i => i.requestCode)).toEqual(["26-PT-004"]);
    expect(filterBudgetItemsByQuery(items, "powertrain harness").map(i => i.requestCode)).toEqual(["26-PT-004"]);
    expect(filterBudgetItemsByQuery(items, "nonexistent")).toEqual([]);
  });
});

import {
  filterEntriesByQuery,
  getBudgetUtilizationStatus,
  getDatePresetRange
} from "~/lib/budget-analytics";

describe("budget improvements: envelopes, variance, entry filters, presets & runway", () => {
  it("computes department allocations, utilization percentages, remaining cash, car system rollups, variance, and runway", () => {
    const report = computeBudgetAnalytics({
      openingBalanceCents: 100_000,
      periodUnit: "month",
      departmentAllocations: {
        aero: 100_000,
        electronics: 50_000
      },
      requests: [
        {
          id: "sp-1",
          requestCode: "26-AERO-001",
          title: "Carbon Rear Wing Skins",
          department: "aero",
          carSystem: "Rear Wing",
          status: "spending",
          selectedOptionPriceCents: 70_000,
          shippingCents: 5_000,
          importFeeCents: 5_000,
          finalAmountCents: 90_000,
          createdAt: "2026-03-01",
          orderedAt: "2026-03-04",
          invoicedAt: "2026-03-10"
        },
        {
          id: "ord-1",
          requestCode: "26-ELEC-001",
          title: "BMS Slave Boards",
          department: "electronics",
          carSystem: "Accumulator BMS",
          status: "order",
          selectedOptionPriceCents: 55_000,
          shippingCents: 5_000,
          importFeeCents: 0,
          finalAmountCents: null,
          createdAt: "2026-03-08",
          orderedAt: "2026-03-12",
          invoicedAt: null
        }
      ],
      entries: [
        {
          id: "ent-1",
          entryCode: "ENT-001",
          title: "Main Sponsor Tranche",
          category: "sponsorship",
          status: "confirmed",
          initialAmountCents: 80_000,
          confirmedAmountCents: 80_000,
          entryDate: "2026-03-05",
          confirmedAt: "2026-03-06"
        },
        {
          id: "ent-2",
          entryCode: "ENT-002",
          title: "FSDIE Grant",
          category: "fsdie",
          status: "provisional",
          initialAmountCents: 40_000,
          confirmedAmountCents: null,
          entryDate: "2026-03-20",
          confirmedAt: null
        }
      ]
    });

    expect(report.totalAllocatedCents).toBe(150_000);
    expect(report.committedTotalForSpendingsCents).toBe(80_000);
    expect(report.invoiceVarianceCents).toBe(10_000);

    const aero = report.byDepartment.find(d => d.department === "aero")!;
    expect(aero.allocatedCents).toBe(100_000);
    expect(aero.remainingActualCents).toBe(10_000);
    expect(aero.remainingProjectedCents).toBe(10_000);
    expect(aero.utilizationFinalPct).toBe(90);
    expect(aero.utilizationProjectedPct).toBe(90);
    expect(aero.carSystems).toEqual([
      {
        carSystem: "Rear Wing",
        finalCents: 90_000,
        provisionalCents: 0,
        totalProjectedCents: 90_000,
        count: 1
      }
    ]);

    const elec = report.byDepartment.find(d => d.department === "electronics")!;
    expect(elec.allocatedCents).toBe(50_000);
    expect(elec.remainingActualCents).toBe(50_000);
    expect(elec.remainingProjectedCents).toBe(-10_000);
    expect(elec.utilizationFinalPct).toBe(0);
    expect(elec.utilizationProjectedPct).toBe(120);
    expect(elec.carSystems[0]?.carSystem).toBe("Accumulator BMS");

    expect(report.rates.runwayPeriods).toBe(1);
  });

  it("maps utilization thresholds and filters entries + department budget items accurately", () => {
    expect(getBudgetUtilizationStatus(null)).toBe("unset");
    expect(getBudgetUtilizationStatus(74.9)).toBe("healthy");
    expect(getBudgetUtilizationStatus(75)).toBe("warning");
    expect(getBudgetUtilizationStatus(99.9)).toBe("warning");
    expect(getBudgetUtilizationStatus(100)).toBe("over");

    const deptItems = [
      {
        requestCode: "26-AERO-001",
        title: "Endplates",
        department: "aero" as const,
        carSystem: "Front Wing",
        chosenOptionLabel: "CF Plate"
      },
      {
        requestCode: "26-ELEC-001",
        title: "CAN Transceiver",
        department: "electronics" as const,
        carSystem: "Harness",
        chosenOptionLabel: "Mouser"
      }
    ];
    expect(filterBudgetItemsByQuery(deptItems, "", "electronics").map(i => i.requestCode)).toEqual([
      "26-ELEC-001"
    ]);

    const entries = [
      {
        entryCode: "ENT-001",
        title: "SKF Bearing Sponsor",
        category: "sponsorship" as const,
        status: "confirmed" as const,
        comment: "Signed contract",
        creatorName: "Alice"
      },
      {
        entryCode: "ENT-002",
        title: "INSA Mechanical Grant",
        category: "insa" as const,
        status: "provisional" as const,
        comment: "Pending bursar approval",
        creatorName: "Marc"
      }
    ];
    expect(
      filterEntriesByQuery(entries, { query: "bursar", category: "insa", status: "provisional" }).map(
        e => e.title
      )
    ).toEqual(["INSA Mechanical Grant"]);
    expect(
      filterEntriesByQuery(entries, { query: "", category: "sponsorship", status: "provisional" })
    ).toEqual([]);

    const nowRef = new Date("2026-11-15T12:00:00Z");
    expect(getDatePresetRange("this_month", nowRef)).toEqual({
      fromDate: "2026-11-01",
      toDate: "2026-11-15"
    });
    expect(getDatePresetRange("last_30", nowRef)).toEqual({
      fromDate: "2026-10-17",
      toDate: "2026-11-15"
    });
    expect(getDatePresetRange("season", nowRef)).toEqual({
      fromDate: "",
      toDate: ""
    });
  });
});
