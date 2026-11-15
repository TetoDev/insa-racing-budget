import {
  DEPARTMENTS,
  DEPARTMENT_MAP,
  ENTRY_CATEGORIES,
  ENTRY_CATEGORY_MAP,
  type DepartmentId,
  type EntryCategory,
  type EntryStatus,
  type RatePeriod,
  type RequestStatus
} from "./constants";
import { computeOrderTotalCents } from "./workflow";

export interface AnalyticsRequestItem {
  id: string;
  requestCode: string;
  title: string;
  department: DepartmentId;
  carSystem?: string;
  status: RequestStatus;
  selectedOptionPriceCents: number | null;
  shippingCents: number;
  importFeeCents: number;
  finalAmountCents: number | null;
  createdAt: string;
  orderedAt: string | null;
  invoicedAt: string | null;
}

export interface AnalyticsEntryItem {
  id: string;
  entryCode: string;
  title: string;
  category: EntryCategory;
  status: EntryStatus;
  initialAmountCents: number;
  confirmedAmountCents: number | null;
  entryDate: string;
  confirmedAt: string | null;
}

export interface DepartmentCarSystemRow {
  carSystem: string;
  finalCents: number;
  provisionalCents: number;
  totalProjectedCents: number;
  count: number;
}

export interface DepartmentBudgetRow {
  department: DepartmentId;
  code: string;
  label: string;
  color: string;
  allocatedCents: number | null;
  finalSpendingsCents: number;
  provisionalSpendingsCents: number;
  totalProjectedCents: number;
  remainingActualCents: number | null;
  remainingProjectedCents: number | null;
  utilizationFinalPct: number | null;
  utilizationProjectedPct: number | null;
  spendingCount: number;
  orderCount: number;
  openRequestCount: number;
  shareOfFinalPct: number;
  shareOfProjectedPct: number;
  carSystems: DepartmentCarSystemRow[];
}

export interface CategoryEntryRow {
  category: EntryCategory;
  label: string;
  color: string;
  confirmedCents: number;
  provisionalCents: number;
  totalProjectedCents: number;
  confirmedCount: number;
  provisionalCount: number;
  shareOfConfirmedPct: number;
}

export interface TimeBucketRow {
  bucketKey: string;
  label: string;
  finalSpendingsCents: number;
  provisionalSpendingsCents: number;
  confirmedEntriesCents: number;
  provisionalEntriesCents: number;
  netActualCents: number;
  netProjectedCents: number;
  cumulativeActualBalanceCents: number;
  cumulativeProjectedBalanceCents: number;
}

export interface BudgetAnalyticsReport {
  openingBalanceCents: number;
  totalAllocatedCents: number;
  confirmedEntriesCents: number;
  provisionalEntriesCents: number;
  finalSpendingsCents: number;
  committedTotalForSpendingsCents: number;
  invoiceVarianceCents: number;
  provisionalSpendingsCents: number;
  actualCashLeftCents: number;
  projectedBalanceCents: number;
  counts: {
    pendingReview: number;
    counterProposed: number;
    optionSelection: number;
    activeOrders: number;
    finalSpendings: number;
    archivedRequests: number;
    provisionalEntries: number;
    confirmedEntries: number;
  };
  byDepartment: DepartmentBudgetRow[];
  byCategory: CategoryEntryRow[];
  timeSeries: TimeBucketRow[];
  rates: {
    periodUnit: RatePeriod;
    periodCount: number;
    actualInputPerPeriodCents: number;
    actualOutputPerPeriodCents: number;
    actualNetPerPeriodCents: number;
    projectedInputPerPeriodCents: number;
    projectedOutputPerPeriodCents: number;
    projectedNetPerPeriodCents: number;
    actualInputOutputRatio: number | null;
    runwayPeriods: number | null;
  };
}

