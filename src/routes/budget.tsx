import { Title } from "@solidjs/meta";
import { A, createAsync, revalidate, useSearchParams, useSubmission } from "@solidjs/router";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  Edit3,
  FileText,
  History,
  PlusCircle,
  ShieldAlert,
  SlidersHorizontal,
  Trash2
} from "lucide-solid";
import { For, Match, Show, Switch, createMemo, createSignal } from "solid-js";
import { useApp } from "~/components/AppContext";
import {
  CategoryBadge,
  DepartmentBadge,
  EntryStatusBadge
} from "~/components/Badges";
import {
  BalanceCurveChart,
  CashflowBarsChart,
  CategoryEntryChart,
  DepartmentSpendChart
} from "~/components/BudgetCharts";
import {
  ConfirmProvisionalEntryModal,
  DepartmentBudgetsModal,
  EditProvisionalEntryModal,
  LogMoneyEntryModal,
  type ConfirmEntryTarget,
  type EditEntryTarget
} from "~/components/BudgetModals";
import {
  EntryItemLogModal,
  MasterDeleteConfirmModal,
  MasterEditEntryModal,
  type MasterDeleteTarget,
  type MasterEntryEditTarget
} from "~/components/MasterModals";
import { SearchInputBar } from "~/components/SearchInputBar";
import {
  filterBudgetItemsByQuery,
  filterEntriesByQuery,
  getBudgetUtilizationStatus,
  getDatePresetRange,
  type DatePresetId
} from "~/lib/budget-analytics";
import {
  BUDGET_SECTIONS,
  DEPARTMENTS,
  ENTRY_CATEGORIES,
  ENTRY_STATUS_LABELS,
  RATE_PERIODS,
  type BudgetSectionId,
  type DepartmentId,
  type EntryCategory,
  type EntryStatus,
  type RatePeriod
} from "~/lib/constants";
import { formatDate, formatEur, toIsoDateInput } from "~/lib/format";
import { canExportBudget, canManageBudgetEntries, isMaster } from "~/lib/permissions";
import { cancelEntryAction, queryBudgetSnapshot, queryMasterUsers } from "~/server/rpc";

type SortMode = "date_desc" | "amount_desc" | "amount_asc" | "code_asc";