function toDayIso(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export function getBucketKey(dateStr: string, period: RatePeriod): { key: string; label: string } {
  const d = new Date(dateStr);
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  const year = safe.getUTCFullYear();
  const month = safe.getUTCMonth() + 1;
  const day = safe.getUTCDate();

  if (period === "day") {
    const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return { key, label: key };
  }

  if (period === "week") {
    const copy = new Date(Date.UTC(year, month - 1, day));
    const dayOfWeek = copy.getUTCDay() || 7;
    copy.setUTCDate(copy.getUTCDate() - dayOfWeek + 1);
    const key = copy.toISOString().slice(0, 10);
    return { key, label: `W/${key}` };
  }

  if (period === "quarter") {
    const q = Math.ceil(month / 3);
    const key = `${year}-Q${q}`;
    return { key, label: `Q${q} ${year}` };
  }

  const key = `${year}-${String(month).padStart(2, "0")}`;
  const label = new Intl.DateTimeFormat("fr-FR", {
    year: "numeric",
    month: "short",
    timeZone: "UTC"
  }).format(new Date(Date.UTC(year, month - 1, 1)));
  return { key, label };
}

function advanceBucketDate(d: Date, period: RatePeriod): void {
  if (period === "day") {
    d.setUTCDate(d.getUTCDate() + 1);
  } else if (period === "week") {
    d.setUTCDate(d.getUTCDate() + 7);
  } else if (period === "month") {
    d.setUTCMonth(d.getUTCMonth() + 1);
  } else {
    d.setUTCMonth(d.getUTCMonth() + 3);
  }
}

function enumerateBuckets(startIso: string, endIso: string, period: RatePeriod) {
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [] as Array<{ key: string; label: string }>;
  }

  const seen = new Set<string>();
  const out: Array<{ key: string; label: string }> = [];
  const cursor = new Date(start);
  let safety = 0;

  while (cursor <= end && safety < 500) {
    const b = getBucketKey(cursor.toISOString(), period);
    if (!seen.has(b.key)) {
      seen.add(b.key);
      out.push(b);
    }
    advanceBucketDate(cursor, period);
    safety++;
  }
  const endBucket = getBucketKey(end.toISOString(), period);
  if (!seen.has(endBucket.key)) {
    out.push(endBucket);
  }
  return out;
}

export function getEntryEffectiveAmountCents(entry: AnalyticsEntryItem): number {
  if (entry.status === "confirmed" && entry.confirmedAmountCents !== null) {
    return entry.confirmedAmountCents;
  }
  return entry.initialAmountCents;
}