function daysSinceIso(isoDate: string, todayIso: string): number {
  const start = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`).getTime();
  const end = new Date(`${todayIso}T00:00:00Z`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

export default function BudgetPage() {
  const app = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const todayIso = toIsoDateInput(new Date());

  const activeTab = (): BudgetSectionId => {
    const t = searchParams.tab;
    if (typeof t === "string" && BUDGET_SECTIONS.some(s => s.id === t)) {
      return t as BudgetSectionId;
    }
    return "summary";
  };

  const periodUnit = (): RatePeriod => {
    const p = searchParams.period;
    if (typeof p === "string" && RATE_PERIODS.includes(p as RatePeriod)) {
      return p as RatePeriod;
    }
    return "month";
  };

  const fromDate = () => (typeof searchParams.from === "string" ? searchParams.from : "");
  const toDate = () => (typeof searchParams.to === "string" ? searchParams.to : "");

  const deptFilter = (): DepartmentId | "all" => {
    const d = searchParams.dept;
    if (typeof d === "string" && DEPARTMENTS.some(x => x.id === d)) {
      return d as DepartmentId;
    }
    return "all";
  };

  const [spendingSearch, setSpendingSearch] = createSignal("");
  const [spendingSort, setSpendingSort] = createSignal<SortMode>("date_desc");
  const [orderSearch, setOrderSearch] = createSignal("");
  const [orderSort, setOrderSort] = createSignal<SortMode>("date_desc");

  const [entrySearch, setEntrySearch] = createSignal("");
  const [entryCategoryFilter, setEntryCategoryFilter] = createSignal<EntryCategory | "all">("all");
  const [entryStatusFilter, setEntryStatusFilter] = createSignal<EntryStatus | "all">("all");
  const [entrySort, setEntrySort] = createSignal<SortMode>("date_desc");

  const [expandedDepts, setExpandedDepts] = createSignal<DepartmentId[]>([]);

  // Modals
  const [newEntryOpen, setNewEntryOpen] = createSignal(false);
  const [budgetsModalOpen, setBudgetsModalOpen] = createSignal(false);
  const [confirmTarget, setConfirmTarget] = createSignal<ConfirmEntryTarget | null>(null);
  const [editTarget, setEditTarget] = createSignal<EditEntryTarget | null>(null);
  const [masterEditEntryTarget, setMasterEditEntryTarget] = createSignal<MasterEntryEditTarget | null>(
    null
  );
  const [itemLogEntryTarget, setItemLogEntryTarget] = createSignal<{
    id: string;
    entryCode: string;
    title: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = createSignal<MasterDeleteTarget | null>(null);

  const masterUsers = createAsync(() =>
    isMaster(app.user()?.role) ? queryMasterUsers() : Promise.resolve([])
  );

  const cancelEntrySub = useSubmission(cancelEntryAction);

  const snapshot = createAsync(() => {
    const sid = app.selectedSeasonId();
    if (!sid) return Promise.resolve(null);
    return queryBudgetSnapshot({
      seasonId: sid,
      periodUnit: periodUnit(),
      fromDate: fromDate() || undefined,
      toDate: toDate() || undefined
    });
  });

  const refreshBudget = async () => {
    await revalidate(["budget-snapshot", "audit-logs", "request-detail", "entry-item-log", "requests-list"]);
  };

  const canWriteBudget = () =>
    canManageBudgetEntries(app.user()?.role) && !app.isViewingArchived();

  const applyPreset = (preset: DatePresetId) => {
    const range = getDatePresetRange(preset);
    setSearchParams({
      from: range.fromDate || undefined,
      to: range.toDate || undefined
    });
  };

  const drillDownToDepartment = (dept: DepartmentId, tab: "all_spendings" | "provisional_spendings" = "all_spendings") => {
    setSearchParams({ tab, dept });
  };

  const toggleDeptExpand = (dept: DepartmentId) => {
    setExpandedDepts(prev =>
      prev.includes(dept) ? prev.filter(d => d !== dept) : [...prev, dept]
    );
  };

  const filteredSpendings = createMemo(() => {
    const data = snapshot();
    if (!data) return [];
    const base = filterBudgetItemsByQuery(data.spendings, spendingSearch(), deptFilter());
    const sort = spendingSort();
    return [...base].sort((a, b) => {
      if (sort === "amount_desc") return b.finalAmountCents - a.finalAmountCents;
      if (sort === "amount_asc") return a.finalAmountCents - b.finalAmountCents;
      if (sort === "code_asc") return a.requestCode.localeCompare(b.requestCode);
      return b.effectiveDate.localeCompare(a.effectiveDate);
    });
  });

  const filteredSpendingsTotalCents = createMemo(() =>
    filteredSpendings().reduce((sum, s) => sum + s.finalAmountCents, 0)
  );

  const filteredOrders = createMemo(() => {
    const data = snapshot();
    if (!data) return [];
    const base = filterBudgetItemsByQuery(data.provisionalSpendings, orderSearch(), deptFilter());
    const sort = orderSort();
    return [...base].sort((a, b) => {
      if (sort === "amount_desc") return b.provisionalTotalCents - a.provisionalTotalCents;
      if (sort === "amount_asc") return a.provisionalTotalCents - b.provisionalTotalCents;
      if (sort === "code_asc") return a.requestCode.localeCompare(b.requestCode);
      return b.orderedAt.localeCompare(a.orderedAt);
    });
  });

  const filteredOrdersTotalCents = createMemo(() =>
    filteredOrders().reduce((sum, o) => sum + o.provisionalTotalCents, 0)
  );

  const filteredProvisionalEntries = createMemo(() => {
    const data = snapshot();
    if (!data) return [];
    const base = filterEntriesByQuery(data.entries, {
      query: entrySearch(),
      category: entryCategoryFilter(),
      status: "provisional"
    });
    const sort = entrySort();
    return [...base].sort((a, b) => {
      if (sort === "amount_desc") return b.effectiveAmountCents - a.effectiveAmountCents;
      if (sort === "amount_asc") return a.effectiveAmountCents - b.effectiveAmountCents;
      if (sort === "code_asc") return a.entryCode.localeCompare(b.entryCode);
      return b.effectiveDate.localeCompare(a.effectiveDate);
    });
  });

  const filteredAllEntries = createMemo(() => {
    const data = snapshot();
    if (!data) return [];
    const base = filterEntriesByQuery(data.entries, {
      query: entrySearch(),
      category: entryCategoryFilter(),
      status: entryStatusFilter()
    });
    const sort = entrySort();
    return [...base].sort((a, b) => {
      if (sort === "amount_desc") return b.effectiveAmountCents - a.effectiveAmountCents;
      if (sort === "amount_asc") return a.effectiveAmountCents - b.effectiveAmountCents;
      if (sort === "code_asc") return a.entryCode.localeCompare(b.entryCode);
      return b.effectiveDate.localeCompare(a.effectiveDate);
    });
  });

  const exportUrl = () => {
    const params = new URLSearchParams();
    if (app.selectedSeasonId()) params.set("season", app.selectedSeasonId());
    params.set("period", periodUnit());
    if (fromDate()) params.set("from", fromDate());
    if (toDate()) params.set("to", toDate());
    params.set("sections", activeTab());
    return `/exports?${params.toString()}`;
  };

  const tabClusters: Array<{ group: string; ids: BudgetSectionId[] }> = [
    { group: "Overview", ids: ["summary"] },
    {
      group: "Spendings",
      ids: ["by_department", "by_timeframe", "all_spendings", "provisional_spendings"]
    },
    { group: "Entries", ids: ["provisional_entries", "all_entries", "entries_by_category"] },
    { group: "Cashflow", ids: ["cashflow_rates"] }
  ];

  const sectionIndex = new Map<BudgetSectionId, { label: string; num: number }>(
    BUDGET_SECTIONS.map((s, idx) => [s.id, { label: s.label, num: idx + 1 }])
  );

  return (
    <div class="space-y-5">
      <Title>Budget &amp; Analytics — INSA Racing Achats</Title>

      {/* Top Header & Actions */}
      <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold text-slate-900">Season Budget (EUR TTC)</h1>
          <p class="text-sm text-slate-500">
            All 9 budget views across inflows, department envelopes, provisional orders, final spendings, and cashflow trajectory.
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2.5">
          <Show when={canExportBudget(app.user()?.role)}>
            <A
              href={exportUrl()}
              class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Download class="h-4 w-4" />
              Export Budget
            </A>
          </Show>
          <Show when={canWriteBudget()}>
            <button
              type="button"
              onClick={() => setBudgetsModalOpen(true)}
              class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <SlidersHorizontal class="h-4 w-4" />
              Dept Envelopes
            </button>
            <button
              type="button"
              onClick={() => setNewEntryOpen(true)}
              class="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 cursor-pointer"
            >
              <PlusCircle class="h-4 w-4" />
              Log Money Entry
            </button>
          </Show>
        </div>
      </div>

      {/* Period, Date Range & Quick Presets Bar */}
      <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs flex flex-wrap items-end justify-between gap-4">
        <div class="flex flex-wrap items-end gap-3">
          <div>
            <label class="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
              Rate / Timeframe Period
            </label>
            <select
              value={periodUnit()}
              onChange={e => setSearchParams({ period: e.currentTarget.value as RatePeriod })}
              class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-800"
            >
              <For each={RATE_PERIODS}>
                {p => (
                  <option value={p}>
                    {p === "day"
                      ? "Daily"
                      : p === "week"
                        ? "Weekly"
                        : p === "month"
                          ? "Monthly"
                          : "Quarterly"}
                  </option>
                )}
              </For>
            </select>
          </div>

          <div>
            <label class="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
              From Date
            </label>
            <input
              type="date"
              value={fromDate()}
              onInput={e => setSearchParams({ from: e.currentTarget.value || undefined })}
              class="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
            />
          </div>

          <div>
            <label class="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
              To Date
            </label>
            <input
              type="date"
              value={toDate()}
              onInput={e => setSearchParams({ to: e.currentTarget.value || undefined })}
              class="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
            />
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-1.5">
          <span class="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mr-1">
            Presets:
          </span>
          <button
            type="button"
            onClick={() => applyPreset("this_month")}
            class="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            This Month
          </button>
          <button
            type="button"
            onClick={() => applyPreset("last_30")}
            class="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            Last 30d
          </button>
          <button
            type="button"
            onClick={() => applyPreset("last_90")}
            class="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            Last 90d
          </button>
          <button
            type="button"
            onClick={() => applyPreset("season")}
            class={`rounded-lg border px-2.5 py-1 text-xs font-medium cursor-pointer ${
              !fromDate() && !toDate()
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
            }`}
          >
            Full Season
          </button>
        </div>
      </div>

      {/* Persistent Financial Strip + Solvency Alert */}
      <Show when={snapshot()}>
        {data => (
          <div class="space-y-3">
            <div class="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <div class="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xs">
                <div class="text-[11px] font-semibold uppercase text-slate-400">Actual Cash Left</div>
                <div
                  class={`mt-0.5 text-lg font-extrabold tabular-nums ${
                    data().analytics.actualCashLeftCents < 0 ? "text-rose-700" : "text-slate-900"
                  }`}
                >
                  {formatEur(data().analytics.actualCashLeftCents)}
                </div>
              </div>
              <div class="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xs">
                <div class="text-[11px] font-semibold uppercase text-slate-400">Projected Balance</div>
                <div
                  class={`mt-0.5 text-lg font-extrabold tabular-nums ${
                    data().analytics.projectedBalanceCents < 0 ? "text-rose-700" : "text-sky-700"
                  }`}
                >
                  {formatEur(data().analytics.projectedBalanceCents)}
                </div>
              </div>
              <div class="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xs">
                <div class="text-[11px] font-semibold uppercase text-slate-400">Inflows (Confirmed)</div>
                <div class="mt-0.5 text-lg font-extrabold tabular-nums text-emerald-700">
                  {formatEur(data().analytics.confirmedEntriesCents)}
                  <Show when={data().analytics.provisionalEntriesCents > 0}>
                    <span class="text-xs font-semibold text-amber-600">
                      {" "}+{formatEur(data().analytics.provisionalEntriesCents)}
                    </span>
                  </Show>
                </div>
              </div>
              <div class="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xs">
                <div class="text-[11px] font-semibold uppercase text-slate-400">Outflows (Final)</div>
                <div class="mt-0.5 text-lg font-extrabold tabular-nums text-slate-900">
                  {formatEur(data().analytics.finalSpendingsCents)}
                  <Show when={data().analytics.provisionalSpendingsCents > 0}>
                    <span class="text-xs font-semibold text-orange-600">
                      {" "}+{formatEur(data().analytics.provisionalSpendingsCents)}
                    </span>
                  </Show>
                </div>
              </div>
            </div>

            <Show
              when={
                data().analytics.projectedBalanceCents < 0 ||
                data().analytics.actualCashLeftCents < 0
              }
            >
              <div class="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 flex items-start gap-3 text-xs text-rose-900">
                <AlertTriangle class="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <strong>Liquidity Warning:</strong>{" "}
                  <Show
                    when={data().analytics.actualCashLeftCents < 0}
                    fallback={
                      <>
                        Projected balance drops to{" "}
                        <strong>{formatEur(data().analytics.projectedBalanceCents)}</strong> after accounting
                        for {data().analytics.counts.activeOrders} active provisional order(s) and{" "}
                        {data().analytics.counts.provisionalEntries} unconfirmed inflow(s).
                      </>
                    }
                  >
                    Actual confirmed cash is currently{" "}
                    <strong>{formatEur(data().analytics.actualCashLeftCents)}</strong>; log or confirm
                    pending funding entries to cover final spendings.
                  </Show>
                </div>
              </div>
            </Show>
          </div>
        )}
      </Show>

      {/* Grouped 9-Section Navigation */}
      <div class="rounded-2xl border border-slate-200 bg-white p-3 shadow-xs space-y-2">
        <div class="flex flex-wrap gap-3">
          <For each={tabClusters}>
            {cluster => (
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1">
                  {cluster.group}
                </span>
                <For each={cluster.ids}>
                  {id => {
                    const meta = sectionIndex.get(id)!;
                    return (
                      <button
                        type="button"
                        onClick={() => setSearchParams({ tab: id })}
                        class={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                          activeTab() === id
                            ? "bg-slate-900 text-white shadow-xs"
                            : "bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        {meta.num}. {meta.label}
                      </button>
                    );
                  }}
                </For>
              </div>
            )}
          </For>
        </div>
      </div>

      {/* Active Section View */}
      <Show
        when={snapshot()}
        fallback={
          <div class="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
            Calculating season budget analytics...
          </div>
        }
      >
        {data => (
          <Switch>
            {/* 1. Dashboard and summary */}
            <Match when={activeTab() === "summary"}>
              <div class="space-y-6">
                <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
                    <div class="text-xs font-semibold uppercase text-slate-400">Opening Balance</div>
                    <div class="mt-1.5 text-xl font-extrabold tabular-nums text-slate-900">
                      {formatEur(data().analytics.openingBalanceCents)}
                    </div>
                    <div class="mt-1 text-xs text-slate-500">
                      {data().analytics.totalAllocatedCents > 0
                        ? `Dept envelopes: ${formatEur(data().analytics.totalAllocatedCents)}`
                        : "No dept caps set"}
                    </div>
                  </div>
                  <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
                    <div class="text-xs font-semibold uppercase text-slate-400">Request Pipeline</div>
                    <div class="mt-1.5 text-xl font-extrabold tabular-nums text-slate-900">
                      {data().analytics.counts.pendingReview +
                        data().analytics.counts.counterProposed +
                        data().analytics.counts.optionSelection}{" "}
                      <span class="text-sm font-medium text-slate-500">open</span>
                    </div>
                    <div class="mt-1 text-xs text-slate-500">
                      {data().analytics.counts.activeOrders} active orders ·{" "}
                      {data().analytics.counts.archivedRequests} archived
                    </div>
                  </div>
                  <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
                    <div class="text-xs font-semibold uppercase text-slate-400">
                      Quote → Invoice Variance
                    </div>
                    <div
                      class={`mt-1.5 text-xl font-extrabold tabular-nums ${
                        data().analytics.invoiceVarianceCents > 0
                          ? "text-rose-700"
                          : data().analytics.invoiceVarianceCents < 0
                            ? "text-emerald-700"
                            : "text-slate-900"
                      }`}
                    >
                      {data().analytics.invoiceVarianceCents > 0 ? "+" : ""}
                      {formatEur(data().analytics.invoiceVarianceCents)}
                    </div>
                    <div class="mt-1 text-xs text-slate-500">
                      vs {formatEur(data().analytics.committedTotalForSpendingsCents)} committed
                    </div>
                  </div>
                  <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
                    <div class="text-xs font-semibold uppercase text-slate-400">Season Window</div>
                    <div class="mt-1.5 text-sm font-bold text-slate-900">
                      {formatDate(data().season.startDate)} → {formatDate(data().season.deadlineDate)}
                    </div>
                    <div class="mt-1 text-xs text-slate-500 uppercase font-semibold">
                      Status: {data().season.status}
                    </div>
                  </div>
                </div>

                <div class="grid gap-6 lg:grid-cols-2">
                  <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
                    <div class="flex items-center justify-between mb-4">
                      <h2 class="text-base font-bold text-slate-900">Department Snapshot</h2>
                      <span class="text-[11px] text-slate-400">Click bar to filter spendings</span>
                    </div>
                    <DepartmentSpendChart
                      rows={data().analytics.byDepartment}
                      onSelectDepartment={dept => drillDownToDepartment(dept, "all_spendings")}
                    />
                  </div>
                  <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
                    <h2 class="text-base font-bold text-slate-900 mb-4">Inflows by Category</h2>
                    <CategoryEntryChart rows={data().analytics.byCategory} />
                  </div>
                </div>

                <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
                  <h2 class="text-base font-bold text-slate-900 mb-4">
                    Cumulative Cash Balance Trajectory ({periodUnit()}ly)
                  </h2>
                  <BalanceCurveChart
                    buckets={data().analytics.timeSeries}
                    openingBalanceCents={data().analytics.openingBalanceCents}
                  />
                </div>
              </div>
            </Match>

            {/* 2. Dashboard and spendings by department */}
            <Match when={activeTab() === "by_department"}>
              <div class="space-y-6">
                <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
                  <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
                    <h2 class="text-base font-bold text-slate-900">Department Spendings Comparison</h2>
                    <Show when={canWriteBudget()}>
                      <button
                        type="button"
                        onClick={() => setBudgetsModalOpen(true)}
                        class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
                      >
                        <SlidersHorizontal class="h-3.5 w-3.5" />
                        Edit Department Envelopes
                      </button>
                    </Show>
                  </div>
                  <DepartmentSpendChart
                    rows={data().analytics.byDepartment}
                    onSelectDepartment={dept => drillDownToDepartment(dept, "all_spendings")}
                  />
                </div>

                <div class="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
                  <div class="overflow-x-auto">
                    <table class="w-full text-left text-sm">
                      <thead class="bg-slate-50 border-b border-slate-200 text-xs font-semibold uppercase text-slate-500">
                        <tr>
                          <th class="px-4 py-3">Department &amp; Subsystems</th>
                          <th class="px-4 py-3 text-right">Allocated</th>
                          <th class="px-4 py-3 text-right">Final</th>
                          <th class="px-4 py-3 text-right">Provisional</th>
                          <th class="px-4 py-3 text-right">Projected Total</th>
                          <th class="px-4 py-3 text-right">Remaining</th>
                          <th class="px-4 py-3">Utilization</th>
                          <th class="px-4 py-3 text-right">Inv / Ord / Open</th>
                          <th class="px-4 py-3 text-right">Drilldown</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-slate-100">
                        <For each={data().analytics.byDepartment}>
                          {row => {
                            const isOpen = () => expandedDepts().includes(row.department);
                            const utilStatus = () =>
                              getBudgetUtilizationStatus(row.utilizationProjectedPct);
                            return (
                              <>
                                <tr class="hover:bg-slate-50/70">
                                  <td class="px-4 py-3">
                                    <div class="flex items-center gap-2">
                                      <Show
                                        when={row.carSystems.length > 0}
                                        fallback={<span class="w-4" />}
                                      >
                                        <button
                                          type="button"
                                          onClick={() => toggleDeptExpand(row.department)}
                                          title="Expand Car System breakdown"
                                          class="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
                                        >
                                          <Show
                                            when={isOpen()}
                                            fallback={<ChevronRight class="h-4 w-4" />}
                                          >
                                            <ChevronDown class="h-4 w-4" />
                                          </Show>
                                        </button>
                                      </Show>
                                      <DepartmentBadge department={row.department} />
                                    </div>
                                  </td>
                                  <td class="px-4 py-3 text-right tabular-nums text-slate-600">
                                    {row.allocatedCents !== null
                                      ? formatEur(row.allocatedCents)
                                      : "—"}
                                  </td>
                                  <td class="px-4 py-3 text-right tabular-nums font-bold text-slate-900">
                                    {formatEur(row.finalSpendingsCents)}
                                  </td>
                                  <td class="px-4 py-3 text-right tabular-nums text-orange-700">
                                    {formatEur(row.provisionalSpendingsCents)}
                                  </td>
                                  <td class="px-4 py-3 text-right tabular-nums font-semibold text-slate-800">
                                    {formatEur(row.totalProjectedCents)}
                                  </td>
                                  <td
                                    class={`px-4 py-3 text-right tabular-nums font-semibold ${
                                      row.remainingProjectedCents !== null &&
                                      row.remainingProjectedCents < 0
                                        ? "text-rose-700"
                                        : "text-emerald-700"
                                    }`}
                                  >
                                    {row.remainingProjectedCents !== null
                                      ? formatEur(row.remainingProjectedCents)
                                      : "—"}
                                  </td>
                                  <td class="px-4 py-3">
                                    <Show
                                      when={row.utilizationProjectedPct !== null}
                                      fallback={<span class="text-xs text-slate-400">{row.shareOfFinalPct}% share</span>}
                                    >
                                      <span
                                        class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${
                                          utilStatus() === "over"
                                            ? "bg-rose-100 text-rose-700"
                                            : utilStatus() === "warning"
                                              ? "bg-amber-100 text-amber-800"
                                              : "bg-emerald-100 text-emerald-800"
                                        }`}
                                      >
                                        {row.utilizationProjectedPct}%
                                      </span>
                                    </Show>
                                  </td>
                                  <td class="px-4 py-3 text-right tabular-nums text-xs text-slate-500">
                                    {row.spendingCount} / {row.orderCount} / {row.openRequestCount}
                                  </td>
                                  <td class="px-4 py-3 text-right">
                                    <button
                                      type="button"
                                      onClick={() => drillDownToDepartment(row.department, "all_spendings")}
                                      class="text-xs font-semibold text-red-600 hover:underline cursor-pointer"
                                    >
                                      Spendings →
                                    </button>
                                  </td>
                                </tr>
                                <Show when={isOpen() && row.carSystems.length > 0}>
                                  <tr class="bg-slate-50/70">
                                    <td colSpan={9} class="px-10 py-3">
                                      <div class="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                                        {row.label} — Car System Breakdown
                                      </div>
                                      <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                        <For each={row.carSystems}>
                                          {sys => (
                                            <div class="rounded-lg border border-slate-200 bg-white px-3 py-2 flex items-center justify-between gap-2 text-xs">
                                              <div class="min-w-0">
                                                <div class="font-semibold text-slate-800 truncate">
                                                  {sys.carSystem}
                                                </div>
                                                <div class="text-[11px] text-slate-400">
                                                  {sys.count} item(s) · Final {formatEur(sys.finalCents)}
                                                </div>
                                              </div>
                                              <div class="font-bold tabular-nums text-slate-900 shrink-0">
                                                {formatEur(sys.totalProjectedCents)}
                                              </div>
                                            </div>
                                          )}
                                        </For>
                                      </div>
                                    </td>
                                  </tr>
                                </Show>
                              </>
                            );
                          }}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </Match>

            {/* 3. Spendings by timeframe */}
            <Match when={activeTab() === "by_timeframe"}>
              <div class="space-y-6">
                <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
                  <h2 class="text-base font-bold text-slate-900 mb-4">
                    Spendings Over Time ({periodUnit()})
                  </h2>
                  <CashflowBarsChart buckets={data().analytics.timeSeries} mode="spendings" />
                </div>

                <div class="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
                  <div class="overflow-x-auto">
                    <table class="w-full text-left text-sm">
                      <thead class="bg-slate-50 border-b border-slate-200 text-xs font-semibold uppercase text-slate-500">
                        <tr>
                          <th class="px-4 py-3">Period</th>
                          <th class="px-4 py-3 text-right">Final Spendings</th>
                          <th class="px-4 py-3 text-right">Provisional Orders</th>
                          <th class="px-4 py-3 text-right">Combined Outflow</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-slate-100">
                        <For each={data().analytics.timeSeries}>
                          {row => (
                            <tr>
                              <td class="px-4 py-3 font-medium text-slate-800">{row.label}</td>
                              <td class="px-4 py-3 text-right tabular-nums font-bold text-slate-900">
                                {formatEur(row.finalSpendingsCents)}
                              </td>
                              <td class="px-4 py-3 text-right tabular-nums text-orange-700">
                                {formatEur(row.provisionalSpendingsCents)}
                              </td>
                              <td class="px-4 py-3 text-right tabular-nums font-semibold">
                                {formatEur(row.finalSpendingsCents + row.provisionalSpendingsCents)}
                              </td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </Match>

            {/* 4. All Spendings */}
            <Match when={activeTab() === "all_spendings"}>
              <div class="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
                <div class="p-4 border-b border-slate-100 space-y-3">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 class="text-base font-bold text-slate-900">
                        <Show
                          when={spendingSearch().trim().length > 0 || deptFilter() !== "all"}
                          fallback={<>All Final Spendings ({data().spendings.length})</>}
                        >
                          Matching Final Spendings ({filteredSpendings().length} of{" "}
                          {data().spendings.length})
                        </Show>
                      </h2>
                      <Show when={spendingSearch().trim().length > 0 || deptFilter() !== "all"}>
                        <div class="text-xs text-slate-500">
                          Filtered subtotal:{" "}
                          <span class="font-bold text-emerald-800 tabular-nums">
                            {formatEur(filteredSpendingsTotalCents())}
                          </span>{" "}
                          · Season total:{" "}
                          <span class="tabular-nums">
                            {formatEur(data().analytics.finalSpendingsCents)}
                          </span>
                        </div>
                      </Show>
                    </div>
                    <span class="font-extrabold tabular-nums text-emerald-800">
                      {formatEur(
                        spendingSearch().trim().length > 0 || deptFilter() !== "all"
                          ? filteredSpendingsTotalCents()
                          : data().analytics.finalSpendingsCents
                      )}
                    </span>
                  </div>

                  <div class="flex flex-col sm:flex-row gap-2.5">
                    <SearchInputBar
                      value={spendingSearch()}
                      onInput={setSpendingSearch}
                      placeholder="Search by ID (e.g. 26-AERO-001), item, option, or car system..."
                      class="flex-1"
                    />
                    <select
                      value={deptFilter()}
                      onChange={e =>
                        setSearchParams({
                          dept: e.currentTarget.value === "all" ? undefined : e.currentTarget.value
                        })
                      }
                      class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    >
                      <option value="all">All Departments</option>
                      <For each={DEPARTMENTS}>
                        {d => (
                          <option value={d.id}>
                            {d.label} ({d.code})
                          </option>
                        )}
                      </For>
                    </select>
                    <select
                      value={spendingSort()}
                      onChange={e => setSpendingSort(e.currentTarget.value as SortMode)}
                      class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    >
                      <option value="date_desc">Newest First</option>
                      <option value="amount_desc">Amount: High → Low</option>
                      <option value="amount_asc">Amount: Low → High</option>
                      <option value="code_asc">ID: A → Z</option>
                    </select>
                  </div>
                </div>

                <div class="overflow-x-auto">
                  <table class="w-full text-left text-sm">
                    <thead class="bg-slate-50 border-b border-slate-200 text-xs font-semibold uppercase text-slate-500">
                      <tr>
                        <th class="px-4 py-3">ID</th>
                        <th class="px-4 py-3">Item &amp; Option</th>
                        <th class="px-4 py-3">Department</th>
                        <th class="px-4 py-3 text-right">Base + Fees</th>
                        <th class="px-4 py-3 text-right">Final EUR</th>
                        <th class="px-4 py-3">Invoice Date</th>
                        <th class="px-4 py-3">Invoice</th>
                        <Show when={isMaster(app.user()?.role)}>
                          <th class="px-4 py-3 text-right">Master</th>
                        </Show>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                      <Show
                        when={filteredSpendings().length > 0}
                        fallback={
                          <tr>
                            <td
                              colSpan={isMaster(app.user()?.role) ? 8 : 7}
                              class="px-4 py-8 text-center text-sm text-slate-500"
                            >
                              <Show
                                when={spendingSearch().trim().length > 0 || deptFilter() !== "all"}
                                fallback="No final spendings recorded in this period."
                              >
                                No spendings match your current filters.{" "}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSpendingSearch("");
                                    setSearchParams({ dept: undefined });
                                  }}
                                  class="text-red-600 font-semibold hover:underline cursor-pointer"
                                >
                                  Clear search
                                </button>
                              </Show>
                            </td>
                          </tr>
                        }
                      >
                        <For each={filteredSpendings()}>
                          {sp => {
                            const inv = () => sp.attachments.find(a => a.kind === "invoice");
                            return (
                              <tr class="hover:bg-slate-50/80">
                                <td class="px-4 py-3 font-mono text-xs font-bold whitespace-nowrap">
                                  <A
                                    href={`/requests/${sp.requestCode}`}
                                    class="text-red-600 hover:underline"
                                  >
                                    {sp.requestCode}
                                  </A>
                                </td>
                                <td class="px-4 py-3">
                                  <A
                                    href={`/requests/${sp.requestCode}`}
                                    class="font-semibold text-slate-900 hover:text-red-600"
                                  >
                                    {sp.title}
                                  </A>
                                  <div class="text-xs text-slate-500">{sp.chosenOptionLabel}</div>
                                  <Show when={sp.carSystem}>
                                    <div class="mt-1 inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                                      {sp.carSystem}
                                    </div>
                                  </Show>
                                </td>
                                <td class="px-4 py-3">
                                  <DepartmentBadge department={sp.department} />
                                </td>
                                <td class="px-4 py-3 text-right text-xs tabular-nums text-slate-500 whitespace-nowrap">
                                  {formatEur(sp.basePriceCents)} +{" "}
                                  {formatEur(sp.shippingCents + sp.importFeeCents)}
                                  <Show when={sp.varianceCents !== 0}>
                                    <div
                                      class={`text-[11px] font-semibold ${
                                        sp.varianceCents > 0 ? "text-rose-600" : "text-emerald-700"
                                      }`}
                                    >
                                      {sp.varianceCents > 0 ? "+" : ""}
                                      {formatEur(sp.varianceCents)} vs quote
                                    </div>
                                  </Show>
                                </td>
                                <td class="px-4 py-3 text-right tabular-nums font-bold text-emerald-800">
                                  {formatEur(sp.finalAmountCents)}
                                </td>
                                <td class="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                                  {formatDate(sp.effectiveDate)}
                                </td>
                                <td class="px-4 py-3">
                                  <Show when={inv()} fallback="—">
                                    {a => (
                                      <a
                                        href={`/api/files/${a().id}`}
                                        class="text-xs font-semibold text-emerald-700 hover:underline inline-flex items-center gap-1"
                                      >
                                        <Download class="h-3.5 w-3.5" />
                                        PDF/File
                                      </a>
                                    )}
                                  </Show>
                                </td>
                                <Show when={isMaster(app.user()?.role)}>
                                  <td class="px-4 py-3 text-right whitespace-nowrap">
                                    <div class="inline-flex items-center gap-1.5">
                                      <A
                                        href={`/requests/${sp.requestCode}?masterEdit=1`}
                                        class="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                                      >
                                        <ShieldAlert class="h-3 w-3" />
                                        Edit
                                      </A>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setDeleteTarget({
                                            kind: "request",
                                            id: sp.id,
                                            code: sp.requestCode,
                                            title: sp.title,
                                            statusLabel: "Spending (Final)",
                                            attachmentCount: sp.attachments.length
                                          })
                                        }
                                        class="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 cursor-pointer"
                                      >
                                        <Trash2 class="h-3 w-3" />
                                        Delete
                                      </button>
                                    </div>
                                  </td>
                                </Show>
                              </tr>
                            );
                          }}
                        </For>
                      </Show>
                    </tbody>
                  </table>
                </div>
              </div>
            </Match>

            {/* 5. Provisional Spendings */}
            <Match when={activeTab() === "provisional_spendings"}>
              <div class="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
                <div class="p-4 border-b border-slate-100 space-y-3">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <h2 class="text-base font-bold text-slate-900">
                      <Show
                        when={orderSearch().trim().length > 0 || deptFilter() !== "all"}
                        fallback={
                          <>
                            Provisional Spendings — Active Orders ({data().provisionalSpendings.length})
                          </>
                        }
                      >
                        Matching Active Orders ({filteredOrders().length} of{" "}
                        {data().provisionalSpendings.length})
                      </Show>
                    </h2>
                    <span class="font-extrabold tabular-nums text-orange-700">
                      {formatEur(
                        orderSearch().trim().length > 0 || deptFilter() !== "all"
                          ? filteredOrdersTotalCents()
                          : data().analytics.provisionalSpendingsCents
                      )}
                    </span>
                  </div>

                  <div class="flex flex-col sm:flex-row gap-2.5">
                    <SearchInputBar
                      value={orderSearch()}
                      onInput={setOrderSearch}
                      placeholder="Search active orders by ID, item, option, or car system..."
                      class="flex-1"
                    />
                    <select
                      value={deptFilter()}
                      onChange={e =>
                        setSearchParams({
                          dept: e.currentTarget.value === "all" ? undefined : e.currentTarget.value
                        })
                      }
                      class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    >
                      <option value="all">All Departments</option>
                      <For each={DEPARTMENTS}>
                        {d => (
                          <option value={d.id}>
                            {d.label} ({d.code})
                          </option>
                        )}
                      </For>
                    </select>
                    <select
                      value={orderSort()}
                      onChange={e => setOrderSort(e.currentTarget.value as SortMode)}
                      class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    >
                      <option value="date_desc">Newest First</option>
                      <option value="amount_desc">Amount: High → Low</option>
                      <option value="amount_asc">Amount: Low → High</option>
                      <option value="code_asc">ID: A → Z</option>
                    </select>
                  </div>
                </div>

                <div class="overflow-x-auto">
                  <table class="w-full text-left text-sm">
                    <thead class="bg-slate-50 border-b border-slate-200 text-xs font-semibold uppercase text-slate-500">
                      <tr>
                        <th class="px-4 py-3">ID</th>
                        <th class="px-4 py-3">Order</th>
                        <th class="px-4 py-3">Department</th>
                        <th class="px-4 py-3 text-right">Base + Fees</th>
                        <th class="px-4 py-3 text-right">Provisional Total</th>
                        <th class="px-4 py-3">Action</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                      <Show
                        when={filteredOrders().length > 0}
                        fallback={
                          <tr>
                            <td colSpan={6} class="px-4 py-8 text-center text-sm text-slate-500">
                              <Show
                                when={orderSearch().trim().length > 0 || deptFilter() !== "all"}
                                fallback="No active orders in this period."
                              >
                                No orders match your current filters.{" "}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOrderSearch("");
                                    setSearchParams({ dept: undefined });
                                  }}
                                  class="text-red-600 font-semibold hover:underline cursor-pointer"
                                >
                                  Clear search
                                </button>
                              </Show>
                            </td>
                          </tr>
                        }
                      >
                        <For each={filteredOrders()}>
                          {ord => {
                            const age = () => daysSinceIso(ord.orderedAt, todayIso);
                            return (
                              <tr class="hover:bg-slate-50/80">
                                <td class="px-4 py-3 font-mono text-xs font-bold whitespace-nowrap">
                                  <A
                                    href={`/requests/${ord.requestCode}`}
                                    class="text-red-600 hover:underline"
                                  >
                                    {ord.requestCode}
                                  </A>
                                </td>
                                <td class="px-4 py-3">
                                  <A
                                    href={`/requests/${ord.requestCode}`}
                                    class="font-semibold text-slate-900 hover:text-red-600"
                                  >
                                    {ord.title}
                                  </A>
                                  <div class="text-xs text-slate-500">{ord.chosenOptionLabel}</div>
                                  <div class="flex flex-wrap gap-1.5 mt-1">
                                    <Show when={ord.carSystem}>
                                      <span class="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                                        {ord.carSystem}
                                      </span>
                                    </Show>
                                    <Show when={age() > 21}>
                                      <span class="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
                                        <Clock class="h-3 w-3" />
                                        {age()}d awaiting invoice
                                      </span>
                                    </Show>
                                  </div>
                                </td>
                                <td class="px-4 py-3">
                                  <DepartmentBadge department={ord.department} />
                                </td>
                                <td class="px-4 py-3 text-right text-xs tabular-nums text-slate-500">
                                  {formatEur(ord.basePriceCents)} +{" "}
                                  {formatEur(ord.shippingCents + ord.importFeeCents)}
                                </td>
                                <td class="px-4 py-3 text-right tabular-nums font-bold text-orange-700">
                                  {formatEur(ord.provisionalTotalCents)}
                                </td>
                                <td class="px-4 py-3">
                                  <div class="flex flex-wrap items-center gap-2">
                                    <A
                                      href={`/requests/${ord.requestCode}`}
                                      class="text-xs font-semibold text-red-600 hover:underline"
                                    >
                                      Open Order
                                    </A>
                                    <Show when={isMaster(app.user()?.role)}>
                                      <A
                                        href={`/requests/${ord.requestCode}?masterEdit=1`}
                                        class="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                                      >
                                        <ShieldAlert class="h-3 w-3" />
                                        Edit
                                      </A>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setDeleteTarget({
                                            kind: "request",
                                            id: ord.id,
                                            code: ord.requestCode,
                                            title: ord.title,
                                            statusLabel: "Order (Provisional)",
                                            attachmentCount: ord.attachments.length
                                          })
                                        }
                                        class="inline-flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 cursor-pointer"
                                      >
                                        <Trash2 class="h-3 w-3" />
                                        Delete
                                      </button>
                                    </Show>
                                  </div>
                                </td>
                              </tr>
                            );
                          }}
                        </For>
                      </Show>
                    </tbody>
                  </table>
                </div>
              </div>
            </Match>

            {/* 6. Provisional entries */}
            <Match when={activeTab() === "provisional_entries"}>
              <div class="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
                <div class="p-4 border-b border-slate-100 space-y-3">
                  <div class="flex items-center justify-between">
                    <h2 class="text-base font-bold text-slate-900">
                      Provisional Entries ({filteredProvisionalEntries().length})
                    </h2>
                    <span class="font-extrabold tabular-nums text-amber-700">
                      {formatEur(
                        filteredProvisionalEntries().reduce(
                          (sum, e) => sum + e.initialAmountCents,
                          0
                        )
                      )}
                    </span>
                  </div>
                  <div class="flex flex-col sm:flex-row gap-2.5">
                    <SearchInputBar
                      value={entrySearch()}
                      onInput={setEntrySearch}
                      placeholder="Search provisional entries by ID, title, or note..."
                      class="flex-1"
                    />
                    <select
                      value={entryCategoryFilter()}
                      onChange={e =>
                        setEntryCategoryFilter(e.currentTarget.value as EntryCategory | "all")
                      }
                      class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    >
                      <option value="all">All Categories</option>
                      <For each={ENTRY_CATEGORIES}>
                        {c => <option value={c.id}>{c.label}</option>}
                      </For>
                    </select>
                    <select
                      value={entrySort()}
                      onChange={e => setEntrySort(e.currentTarget.value as SortMode)}
                      class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    >
                      <option value="date_desc">Date: Newest</option>
                      <option value="amount_desc">Amount: High → Low</option>
                      <option value="amount_asc">Amount: Low → High</option>
                      <option value="code_asc">ID: A → Z</option>
                    </select>
                  </div>
                </div>
                <div class="divide-y divide-slate-100">
                  <For each={filteredProvisionalEntries()}>
                    {entry => {
                      const isOverdue = () => entry.entryDate < todayIso;
                      return (
                        <div class="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                          <div class="space-y-1">
                            <div class="flex flex-wrap items-center gap-2">
                              <span class="font-mono text-xs font-bold text-slate-700">
                                {entry.entryCode}
                              </span>
                              <CategoryBadge category={entry.category} />
                              <EntryStatusBadge status={entry.status} />
                              <span class="text-xs text-slate-400">
                                {formatDate(entry.entryDate)}
                              </span>
                              <Show when={isOverdue()}>
                                <span class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                                  <Clock class="h-3 w-3" />
                                  Overdue expected receipt
                                </span>
                              </Show>
                            </div>
                            <div class="font-bold text-slate-900">{entry.title}</div>
                            <p class="text-xs text-slate-600">{entry.comment}</p>
                          </div>

                          <div class="flex flex-wrap items-center gap-2 shrink-0">
                            <span class="text-lg font-extrabold tabular-nums text-amber-700 mr-1">
                              {formatEur(entry.initialAmountCents)}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setItemLogEntryTarget({
                                  id: entry.id,
                                  entryCode: entry.entryCode,
                                  title: entry.title
                                })
                              }
                              class="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                            >
                              <History class="h-3.5 w-3.5" />
                              Log
                            </button>
                            <Show when={canWriteBudget()}>
                              <button
                                type="button"
                                onClick={() => setEditTarget(entry)}
                                class="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                              >
                                <Edit3 class="h-3.5 w-3.5" />
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmTarget(entry)}
                                class="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 cursor-pointer"
                              >
                                <CheckCircle2 class="h-3.5 w-3.5" />
                                Upload Invoice &amp; Confirm
                              </button>
                              <form action={cancelEntryAction} method="post">
                                <input type="hidden" name="entryId" value={entry.id} />
                                <input
                                  type="hidden"
                                  name="reason"
                                  value="Cancelled provisional entry"
                                />
                                <button
                                  type="submit"
                                  disabled={cancelEntrySub.pending}
                                  class="rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </form>
                            </Show>
                            <Show when={isMaster(app.user()?.role)}>
                              <button
                                type="button"
                                onClick={() => setMasterEditEntryTarget(entry)}
                                class="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
                              >
                                <ShieldAlert class="h-3.5 w-3.5" />
                                Master Edit
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setDeleteTarget({
                                    kind: "entry",
                                    id: entry.id,
                                    code: entry.entryCode,
                                    title: entry.title,
                                    statusLabel: ENTRY_STATUS_LABELS[entry.status],
                                    attachmentCount: entry.attachments.length
                                  })
                                }
                                class="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 cursor-pointer"
                              >
                                <Trash2 class="h-3.5 w-3.5" />
                                Delete
                              </button>
                            </Show>
                          </div>
                        </div>
                      );
                    }}
                  </For>
                  <Show when={filteredProvisionalEntries().length === 0}>
                    <div class="p-10 text-center text-sm text-slate-400">
                      No provisional entries match your current filter.
                    </div>
                  </Show>
                </div>
              </div>
            </Match>

            {/* 7. All Entries */}
            <Match when={activeTab() === "all_entries"}>
              <div class="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
                <div class="p-4 border-b border-slate-100 space-y-3">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <h2 class="text-base font-bold text-slate-900">
                      All Money Entries ({filteredAllEntries().length} of {data().entries.length})
                    </h2>
                    <span class="text-sm font-bold tabular-nums text-emerald-700">
                      Shown total:{" "}
                      {formatEur(
                        filteredAllEntries()
                          .filter(e => e.status !== "cancelled")
                          .reduce((sum, e) => sum + e.effectiveAmountCents, 0)
                      )}
                    </span>
                  </div>
                  <div class="flex flex-col sm:flex-row gap-2.5">
                    <SearchInputBar
                      value={entrySearch()}
                      onInput={setEntrySearch}
                      placeholder="Search entries by ID, entity, comment, or author..."
                      class="flex-1"
                    />
                    <select
                      value={entryCategoryFilter()}
                      onChange={e =>
                        setEntryCategoryFilter(e.currentTarget.value as EntryCategory | "all")
                      }
                      class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    >
                      <option value="all">All Categories</option>
                      <For each={ENTRY_CATEGORIES}>
                        {c => <option value={c.id}>{c.label}</option>}
                      </For>
                    </select>
                    <select
                      value={entryStatusFilter()}
                      onChange={e =>
                        setEntryStatusFilter(e.currentTarget.value as EntryStatus | "all")
                      }
                      class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    >
                      <option value="all">All Statuses</option>
                      <option value="confirmed">Confirmed</option>
                      <option value="provisional">Provisional</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                    <select
                      value={entrySort()}
                      onChange={e => setEntrySort(e.currentTarget.value as SortMode)}
                      class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    >
                      <option value="date_desc">Date: Newest</option>
                      <option value="amount_desc">Amount: High → Low</option>
                      <option value="amount_asc">Amount: Low → High</option>
                      <option value="code_asc">ID: A → Z</option>
                    </select>
                  </div>
                </div>

                <div class="divide-y divide-slate-100">
                  <For each={filteredAllEntries()}>
                    {entry => (
                      <div class="p-4 flex flex-col md:flex-row md:items-start justify-between gap-4">
                        <div class="space-y-1.5">
                          <div class="flex flex-wrap items-center gap-2">
                            <span class="font-mono text-xs font-bold text-slate-700">
                              {entry.entryCode}
                            </span>
                            <CategoryBadge category={entry.category} />
                            <EntryStatusBadge status={entry.status} />
                            <span class="text-xs text-slate-400">
                              Date: {formatDate(entry.entryDate)}
                            </span>
                            <Show when={entry.status === "provisional" && entry.entryDate < todayIso}>
                              <span class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                                Overdue
                              </span>
                            </Show>
                          </div>
                          <div class="font-bold text-slate-900">{entry.title}</div>
                          <p class="text-xs text-slate-600 whitespace-pre-wrap">{entry.comment}</p>
                          <div class="flex flex-wrap gap-2 pt-1">
                            <For each={entry.attachments}>
                              {att => (
                                <a
                                  href={`/api/files/${att.id}`}
                                  class="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                                >
                                  <FileText class="h-3 w-3" />
                                  {att.kind === "invoice" ? "Invoice: " : ""}
                                  {att.originalName}
                                </a>
                              )}
                            </For>
                          </div>
                        </div>
                        <div class="flex flex-col items-end gap-1.5 shrink-0">
                          <div class="text-lg font-extrabold tabular-nums text-slate-900">
                            {formatEur(entry.effectiveAmountCents)}
                          </div>
                          <div class="text-[11px] text-slate-400">By {entry.creatorName}</div>
                          <div class="flex flex-wrap justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                setItemLogEntryTarget({
                                  id: entry.id,
                                  entryCode: entry.entryCode,
                                  title: entry.title
                                })
                              }
                              class="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                            >
                              <History class="h-3 w-3" />
                              Item Log
                            </button>
                            <Show when={entry.status === "provisional" && canWriteBudget()}>
                              <button
                                type="button"
                                onClick={() => setEditTarget(entry)}
                                class="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                              >
                                <Edit3 class="h-3 w-3" />
                                Edit Entry
                              </button>
                            </Show>
                            <Show when={isMaster(app.user()?.role)}>
                              <button
                                type="button"
                                onClick={() => setMasterEditEntryTarget(entry)}
                                class="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
                              >
                                <ShieldAlert class="h-3 w-3" />
                                Master Edit
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setDeleteTarget({
                                    kind: "entry",
                                    id: entry.id,
                                    code: entry.entryCode,
                                    title: entry.title,
                                    statusLabel: ENTRY_STATUS_LABELS[entry.status],
                                    attachmentCount: entry.attachments.length
                                  })
                                }
                                class="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 cursor-pointer"
                              >
                                <Trash2 class="h-3 w-3" />
                                Delete
                              </button>
                            </Show>
                          </div>
                        </div>
                      </div>
                    )}
                  </For>
                  <Show when={filteredAllEntries().length === 0}>
                    <div class="p-10 text-center text-sm text-slate-400">
                      No money entries match your current filter.
                    </div>
                  </Show>
                </div>
              </div>
            </Match>

            {/* 8. Entries by category */}
            <Match when={activeTab() === "entries_by_category"}>
              <div class="space-y-6">
                <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
                  <h2 class="text-base font-bold text-slate-900 mb-4">Money Entries by Category</h2>
                  <CategoryEntryChart rows={data().analytics.byCategory} />
                </div>

                <div class="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
                  <div class="overflow-x-auto">
                    <table class="w-full text-left text-sm">
                      <thead class="bg-slate-50 border-b border-slate-200 text-xs font-semibold uppercase text-slate-500">
                        <tr>
                          <th class="px-4 py-3">Category</th>
                          <th class="px-4 py-3 text-right">Confirmed</th>
                          <th class="px-4 py-3 text-right">Provisional</th>
                          <th class="px-4 py-3 text-right">Projected Total</th>
                          <th class="px-4 py-3 text-right">Share Confirmed</th>
                          <th class="px-4 py-3 text-right">Confirmed #</th>
                          <th class="px-4 py-3 text-right">Provisional #</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-slate-100">
                        <For each={data().analytics.byCategory}>
                          {row => (
                            <tr>
                              <td class="px-4 py-3">
                                <CategoryBadge category={row.category} />
                              </td>
                              <td class="px-4 py-3 text-right tabular-nums font-bold text-emerald-700">
                                {formatEur(row.confirmedCents)}
                              </td>
                              <td class="px-4 py-3 text-right tabular-nums text-amber-700">
                                {formatEur(row.provisionalCents)}
                              </td>
                              <td class="px-4 py-3 text-right tabular-nums font-semibold">
                                {formatEur(row.totalProjectedCents)}
                              </td>
                              <td class="px-4 py-3 text-right tabular-nums text-slate-500">
                                {row.shareOfConfirmedPct}%
                              </td>
                              <td class="px-4 py-3 text-right tabular-nums">{row.confirmedCount}</td>
                              <td class="px-4 py-3 text-right tabular-nums">{row.provisionalCount}</td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </Match>

            {/* 9. Total money left + input vs output rate */}
            <Match when={activeTab() === "cashflow_rates"}>
              <div class="space-y-6">
                <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
                    <div class="text-xs font-semibold uppercase text-slate-400">
                      Actual Cash Left
                    </div>
                    <div class="mt-1.5 text-2xl font-extrabold tabular-nums text-slate-900">
                      {formatEur(data().analytics.actualCashLeftCents)}
                    </div>
                    <div class="text-xs text-slate-500 mt-0.5">
                      Runway:{" "}
                      {data().analytics.rates.runwayPeriods !== null
                        ? `${data().analytics.rates.runwayPeriods} ${periodUnit()}(s)`
                        : "Surplus / No outflow"}
                    </div>
                  </div>
                  <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
                    <div class="text-xs font-semibold uppercase text-slate-400">
                      Projected Balance
                    </div>
                    <div
                      class={`mt-1.5 text-2xl font-extrabold tabular-nums ${
                        data().analytics.projectedBalanceCents < 0 ? "text-rose-700" : "text-sky-700"
                      }`}
                    >
                      {formatEur(data().analytics.projectedBalanceCents)}
                    </div>
                    <div class="text-xs text-slate-500 mt-0.5">
                      After provisional orders &amp; entries
                    </div>
                  </div>
                  <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
                    <div class="text-xs font-semibold uppercase text-slate-400">
                      Avg Input Rate / {periodUnit()}
                    </div>
                    <div class="mt-1.5 text-xl font-extrabold tabular-nums text-emerald-700">
                      +{formatEur(data().analytics.rates.actualInputPerPeriodCents)}
                    </div>
                    <div class="text-xs text-slate-500 mt-0.5">
                      Projected: +{formatEur(data().analytics.rates.projectedInputPerPeriodCents)}
                    </div>
                  </div>
                  <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
                    <div class="text-xs font-semibold uppercase text-slate-400">
                      Avg Output Rate / {periodUnit()}
                    </div>
                    <div class="mt-1.5 text-xl font-extrabold tabular-nums text-red-600">
                      -{formatEur(data().analytics.rates.actualOutputPerPeriodCents)}
                    </div>
                    <div class="text-xs text-slate-500 mt-0.5">
                      In/Out Ratio:{" "}
                      {data().analytics.rates.actualInputOutputRatio !== null
                        ? `${data().analytics.rates.actualInputOutputRatio}x`
                        : "∞"}
                    </div>
                  </div>
                </div>

                <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
                  <h2 class="text-base font-bold text-slate-900 mb-4">
                    Cumulative Cash Balance Curve ({periodUnit()}ly)
                  </h2>
                  <BalanceCurveChart
                    buckets={data().analytics.timeSeries}
                    openingBalanceCents={data().analytics.openingBalanceCents}
                  />
                </div>

                <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
                  <h2 class="text-base font-bold text-slate-900 mb-4">
                    Input vs Output Rate ({periodUnit()}ly over {data().analytics.rates.periodCount} period(s))
                  </h2>
                  <CashflowBarsChart buckets={data().analytics.timeSeries} mode="in_out" />
                </div>

                <div class="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
                  <div class="overflow-x-auto">
                    <table class="w-full text-left text-sm">
                      <thead class="bg-slate-50 border-b border-slate-200 text-xs font-semibold uppercase text-slate-500">
                        <tr>
                          <th class="px-4 py-3">Period</th>
                          <th class="px-4 py-3 text-right">Confirmed Inflow</th>
                          <th class="px-4 py-3 text-right">Final Outflow</th>
                          <th class="px-4 py-3 text-right">Net Actual</th>
                          <th class="px-4 py-3 text-right">Cumulative Actual Left</th>
                          <th class="px-4 py-3 text-right">Cumulative Projected</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-slate-100">
                        <For each={data().analytics.timeSeries}>
                          {row => (
                            <tr>
                              <td class="px-4 py-3 font-medium text-slate-800">{row.label}</td>
                              <td class="px-4 py-3 text-right tabular-nums text-emerald-700 font-semibold">
                                +{formatEur(row.confirmedEntriesCents)}
                              </td>
                              <td class="px-4 py-3 text-right tabular-nums text-red-600 font-semibold">
                                -{formatEur(row.finalSpendingsCents)}
                              </td>
                              <td class="px-4 py-3 text-right tabular-nums font-medium">
                                {formatEur(row.netActualCents)}
                              </td>
                              <td class="px-4 py-3 text-right tabular-nums font-bold text-slate-900">
                                {formatEur(row.cumulativeActualBalanceCents)}
                              </td>
                              <td class="px-4 py-3 text-right tabular-nums text-sky-700 font-semibold">
                                {formatEur(row.cumulativeProjectedBalanceCents)}
                              </td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </Match>
          </Switch>
        )}
      </Show>

      {/* Modals */}
      <LogMoneyEntryModal
        open={newEntryOpen()}
        onClose={() => setNewEntryOpen(false)}
        onSuccess={refreshBudget}
      />

      <ConfirmProvisionalEntryModal
        target={confirmTarget()}
        onClose={() => setConfirmTarget(null)}
        onSuccess={refreshBudget}
      />

      <EditProvisionalEntryModal
        target={editTarget()}
        onClose={() => setEditTarget(null)}
        onSuccess={refreshBudget}
      />

      <MasterEditEntryModal
        target={masterEditEntryTarget()}
        seasons={app.seasons()}
        users={masterUsers() ?? []}
        onClose={() => setMasterEditEntryTarget(null)}
        onSuccess={refreshBudget}
      />

      <EntryItemLogModal
        entry={itemLogEntryTarget()}
        onClose={() => setItemLogEntryTarget(null)}
      />

      <MasterDeleteConfirmModal
        target={deleteTarget()}
        onClose={() => setDeleteTarget(null)}
        onDeleted={refreshBudget}
      />

      <Show when={snapshot()}>
        {data => (
          <DepartmentBudgetsModal
            open={budgetsModalOpen()}
            seasonId={data().season.id}
            seasonName={data().season.name}
            currentAllocations={data().departmentAllocations}
            onClose={() => setBudgetsModalOpen(false)}
            onSuccess={refreshBudget}
          />
        )}
      </Show>
    </div>
  );
}