export function computeBudgetAnalytics(params: {
  openingBalanceCents: number;
  requests: AnalyticsRequestItem[];
  entries: AnalyticsEntryItem[];
  periodUnit: RatePeriod;
  fromDate?: string;
  toDate?: string;
  departmentAllocations?: Partial<Record<DepartmentId, number>>;
}): BudgetAnalyticsReport {
  const {
    openingBalanceCents,
    requests,
    entries,
    periodUnit,
    fromDate,
    toDate,
    departmentAllocations
  } = params;

  const isInRange = (isoDate: string) => {
    const day = toDayIso(isoDate);
    if (fromDate && day < fromDate) return false;
    if (toDate && day > toDate) return false;
    return true;
  };

  let confirmedEntriesCents = 0;
  let provisionalEntriesCents = 0;
  let finalSpendingsCents = 0;
  let committedTotalForSpendingsCents = 0;
  let provisionalSpendingsCents = 0;

  const counts = {
    pendingReview: 0,
    counterProposed: 0,
    optionSelection: 0,
    activeOrders: 0,
    finalSpendings: 0,
    archivedRequests: 0,
    provisionalEntries: 0,
    confirmedEntries: 0
  };

  const deptCarSystems = new Map<
    DepartmentId,
    Map<string, { finalCents: number; provisionalCents: number; count: number }>
  >();

  const recordDeptCarSystem = (
    dept: DepartmentId,
    rawSystem: string | undefined,
    kind: "final" | "provisional",
    cents: number
  ) => {
    const label = rawSystem?.trim() || "Unspecified Subsystem";
    let bySys = deptCarSystems.get(dept);
    if (!bySys) {
      bySys = new Map();
      deptCarSystems.set(dept, bySys);
    }
    const existing = bySys.get(label) ?? { finalCents: 0, provisionalCents: 0, count: 0 };
    if (kind === "final") {
      existing.finalCents += cents;
    } else {
      existing.provisionalCents += cents;
    }
    existing.count++;
    bySys.set(label, existing);
  };

  const deptMap = new Map<DepartmentId, DepartmentBudgetRow>(
    DEPARTMENTS.map(d => {
      const rawAlloc = departmentAllocations?.[d.id] ?? 0;
      const allocatedCents = rawAlloc > 0 ? rawAlloc : null;
      return [
        d.id,
        {
          department: d.id,
          code: d.code,
          label: d.label,
          color: d.color,
          allocatedCents,
          finalSpendingsCents: 0,
          provisionalSpendingsCents: 0,
          totalProjectedCents: 0,
          remainingActualCents: null,
          remainingProjectedCents: null,
          utilizationFinalPct: null,
          utilizationProjectedPct: null,
          spendingCount: 0,
          orderCount: 0,
          openRequestCount: 0,
          shareOfFinalPct: 0,
          shareOfProjectedPct: 0,
          carSystems: []
        }
      ];
    })
  );

  const catMap = new Map<EntryCategory, CategoryEntryRow>(
    ENTRY_CATEGORIES.map(c => [
      c.id,
      {
        category: c.id,
        label: c.label,
        color: c.color,
        confirmedCents: 0,
        provisionalCents: 0,
        totalProjectedCents: 0,
        confirmedCount: 0,
        provisionalCount: 0,
        shareOfConfirmedPct: 0
      }
    ])
  );

  const bucketMap = new Map<
    string,
    {
      label: string;
      finalSpendingsCents: number;
      provisionalSpendingsCents: number;
      confirmedEntriesCents: number;
      provisionalEntriesCents: number;
    }
  >();

  const ensureBucket = (isoDate: string) => {
    const b = getBucketKey(isoDate, periodUnit);
    let existing = bucketMap.get(b.key);
    if (!existing) {
      existing = {
        label: b.label,
        finalSpendingsCents: 0,
        provisionalSpendingsCents: 0,
        confirmedEntriesCents: 0,
        provisionalEntriesCents: 0
      };
      bucketMap.set(b.key, existing);
    }
    return existing;
  };

  const observedDays: string[] = [];

  for (const req of requests) {
    const deptRow = deptMap.get(req.department);
    if (req.status === "pending_review") {
      counts.pendingReview++;
      if (deptRow) deptRow.openRequestCount++;
    } else if (req.status === "counter_proposed") {
      counts.counterProposed++;
      if (deptRow) deptRow.openRequestCount++;
    } else if (req.status === "option_selection") {
      counts.optionSelection++;
      if (deptRow) deptRow.openRequestCount++;
    } else if (req.status === "order") {
      const effectiveDate = req.orderedAt ?? req.createdAt;
      if (isInRange(effectiveDate)) {
        const total = computeOrderTotalCents(req);
        provisionalSpendingsCents += total;
        counts.activeOrders++;
        if (deptRow) {
          deptRow.provisionalSpendingsCents += total;
          deptRow.orderCount++;
        }
        recordDeptCarSystem(req.department, req.carSystem, "provisional", total);
        ensureBucket(effectiveDate).provisionalSpendingsCents += total;
        observedDays.push(toDayIso(effectiveDate));
      }
    } else if (req.status === "spending") {
      const effectiveDate = req.invoicedAt ?? req.orderedAt ?? req.createdAt;
      if (isInRange(effectiveDate)) {
        const total = computeOrderTotalCents(req);
        const committedBase =
          (req.selectedOptionPriceCents ?? 0) + req.shippingCents + req.importFeeCents;
        finalSpendingsCents += total;
        committedTotalForSpendingsCents += committedBase;
        counts.finalSpendings++;
        if (deptRow) {
          deptRow.finalSpendingsCents += total;
          deptRow.spendingCount++;
        }
        recordDeptCarSystem(req.department, req.carSystem, "final", total);
        ensureBucket(effectiveDate).finalSpendingsCents += total;
        observedDays.push(toDayIso(effectiveDate));
      }
    } else {
      counts.archivedRequests++;
    }
  }

  for (const entry of entries) {
    if (entry.status === "cancelled") continue;
    const effectiveDate =
      entry.status === "confirmed" ? (entry.confirmedAt ?? entry.entryDate) : entry.entryDate;
    if (!isInRange(effectiveDate)) continue;

    const amount = getEntryEffectiveAmountCents(entry);
    const catRow = catMap.get(entry.category);
    if (entry.status === "confirmed") {
      confirmedEntriesCents += amount;
      counts.confirmedEntries++;
      if (catRow) {
        catRow.confirmedCents += amount;
        catRow.confirmedCount++;
      }
      ensureBucket(effectiveDate).confirmedEntriesCents += amount;
    } else if (entry.status === "provisional") {
      provisionalEntriesCents += amount;
      counts.provisionalEntries++;
      if (catRow) {
        catRow.provisionalCents += amount;
        catRow.provisionalCount++;
      }
      ensureBucket(effectiveDate).provisionalEntriesCents += amount;
    }
    observedDays.push(toDayIso(effectiveDate));
  }

  const totalProjectedSpendings = finalSpendingsCents + provisionalSpendingsCents;
  let totalAllocatedCents = 0;

  const byDepartment = Array.from(deptMap.values()).map(row => {
    row.totalProjectedCents = row.finalSpendingsCents + row.provisionalSpendingsCents;
    row.shareOfFinalPct =
      finalSpendingsCents > 0
        ? Math.round((row.finalSpendingsCents / finalSpendingsCents) * 1000) / 10
        : 0;
    row.shareOfProjectedPct =
      totalProjectedSpendings > 0
        ? Math.round((row.totalProjectedCents / totalProjectedSpendings) * 1000) / 10
        : 0;

    if (row.allocatedCents !== null && row.allocatedCents > 0) {
      totalAllocatedCents += row.allocatedCents;
      row.remainingActualCents = row.allocatedCents - row.finalSpendingsCents;
      row.remainingProjectedCents = row.allocatedCents - row.totalProjectedCents;
      row.utilizationFinalPct =
        Math.round((row.finalSpendingsCents / row.allocatedCents) * 1000) / 10;
      row.utilizationProjectedPct =
        Math.round((row.totalProjectedCents / row.allocatedCents) * 1000) / 10;
    }

    const sysMap = deptCarSystems.get(row.department);
    if (sysMap) {
      row.carSystems = Array.from(sysMap.entries())
        .map(([carSystem, v]) => ({
          carSystem,
          finalCents: v.finalCents,
          provisionalCents: v.provisionalCents,
          totalProjectedCents: v.finalCents + v.provisionalCents,
          count: v.count
        }))
        .sort((a, b) => b.totalProjectedCents - a.totalProjectedCents);
    }

    return row;
  });

  const byCategory = Array.from(catMap.values()).map(row => {
    row.totalProjectedCents = row.confirmedCents + row.provisionalCents;
    row.shareOfConfirmedPct =
      confirmedEntriesCents > 0
        ? Math.round((row.confirmedCents / confirmedEntriesCents) * 1000) / 10
        : 0;
    return row;
  });

  observedDays.sort();
  const rangeStart = fromDate || observedDays[0];
  const rangeEnd = toDate || observedDays[observedDays.length - 1];

  if (rangeStart && rangeEnd) {
    for (const b of enumerateBuckets(rangeStart, rangeEnd, periodUnit)) {
      if (!bucketMap.has(b.key)) {
        bucketMap.set(b.key, {
          label: b.label,
          finalSpendingsCents: 0,
          provisionalSpendingsCents: 0,
          confirmedEntriesCents: 0,
          provisionalEntriesCents: 0
        });
      }
    }
  }

  const sortedKeys = Array.from(bucketMap.keys()).sort();
  let runningActual = openingBalanceCents;
  let runningProjected = openingBalanceCents;

  const timeSeries: TimeBucketRow[] = sortedKeys.map(key => {
    const b = bucketMap.get(key)!;
    const netActualCents = b.confirmedEntriesCents - b.finalSpendingsCents;
    const netProjectedCents =
      b.confirmedEntriesCents +
      b.provisionalEntriesCents -
      b.finalSpendingsCents -
      b.provisionalSpendingsCents;
    runningActual += netActualCents;
    runningProjected += netProjectedCents;
    return {
      bucketKey: key,
      label: b.label,
      finalSpendingsCents: b.finalSpendingsCents,
      provisionalSpendingsCents: b.provisionalSpendingsCents,
      confirmedEntriesCents: b.confirmedEntriesCents,
      provisionalEntriesCents: b.provisionalEntriesCents,
      netActualCents,
      netProjectedCents,
      cumulativeActualBalanceCents: runningActual,
      cumulativeProjectedBalanceCents: runningProjected
    };
  });

  const periodCount = Math.max(1, timeSeries.length);
  const actualCashLeftCents = openingBalanceCents + confirmedEntriesCents - finalSpendingsCents;
  const projectedBalanceCents =
    openingBalanceCents +
    confirmedEntriesCents +
    provisionalEntriesCents -
    finalSpendingsCents -
    provisionalSpendingsCents;

  const totalProjectedIn = confirmedEntriesCents + provisionalEntriesCents;
  const totalProjectedOut = finalSpendingsCents + provisionalSpendingsCents;
  const actualOutputPerPeriodCents = Math.round(finalSpendingsCents / periodCount);

  return {
    openingBalanceCents,
    totalAllocatedCents,
    confirmedEntriesCents,
    provisionalEntriesCents,
    finalSpendingsCents,
    committedTotalForSpendingsCents,
    invoiceVarianceCents: finalSpendingsCents - committedTotalForSpendingsCents,
    provisionalSpendingsCents,
    actualCashLeftCents,
    projectedBalanceCents,
    counts,
    byDepartment,
    byCategory,
    timeSeries,
    rates: {
      periodUnit,
      periodCount,
      actualInputPerPeriodCents: Math.round(confirmedEntriesCents / periodCount),
      actualOutputPerPeriodCents,
      actualNetPerPeriodCents: Math.round((confirmedEntriesCents - finalSpendingsCents) / periodCount),
      projectedInputPerPeriodCents: Math.round(totalProjectedIn / periodCount),
      projectedOutputPerPeriodCents: Math.round(totalProjectedOut / periodCount),
      projectedNetPerPeriodCents: Math.round((totalProjectedIn - totalProjectedOut) / periodCount),
      actualInputOutputRatio:
        finalSpendingsCents > 0
          ? Math.round((confirmedEntriesCents / finalSpendingsCents) * 100) / 100
          : null,
      runwayPeriods:
        actualOutputPerPeriodCents > 0
          ? actualCashLeftCents > 0
            ? Math.round((actualCashLeftCents / actualOutputPerPeriodCents) * 10) / 10
            : 0
          : null
    }
  };
}

export interface SearchableSpendingLike {
  requestCode: string;
  title: string;
  chosenOptionLabel: string;
  carSystem?: string | null;
  department?: DepartmentId;
  creatorName?: string;
}

/**
 * Filters spendings or active provisional orders by optional department and
 * space-separated search terms across tracking ID, title, option, car system, department, and requestor.
 */
export function filterBudgetItemsByQuery<T extends SearchableSpendingLike>(
  items: readonly T[],
  rawQuery: string,
  departmentFilter: DepartmentId | "all" = "all"
): T[] {
  const deptFiltered =
    departmentFilter === "all" ? items : items.filter(item => item.department === departmentFilter);
  const normalized = rawQuery.trim().toLowerCase();
  if (!normalized) return [...deptFiltered];
  const terms = normalized.split(/\s+/).filter(Boolean);
  return deptFiltered.filter(item => {
    const deptLabel = item.department ? DEPARTMENT_MAP[item.department]?.label ?? item.department : "";
    const deptCode = item.department ? DEPARTMENT_MAP[item.department]?.code ?? "" : "";
    const haystack = [
      item.requestCode,
      item.title,
      item.chosenOptionLabel,
      item.carSystem ?? "",
      deptLabel,
      deptCode,
      item.creatorName ?? ""
    ]
      .join(" ")
      .toLowerCase();
    return terms.every(term => haystack.includes(term));
  });
}

export interface SearchableEntryLike {
  entryCode: string;
  title: string;
  comment: string;
  category: EntryCategory;
  status: EntryStatus;
  creatorName?: string;
}

/**
 * Filters money entries by category, status, and multi-term text query.
 */
export function filterEntriesByQuery<T extends SearchableEntryLike>(
  entries: readonly T[],
  params: {
    query: string;
    category?: EntryCategory | "all";
    status?: EntryStatus | "all";
  }
): T[] {
  const cat = params.category ?? "all";
  const st = params.status ?? "all";
  const narrowed = entries.filter(e => {
    if (cat !== "all" && e.category !== cat) return false;
    if (st !== "all" && e.status !== st) return false;
    return true;
  });
  const normalized = params.query.trim().toLowerCase();
  if (!normalized) return narrowed;
  const terms = normalized.split(/\s+/).filter(Boolean);
  return narrowed.filter(e => {
    const catLabel = ENTRY_CATEGORY_MAP[e.category]?.label ?? e.category;
    const haystack = [e.entryCode, e.title, e.comment, catLabel, e.status, e.creatorName ?? ""]
      .join(" ")
      .toLowerCase();
    return terms.every(t => haystack.includes(t));
  });
}

export type DatePresetId = "this_month" | "last_30" | "last_90" | "season";

export function getDatePresetRange(
  preset: DatePresetId,
  now: Date = new Date()
): { fromDate: string; toDate: string } {
  if (preset === "season") {
    return { fromDate: "", toDate: "" };
  }
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const toDate = end.toISOString().slice(0, 10);

  if (preset === "this_month") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { fromDate: start.toISOString().slice(0, 10), toDate };
  }
  const daysBack = preset === "last_30" ? 29 : 89;
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - daysBack);
  return { fromDate: start.toISOString().slice(0, 10), toDate };
}

export function getBudgetUtilizationStatus(
  utilizationPct: number | null
): "unset" | "healthy" | "warning" | "over" {
  if (utilizationPct === null) return "unset";
  if (utilizationPct >= 100) return "over";
  if (utilizationPct >= 75) return "warning";
  return "healthy";
}
