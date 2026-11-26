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
import { For, Match, Show, Suspense, Switch, createMemo, createSignal } from "solid-js";
import { useApp, useI18n } from "~/components/AppContext";
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
import { buildFinancialStatement } from "~/lib/financial-statement";
import {
  BUDGET_SECTIONS,
  DEPARTMENTS,
  ENTRY_CATEGORIES,
  RATE_PERIODS,
  type BudgetSectionId,
  type DepartmentId,
  type EntryCategory,
  type EntryStatus,
  type RatePeriod
} from "~/lib/constants";
import { formatDate, formatEur, toIsoDateInput } from "~/lib/format";
import {
  formatCarSystemDisplay,
  formatTimeBucketLabel,
  getBudgetGroupLabel,
  getBudgetSectionLabel,
  getDepartmentLabel,
  getEntryCategoryLabel,
  getEntryStatusLabel,
  getRatePeriodLabel,
  getRequestStatusLabel,
  getSeasonStatusLabel
} from "~/lib/i18n";
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
  const { locale, t } = useI18n();
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

  const activeSnapshot = () => snapshot.latest ?? snapshot();

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
    const data = activeSnapshot();
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
    const data = activeSnapshot();
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
    const data = activeSnapshot();
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
    const data = activeSnapshot();
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

  const tabClusters: Array<{
    group: "Overview" | "Spendings" | "Entries" | "Cashflow";
    ids: BudgetSectionId[];
  }> = [
    { group: "Overview", ids: ["summary", "financial_statement"] },
    {
      group: "Spendings",
      ids: ["by_department", "by_timeframe", "all_spendings", "provisional_spendings"]
    },
    { group: "Entries", ids: ["provisional_entries", "all_entries", "entries_by_category"] },
    { group: "Cashflow", ids: ["cashflow_rates"] }
  ];

  const [stmtConfirmedOnly, setStmtConfirmedOnly] = createSignal(false);

  const sectionNum = new Map<BudgetSectionId, number>(
    BUDGET_SECTIONS.map((s, idx) => [s.id, idx + 1])
  );

  return (
    <div class="space-y-5">
      <Title>{t().budget.pageTitle} — {t().appName}</Title>

      {/* Top Header & Actions */}
      <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold text-slate-900 dark:text-slate-100">{t().budget.heading}</h1>
          <p class="text-sm text-slate-500 dark:text-slate-400">
            {t().budget.subtitle}
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2.5">
          <Show when={canExportBudget(app.user()?.role)}>
            <A
              href={exportUrl()}
              class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <Download class="h-4 w-4" />
              {t().budget.exportBtn}
            </A>
          </Show>
          <Show when={canWriteBudget()}>
            <button
              type="button"
              onClick={() => setBudgetsModalOpen(true)}
              class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <SlidersHorizontal class="h-4 w-4" />
              {t().budget.deptEnvelopesBtn}
            </button>
            <button
              type="button"
              onClick={() => setNewEntryOpen(true)}
              class="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 cursor-pointer"
            >
              <PlusCircle class="h-4 w-4" />
              {t().budget.logEntryBtn}
            </button>
          </Show>
        </div>
      </div>

      {/* Period, Date Range & Quick Presets Bar */}
      <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs flex flex-wrap items-end justify-between gap-4">
        <div class="flex flex-wrap items-end gap-3">
          <div>
            <label class="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1">
              {t().budget.ratePeriodLabel}
            </label>
            <select
              value={periodUnit()}
              onChange={e => setSearchParams({ period: e.currentTarget.value as RatePeriod })}
              class="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-1.5 text-sm font-medium text-slate-800 dark:text-slate-100 focus:border-red-500 focus:outline-none"
            >
              <For each={RATE_PERIODS}>
                {p => (
                  <option value={p}>
                    {getRatePeriodLabel(locale(), p, "adj")}
                  </option>
                )}
              </For>
            </select>
          </div>

          <div>
            <label class="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1">
              {t().budget.fromDateLabel}
            </label>
            <input
              type="date"
              value={fromDate()}
              onInput={e => setSearchParams({ from: e.currentTarget.value || undefined })}
              class="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:border-red-500 focus:outline-none"
            />
          </div>

          <div>
            <label class="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1">
              {t().budget.toDateLabel}
            </label>
            <input
              type="date"
              value={toDate()}
              onInput={e => setSearchParams({ to: e.currentTarget.value || undefined })}
              class="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:border-red-500 focus:outline-none"
            />
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-1.5">
          <span class="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mr-1">
            {t().budget.presetsLabel}
          </span>
          <button
            type="button"
            onClick={() => applyPreset("this_month")}
            class="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
          >
            {t().budget.presetThisMonth}
          </button>
          <button
            type="button"
            onClick={() => applyPreset("last_30")}
            class="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
          >
            {t().budget.presetLast30}
          </button>
          <button
            type="button"
            onClick={() => applyPreset("last_90")}
            class="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
          >
            {t().budget.presetLast90}
          </button>
          <button
            type="button"
            onClick={() => applyPreset("season")}
            class={`rounded-lg border px-2.5 py-1 text-xs font-medium cursor-pointer ${
              !fromDate() && !toDate()
                ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-950"
                : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
            }`}
          >
            {t().budget.presetFullSeason}
          </button>
        </div>
      </div>

      {/* Persistent Financial Strip + Solvency Alert */}
      <Suspense>
        <Show when={activeSnapshot()}>
          {data => (
          <div class="space-y-3">
            <div class="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <div class="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 shadow-xs">
                <div class="text-[11px] font-semibold uppercase text-slate-400 dark:text-slate-500">
                  {t().budget.stripActualLeft}
                </div>
                <div
                  class={`mt-0.5 text-lg font-extrabold tabular-nums ${
                    data().analytics.actualCashLeftCents < 0 ? "text-rose-700 dark:text-rose-400" : "text-slate-900 dark:text-slate-100"
                  }`}
                >
                  {formatEur(data().analytics.actualCashLeftCents, locale())}
                </div>
              </div>
              <div class="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 shadow-xs">
                <div class="text-[11px] font-semibold uppercase text-slate-400 dark:text-slate-500">
                  {t().budget.stripProjectedBalance}
                </div>
                <div
                  class={`mt-0.5 text-lg font-extrabold tabular-nums ${
                    data().analytics.projectedBalanceCents < 0 ? "text-rose-700 dark:text-rose-400" : "text-sky-700 dark:text-sky-400"
                  }`}
                >
                  {formatEur(data().analytics.projectedBalanceCents, locale())}
                </div>
              </div>
              <div class="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 shadow-xs">
                <div class="text-[11px] font-semibold uppercase text-slate-400 dark:text-slate-500">
                  {t().budget.stripInflowsConfirmed}
                </div>
                <div class="mt-0.5 text-lg font-extrabold tabular-nums text-emerald-700 dark:text-emerald-400">
                  {formatEur(data().analytics.confirmedEntriesCents, locale())}
                  <Show when={data().analytics.provisionalEntriesCents > 0}>
                    <span class="text-xs font-semibold text-amber-600 dark:text-amber-400">
                      {" "}+{formatEur(data().analytics.provisionalEntriesCents, locale())}
                    </span>
                  </Show>
                </div>
              </div>
              <div class="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 shadow-xs">
                <div class="text-[11px] font-semibold uppercase text-slate-400 dark:text-slate-500">
                  {t().budget.stripOutflowsFinal}
                </div>
                <div class="mt-0.5 text-lg font-extrabold tabular-nums text-slate-900 dark:text-slate-100">
                  {formatEur(data().analytics.finalSpendingsCents, locale())}
                  <Show when={data().analytics.provisionalSpendingsCents > 0}>
                    <span class="text-xs font-semibold text-orange-600 dark:text-orange-400">
                      {" "}+{formatEur(data().analytics.provisionalSpendingsCents, locale())}
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
              <div class="rounded-xl border border-rose-300 dark:border-rose-800/80 bg-rose-50 dark:bg-rose-950/60 px-4 py-3 flex items-start gap-3 text-xs text-rose-900 dark:text-rose-200">
                <AlertTriangle class="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <strong>{t().budget.liquidityWarningTitle}</strong>{" "}
                  <Show
                    when={data().analytics.actualCashLeftCents < 0}
                    fallback={
                      <>
                        {t().budget.liquidityNegativeProjected(
                          formatEur(data().analytics.projectedBalanceCents, locale()),
                          data().analytics.counts.activeOrders,
                          data().analytics.counts.provisionalEntries
                        )}
                      </>
                    }
                  >
                    {t().budget.liquidityNegativeCash(
                      formatEur(data().analytics.actualCashLeftCents, locale())
                    )}
                  </Show>
                </div>
              </div>
            </Show>
          </div>
        )}
        </Show>
      </Suspense>

      {/* Grouped 9-Section Navigation */}
      <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 shadow-xs space-y-2">
        <div class="flex flex-wrap gap-3">
          <For each={tabClusters}>
            {cluster => (
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-1">
                  {getBudgetGroupLabel(locale(), cluster.group)}
                </span>
                <For each={cluster.ids}>
                  {id => (
                    <button
                      type="button"
                      onClick={() => setSearchParams({ tab: id })}
                      class={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                        activeTab() === id
                          ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950 shadow-xs"
                          : "bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                      }`}
                    >
                      {sectionNum.get(id)}. {getBudgetSectionLabel(locale(), id)}
                    </button>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </div>

      {/* Active Section View */}
      <Suspense
        fallback={
          <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center text-sm text-slate-400 dark:text-slate-500">
            {t().budget.calculating}
          </div>
        }
      >
        <Show
          when={activeSnapshot()}
          fallback={
            <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center text-sm text-slate-400 dark:text-slate-500">
              {t().budget.calculating}
            </div>
          }
        >
        {data => (
          <Switch>
            {/* 1. Dashboard and summary */}
            <Match when={activeTab() === "summary"}>
              <div class="space-y-6">
                <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs">
                    <div class="text-xs font-semibold uppercase text-slate-400 dark:text-slate-500">
                      {t().budget.summary.openingBalance}
                    </div>
                    <div class="mt-1.5 text-xl font-extrabold tabular-nums text-slate-900 dark:text-slate-100">
                      {formatEur(data().analytics.openingBalanceCents, locale())}
                    </div>
                    <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {data().analytics.totalAllocatedCents > 0
                        ? t().budget.summary.deptEnvelopesSum(
                            formatEur(data().analytics.totalAllocatedCents, locale())
                          )
                        : t().budget.summary.noDeptCaps}
                    </div>
                  </div>
                  <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs">
                    <div class="text-xs font-semibold uppercase text-slate-400 dark:text-slate-500">
                      {t().budget.summary.requestPipeline}
                    </div>
                    <div class="mt-1.5 text-xl font-extrabold tabular-nums text-slate-900 dark:text-slate-100">
                      {data().analytics.counts.pendingReview +
                        data().analytics.counts.counterProposed +
                        data().analytics.counts.optionSelection}{" "}
                      <span class="text-sm font-medium text-slate-500 dark:text-slate-400">
                        {t().budget.summary.openCountSuffix}
                      </span>
                    </div>
                    <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {t().budget.summary.pipelineSub(
                        data().analytics.counts.activeOrders,
                        data().analytics.counts.archivedRequests
                      )}
                    </div>
                  </div>
                  <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs">
                    <div class="text-xs font-semibold uppercase text-slate-400 dark:text-slate-500">
                      {t().budget.summary.invoiceVariance}
                    </div>
                    <div
                      class={`mt-1.5 text-xl font-extrabold tabular-nums ${
                        data().analytics.invoiceVarianceCents > 0
                          ? "text-rose-700 dark:text-rose-400"
                          : data().analytics.invoiceVarianceCents < 0
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-slate-900 dark:text-slate-100"
                      }`}
                    >
                      {data().analytics.invoiceVarianceCents > 0 ? "+" : ""}
                      {formatEur(data().analytics.invoiceVarianceCents, locale())}
                    </div>
                    <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {t().budget.summary.vsCommitted(
                        formatEur(data().analytics.committedTotalForSpendingsCents, locale())
                      )}
                    </div>
                  </div>
                  <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs">
                    <div class="text-xs font-semibold uppercase text-slate-400 dark:text-slate-500">
                      {t().budget.summary.seasonWindow}
                    </div>
                    <div class="mt-1.5 text-sm font-bold text-slate-900 dark:text-slate-100">
                      {formatDate(data().season.startDate, locale())} →{" "}
                      {formatDate(data().season.deadlineDate, locale())}
                    </div>
                    <div class="mt-1 text-xs text-slate-500 dark:text-slate-400 uppercase font-semibold">
                      {t().budget.summary.statusPrefix}{" "}
                      {getSeasonStatusLabel(locale(), data().season.status)}
                    </div>
                  </div>
                </div>

                <div class="grid gap-6 lg:grid-cols-2">
                  <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs">
                    <div class="flex items-center justify-between mb-4">
                      <h2 class="text-base font-bold text-slate-900 dark:text-slate-100">
                        {t().budget.summary.deptSnapshot}
                      </h2>
                      <span class="text-[11px] text-slate-400 dark:text-slate-500">
                        {t().budget.summary.clickBarHint}
                      </span>
                    </div>
                    <DepartmentSpendChart
                      rows={data().analytics.byDepartment}
                      onSelectDepartment={dept => drillDownToDepartment(dept, "all_spendings")}
                    />
                  </div>
                  <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs">
                    <h2 class="text-base font-bold text-slate-900 dark:text-slate-100 mb-4">
                      {t().budget.summary.inflowsByCategory}
                    </h2>
                    <CategoryEntryChart rows={data().analytics.byCategory} />
                  </div>
                </div>

                <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs">
                  <h2 class="text-base font-bold text-slate-900 dark:text-slate-100 mb-4">
                    {t().budget.summary.balanceCurveTitle(
                      getRatePeriodLabel(locale(), periodUnit(), "adj")
                    )}
                  </h2>
                  <BalanceCurveChart
                    buckets={data().analytics.timeSeries}
                    openingBalanceCents={data().analytics.openingBalanceCents}
                    periodUnit={periodUnit()}
                  />
                </div>
              </div>
            </Match>

            {/* 1b. Charges & Income Statement (External Accounting Bilan) */}
            <Match when={activeTab() === "financial_statement"}>
              {(() => {
                const stmt = createMemo(() =>
                  buildFinancialStatement({
                    seasonName: data().season.name,
                    startDate: data().season.startDate,
                    deadlineDate: data().season.deadlineDate,
                    openingBalanceCents: data().analytics.openingBalanceCents,
                    spendings: data().spendings,
                    provisionalSpendings: data().provisionalSpendings,
                    entries: data().entries,
                    locale: locale(),
                    confirmedOnly: stmtConfirmedOnly()
                  })
                );
                const statementExportHref = () => {
                  const params = new URLSearchParams();
                  if (app.selectedSeasonId()) params.set("season", app.selectedSeasonId());
                  params.set("period", periodUnit());
                  if (fromDate()) params.set("from", fromDate());
                  if (toDate()) params.set("to", toDate());
                  params.set("sections", "summary,financial_statement,by_department,entries_by_category");
                  return `/exports?${params.toString()}`;
                };

                return (
                  <div class="space-y-4">
                    <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-4">
                      <div class="flex flex-col md:flex-row md:items-center justify-between gap-3">
                        <div>
                          <h2 class="text-base font-bold text-slate-900 dark:text-slate-100">
                            {t().budget.financialStatement.title}
                          </h2>
                          <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {t().budget.financialStatement.subtitle}
                          </p>
                        </div>
                        <div class="flex flex-wrap items-center gap-2">
                          <div class="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-slate-950 text-xs">
                            <button
                              type="button"
                              onClick={() => setStmtConfirmedOnly(false)}
                              class={`rounded-md px-2.5 py-1 font-semibold cursor-pointer ${
                                !stmtConfirmedOnly()
                                  ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950"
                                  : "text-slate-600 dark:text-slate-400"
                              }`}
                            >
                              {t().budget.financialStatement.includeProvisionalLabel}
                            </button>
                            <button
                              type="button"
                              onClick={() => setStmtConfirmedOnly(true)}
                              class={`rounded-md px-2.5 py-1 font-semibold cursor-pointer ${
                                stmtConfirmedOnly()
                                  ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950"
                                  : "text-slate-600 dark:text-slate-400"
                              }`}
                            >
                              {t().budget.financialStatement.confirmedOnlyLabel}
                            </button>
                          </div>
                          <Show when={canExportBudget(app.user()?.role)}>
                            <A
                              href={statementExportHref()}
                              class="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700"
                            >
                              <Download class="h-3.5 w-3.5" />
                              {t().budget.financialStatement.exportThisBtn}
                            </A>
                          </Show>
                        </div>
                      </div>

                      <div class="overflow-x-auto rounded-lg border border-slate-900 dark:border-slate-600">
                        <table class="w-full border-collapse text-xs text-slate-950 dark:text-slate-100">
                          <thead>
                            <tr>
                              <th
                                colspan={6}
                                class="border-b border-slate-900 dark:border-slate-600 bg-[#2DB5C0] dark:bg-teal-800 px-3 py-2 text-center text-sm font-bold text-slate-950 dark:text-white"
                              >
                                {stmt().bannerTitle}
                              </th>
                            </tr>
                            <tr class="bg-slate-200 dark:bg-slate-800 font-bold">
                              <th
                                colspan={3}
                                class="border-b border-r-2 border-slate-900 dark:border-slate-600 px-3 py-1.5 text-left"
                              >
                                {stmt().chargesHeader}
                              </th>
                              <th
                                colspan={3}
                                class="border-b border-slate-900 dark:border-slate-600 px-3 py-1.5 text-left"
                              >
                                {stmt().produitsHeader}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            <For each={stmt().pairedRows}>
                              {pair => (
                                <tr>
                                  <Show when={pair.leftGroupSpan > 0 && pair.left}>
                                    <td
                                      rowspan={pair.leftGroupSpan}
                                      class="border border-slate-900 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-center font-medium align-middle w-[14%]"
                                    >
                                      {pair.left?.groupLabel}
                                    </td>
                                  </Show>
                                  <td class="border border-slate-900 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 w-[22%]">
                                    {pair.left?.label ?? ""}
                                  </td>
                                  <td class="border border-r-2 border-slate-900 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-right tabular-nums w-[14%]">
                                    {pair.left && !pair.left.isBlankPadding
                                      ? formatEur(pair.left.totalCents, locale())
                                      : ""}
                                  </td>

                                  <Show when={pair.rightGroupSpan > 0 && pair.right}>
                                    <td
                                      rowspan={pair.rightGroupSpan}
                                      class="border border-slate-900 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-center font-medium align-middle w-[16%]"
                                    >
                                      {pair.right?.groupLabel}
                                    </td>
                                  </Show>
                                  <td
                                    class={`border border-slate-900 dark:border-slate-700 px-2.5 py-1.5 w-[22%] ${
                                      pair.right?.highlight && !pair.right.isBlankPadding
                                        ? "bg-[#FFF2CC] dark:bg-amber-950/45"
                                        : "bg-white dark:bg-slate-900"
                                    }`}
                                  >
                                    {pair.right?.label ?? ""}
                                  </td>
                                  <td class="border border-slate-900 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-right tabular-nums w-[12%]">
                                    {pair.right && !pair.right.isBlankPadding
                                      ? formatEur(pair.right.totalCents, locale())
                                      : ""}
                                  </td>
                                </tr>
                              )}
                            </For>
                            <tr class="bg-slate-50 dark:bg-slate-800/80 font-bold">
                              <td
                                colspan={2}
                                class="border-t-2 border-slate-900 dark:border-slate-600 px-2.5 py-2 text-right"
                              >
                                {stmt().totalLabel}
                              </td>
                              <td class="border-t-2 border-l border-r-2 border-slate-900 dark:border-slate-600 px-2.5 py-2 text-right tabular-nums">
                                {formatEur(stmt().totalChargesCents, locale())}
                              </td>
                              <td
                                colspan={2}
                                class="border-t-2 border-slate-900 dark:border-slate-600 px-2.5 py-2 text-right"
                              >
                                {stmt().totalLabel}
                              </td>
                              <td class="border-t-2 border-l border-slate-900 dark:border-slate-600 px-2.5 py-2 text-right tabular-nums">
                                {formatEur(stmt().totalProduitsCents, locale())}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      <div class="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3.5 text-xs text-slate-600 dark:text-slate-300 space-y-1">
                        <div class="font-semibold text-slate-900 dark:text-slate-100">
                          {t().budget.financialStatement.reconciliationPrefix}{" "}
                          <span class="tabular-nums">
                            {formatEur(
                              stmt().totalProduitsCents - stmt().totalChargesCents,
                              locale()
                            )}
                          </span>
                        </div>
                        <div>
                          {t().budget.financialStatement.cashReconciliation(
                            formatEur(stmt().openingBalanceCents, locale()),
                            formatEur(stmt().actualCashBalanceCents, locale()),
                            formatEur(stmt().projectedCashBalanceCents, locale())
                          )}
                        </div>
                        <div class="text-[11px] text-slate-500 dark:text-slate-400">
                          {t().budget.financialStatement.mappingNote}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </Match>

            {/* 2. Dashboard and spendings by department */}
            <Match when={activeTab() === "by_department"}>
              <div class="space-y-6">
                <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs">
                  <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
                    <h2 class="text-base font-bold text-slate-900 dark:text-slate-100">
                      {t().budget.byDepartment.comparisonTitle}
                    </h2>
                    <Show when={canWriteBudget()}>
                      <button
                        type="button"
                        onClick={() => setBudgetsModalOpen(true)}
                        class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
                      >
                        <SlidersHorizontal class="h-3.5 w-3.5" />
                        {t().budget.byDepartment.editEnvelopesBtn}
                      </button>
                    </Show>
                  </div>
                  <DepartmentSpendChart
                    rows={data().analytics.byDepartment}
                    onSelectDepartment={dept => drillDownToDepartment(dept, "all_spendings")}
                  />
                </div>

                <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
                  <div class="overflow-x-auto">
                    <table class="w-full text-left text-sm">
                      <thead class="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                        <tr>
                          <th class="px-4 py-3">{t().budget.byDepartment.colDeptSubsystems}</th>
                          <th class="px-4 py-3 text-right">{t().budget.byDepartment.colAllocated}</th>
                          <th class="px-4 py-3 text-right">{t().budget.byDepartment.colFinal}</th>
                          <th class="px-4 py-3 text-right">{t().budget.byDepartment.colProvisional}</th>
                          <th class="px-4 py-3 text-right">{t().budget.byDepartment.colProjectedTotal}</th>
                          <th class="px-4 py-3 text-right">{t().budget.byDepartment.colRemaining}</th>
                          <th class="px-4 py-3">{t().budget.byDepartment.colUtilization}</th>
                          <th class="px-4 py-3 text-right">{t().budget.byDepartment.colCounts}</th>
                          <th class="px-4 py-3 text-right">{t().budget.byDepartment.colDrilldown}</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                        <For each={data().analytics.byDepartment}>
                          {row => {
                            const isOpen = () => expandedDepts().includes(row.department);
                            const utilStatus = () =>
                              getBudgetUtilizationStatus(row.utilizationProjectedPct);
                            return (
                              <>
                                <tr class="hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                                  <td class="px-4 py-3">
                                    <div class="flex items-center gap-2">
                                      <Show
                                        when={row.carSystems.length > 0}
                                        fallback={<span class="w-4" />}
                                      >
                                        <button
                                          type="button"
                                          onClick={() => toggleDeptExpand(row.department)}
                                          title={t().budget.byDepartment.expandTooltip}
                                          class="rounded p-0.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
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
                                  <td class="px-4 py-3 text-right tabular-nums text-slate-600 dark:text-slate-400">
                                    {row.allocatedCents !== null
                                      ? formatEur(row.allocatedCents, locale())
                                      : "—"}
                                  </td>
                                  <td class="px-4 py-3 text-right tabular-nums font-bold text-slate-900 dark:text-slate-100">
                                    {formatEur(row.finalSpendingsCents, locale())}
                                  </td>
                                  <td class="px-4 py-3 text-right tabular-nums text-orange-700 dark:text-orange-400">
                                    {formatEur(row.provisionalSpendingsCents, locale())}
                                  </td>
                                  <td class="px-4 py-3 text-right tabular-nums font-semibold text-slate-800 dark:text-slate-200">
                                    {formatEur(row.totalProjectedCents, locale())}
                                  </td>
                                  <td
                                    class={`px-4 py-3 text-right tabular-nums font-semibold ${
                                      row.remainingProjectedCents !== null &&
                                      row.remainingProjectedCents < 0
                                        ? "text-rose-700 dark:text-rose-400"
                                        : "text-emerald-700 dark:text-emerald-400"
                                    }`}
                                  >
                                    {row.remainingProjectedCents !== null
                                      ? formatEur(row.remainingProjectedCents, locale())
                                      : "—"}
                                  </td>
                                  <td class="px-4 py-3">
                                    <Show
                                      when={row.utilizationProjectedPct !== null}
                                      fallback={
                                        <span class="text-xs text-slate-400 dark:text-slate-500">
                                          {t().budget.byDepartment.shareLabel(row.shareOfFinalPct)}
                                        </span>
                                      }
                                    >
                                      <span
                                        class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${
                                          utilStatus() === "over"
                                            ? "bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300"
                                            : utilStatus() === "warning"
                                              ? "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300"
                                              : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                                        }`}
                                      >
                                        {row.utilizationProjectedPct}%
                                      </span>
                                    </Show>
                                  </td>
                                  <td class="px-4 py-3 text-right tabular-nums text-xs text-slate-500 dark:text-slate-400">
                                    {row.spendingCount} / {row.orderCount} / {row.openRequestCount}
                                  </td>
                                  <td class="px-4 py-3 text-right">
                                    <button
                                      type="button"
                                      onClick={() => drillDownToDepartment(row.department, "all_spendings")}
                                      class="text-xs font-semibold text-red-600 dark:text-red-400 hover:underline cursor-pointer"
                                    >
                                      {t().budget.byDepartment.spendingsLink}
                                    </button>
                                  </td>
                                </tr>
                                <Show when={isOpen() && row.carSystems.length > 0}>
                                  <tr class="bg-slate-50/70 dark:bg-slate-800/40">
                                    <td colSpan={9} class="px-10 py-3">
                                      <div class="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
                                        {t().budget.byDepartment.breakdownTitle(
                                          getDepartmentLabel(locale(), row.department)
                                        )}
                                      </div>
                                      <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                        <For each={row.carSystems}>
                                          {sys => (
                                            <div class="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 flex items-center justify-between gap-2 text-xs">
                                              <div class="min-w-0">
                                                <div class="font-semibold text-slate-800 dark:text-slate-200 truncate">
                                                  {formatCarSystemDisplay(sys.carSystem, locale())}
                                                </div>
                                                <div class="text-[11px] text-slate-400 dark:text-slate-500">
                                                  {t().budget.byDepartment.itemFinalLine(
                                                    sys.count,
                                                    formatEur(sys.finalCents, locale())
                                                  )}
                                                </div>
                                              </div>
                                              <div class="font-bold tabular-nums text-slate-900 dark:text-slate-100 shrink-0">
                                                {formatEur(sys.totalProjectedCents, locale())}
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
                <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs">
                  <h2 class="text-base font-bold text-slate-900 dark:text-slate-100 mb-4">
                    {t().budget.byTimeframe.heading(getRatePeriodLabel(locale(), periodUnit(), "noun"))}
                  </h2>
                  <CashflowBarsChart
                    buckets={data().analytics.timeSeries}
                    mode="spendings"
                    periodUnit={periodUnit()}
                  />
                </div>

                <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
                  <div class="overflow-x-auto">
                    <table class="w-full text-left text-sm">
                      <thead class="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                        <tr>
                          <th class="px-4 py-3">{t().budget.byTimeframe.colPeriod}</th>
                          <th class="px-4 py-3 text-right">{t().budget.byTimeframe.colFinalSpendings}</th>
                          <th class="px-4 py-3 text-right">{t().budget.byTimeframe.colProvisionalOrders}</th>
                          <th class="px-4 py-3 text-right">{t().budget.byTimeframe.colCombinedOutflow}</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                        <For each={data().analytics.timeSeries}>
                          {row => (
                            <tr>
                              <td class="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                                {formatTimeBucketLabel(row.bucketKey, row.label, periodUnit(), locale())}
                              </td>
                              <td class="px-4 py-3 text-right tabular-nums font-bold text-slate-900 dark:text-slate-100">
                                {formatEur(row.finalSpendingsCents, locale())}
                              </td>
                              <td class="px-4 py-3 text-right tabular-nums text-orange-700 dark:text-orange-400">
                                {formatEur(row.provisionalSpendingsCents, locale())}
                              </td>
                              <td class="px-4 py-3 text-right tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                                {formatEur(row.finalSpendingsCents + row.provisionalSpendingsCents, locale())}
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
              <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
                <div class="p-4 border-b border-slate-100 dark:border-slate-800 space-y-3">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 class="text-base font-bold text-slate-900 dark:text-slate-100">
                        <Show
                          when={spendingSearch().trim().length > 0 || deptFilter() !== "all"}
                          fallback={t().budget.allSpendings.titleAll(data().spendings.length)}
                        >
                          {t().budget.allSpendings.titleMatching(
                            filteredSpendings().length,
                            data().spendings.length
                          )}
                        </Show>
                      </h2>
                      <Show when={spendingSearch().trim().length > 0 || deptFilter() !== "all"}>
                        <div class="text-xs text-slate-500 dark:text-slate-400">
                          {t().budget.allSpendings.filteredSubtotal}{" "}
                          <span class="font-bold text-emerald-800 dark:text-emerald-400 tabular-nums">
                            {formatEur(filteredSpendingsTotalCents(), locale())}
                          </span>{" "}
                          · {t().budget.allSpendings.seasonTotal}{" "}
                          <span class="tabular-nums">
                            {formatEur(data().analytics.finalSpendingsCents, locale())}
                          </span>
                        </div>
                      </Show>
                    </div>
                    <span class="font-extrabold tabular-nums text-emerald-800 dark:text-emerald-400">
                      {formatEur(
                        spendingSearch().trim().length > 0 || deptFilter() !== "all"
                          ? filteredSpendingsTotalCents()
                          : data().analytics.finalSpendingsCents,
                        locale()
                      )}
                    </span>
                  </div>

                  <div class="flex flex-col sm:flex-row gap-2.5">
                    <SearchInputBar
                      value={spendingSearch()}
                      onInput={setSpendingSearch}
                      placeholder={t().budget.allSpendings.searchPlaceholder}
                      class="flex-1"
                    />
                    <select
                      value={deptFilter()}
                      onChange={e =>
                        setSearchParams({
                          dept: e.currentTarget.value === "all" ? undefined : e.currentTarget.value
                        })
                      }
                      class="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                    >
                      <option value="all">{t().common.allDepartments}</option>
                      <For each={DEPARTMENTS}>
                        {d => (
                          <option value={d.id}>
                            {getDepartmentLabel(locale(), d.id)} ({d.code})
                          </option>
                        )}
                      </For>
                    </select>
                    <select
                      value={spendingSort()}
                      onChange={e => setSpendingSort(e.currentTarget.value as SortMode)}
                      class="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                    >
                      <option value="date_desc">{t().common.newestFirst}</option>
                      <option value="amount_desc">{t().common.amountHighToLow}</option>
                      <option value="amount_asc">{t().common.amountLowToHigh}</option>
                      <option value="code_asc">{t().common.idAToZ}</option>
                    </select>
                  </div>
                </div>

                <div class="overflow-x-auto">
                  <table class="w-full text-left text-sm">
                    <thead class="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                      <tr>
                        <th class="px-4 py-3">{t().common.idLabel}</th>
                        <th class="px-4 py-3">{t().budget.allSpendings.colItemOption}</th>
                        <th class="px-4 py-3">{t().common.department}</th>
                        <th class="px-4 py-3 text-right">{t().budget.allSpendings.colBaseFees}</th>
                        <th class="px-4 py-3 text-right">{t().budget.allSpendings.colFinalEur}</th>
                        <th class="px-4 py-3">{t().budget.allSpendings.colInvoiceDate}</th>
                        <th class="px-4 py-3">{t().budget.allSpendings.colInvoice}</th>
                        <Show when={isMaster(app.user()?.role)}>
                          <th class="px-4 py-3 text-right">{t().budget.allSpendings.colMaster}</th>
                        </Show>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                      <Show
                        when={filteredSpendings().length > 0}
                        fallback={
                          <tr>
                            <td
                              colSpan={isMaster(app.user()?.role) ? 8 : 7}
                              class="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400"
                            >
                              <Show
                                when={spendingSearch().trim().length > 0 || deptFilter() !== "all"}
                                fallback={t().budget.allSpendings.emptyNone}
                              >
                                {t().budget.allSpendings.emptyFilter}{" "}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSpendingSearch("");
                                    setSearchParams({ dept: undefined });
                                  }}
                                  class="text-red-600 dark:text-red-400 font-semibold hover:underline cursor-pointer"
                                >
                                  {t().common.clearSearch}
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
                              <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/50">
                                <td class="px-4 py-3 font-mono text-xs font-bold whitespace-nowrap">
                                  <A
                                    href={`/requests/${sp.requestCode}`}
                                    class="text-red-600 dark:text-red-400 hover:underline"
                                  >
                                    {sp.requestCode}
                                  </A>
                                </td>
                                <td class="px-4 py-3">
                                  <A
                                    href={`/requests/${sp.requestCode}`}
                                    class="font-semibold text-slate-900 dark:text-slate-100 hover:text-red-600 dark:hover:text-red-400"
                                  >
                                    {sp.title}
                                  </A>
                                  <div class="text-xs text-slate-500 dark:text-slate-400">{sp.chosenOptionLabel}</div>
                                  <Show when={sp.carSystem}>
                                    <div class="mt-1 inline-flex items-center rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300">
                                      {sp.carSystem}
                                    </div>
                                  </Show>
                                </td>
                                <td class="px-4 py-3">
                                  <DepartmentBadge department={sp.department} />
                                </td>
                                <td class="px-4 py-3 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                  {formatEur(sp.basePriceCents, locale())} +{" "}
                                  {formatEur(sp.shippingCents + sp.importFeeCents, locale())}
                                  <Show when={sp.varianceCents !== 0}>
                                    <div
                                      class={`text-[11px] font-semibold ${
                                        sp.varianceCents > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"
                                      }`}
                                    >
                                      {sp.varianceCents > 0 ? "+" : ""}
                                      {formatEur(sp.varianceCents, locale())}{" "}
                                      {t().budget.allSpendings.vsQuote}
                                    </div>
                                  </Show>
                                </td>
                                <td class="px-4 py-3 text-right tabular-nums font-bold text-emerald-800 dark:text-emerald-400">
                                  {formatEur(sp.finalAmountCents, locale())}
                                </td>
                                <td class="px-4 py-3 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                  {formatDate(sp.effectiveDate, locale())}
                                </td>
                                <td class="px-4 py-3">
                                  <Show when={inv()} fallback="—">
                                    {a => (
                                      <a
                                        href={`/api/files/${a().id}`}
                                        download={a().originalName}
                                        rel="external"
                                        class="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline inline-flex items-center gap-1"
                                      >
                                        <Download class="h-3.5 w-3.5" />
                                        {t().budget.allSpendings.pdfFile}
                                      </a>
                                    )}
                                  </Show>
                                </td>
                                <Show when={isMaster(app.user()?.role)}>
                                  <td class="px-4 py-3 text-right whitespace-nowrap">
                                    <div class="inline-flex items-center gap-1.5">
                                      <A
                                        href={`/requests/${sp.requestCode}?masterEdit=1`}
                                        class="inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                                      >
                                        <ShieldAlert class="h-3 w-3" />
                                        {t().common.edit}
                                      </A>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setDeleteTarget({
                                            kind: "request",
                                            id: sp.id,
                                            code: sp.requestCode,
                                            title: sp.title,
                                            statusLabel: getRequestStatusLabel(locale(), "spending"),
                                            attachmentCount: sp.attachments.length
                                          })
                                        }
                                        class="inline-flex items-center gap-1 rounded-md border border-rose-200 dark:border-rose-800/80 bg-rose-50 dark:bg-rose-950/60 px-2 py-1 text-[11px] font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/60 cursor-pointer"
                                      >
                                        <Trash2 class="h-3 w-3" />
                                        {t().common.delete}
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
              <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
                <div class="p-4 border-b border-slate-100 dark:border-slate-800 space-y-3">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <h2 class="text-base font-bold text-slate-900 dark:text-slate-100">
                      <Show
                        when={orderSearch().trim().length > 0 || deptFilter() !== "all"}
                        fallback={t().budget.provisionalSpendings.titleAll(
                          data().provisionalSpendings.length
                        )}
                      >
                        {t().budget.provisionalSpendings.titleMatching(
                          filteredOrders().length,
                          data().provisionalSpendings.length
                        )}
                      </Show>
                    </h2>
                    <span class="font-extrabold tabular-nums text-orange-700 dark:text-orange-400">
                      {formatEur(
                        orderSearch().trim().length > 0 || deptFilter() !== "all"
                          ? filteredOrdersTotalCents()
                          : data().analytics.provisionalSpendingsCents,
                        locale()
                      )}
                    </span>
                  </div>

                  <div class="flex flex-col sm:flex-row gap-2.5">
                    <SearchInputBar
                      value={orderSearch()}
                      onInput={setOrderSearch}
                      placeholder={t().budget.provisionalSpendings.searchPlaceholder}
                      class="flex-1"
                    />
                    <select
                      value={deptFilter()}
                      onChange={e =>
                        setSearchParams({
                          dept: e.currentTarget.value === "all" ? undefined : e.currentTarget.value
                        })
                      }
                      class="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                    >
                      <option value="all">{t().common.allDepartments}</option>
                      <For each={DEPARTMENTS}>
                        {d => (
                          <option value={d.id}>
                            {getDepartmentLabel(locale(), d.id)} ({d.code})
                          </option>
                        )}
                      </For>
                    </select>
                    <select
                      value={orderSort()}
                      onChange={e => setOrderSort(e.currentTarget.value as SortMode)}
                      class="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                    >
                      <option value="date_desc">{t().common.newestFirst}</option>
                      <option value="amount_desc">{t().common.amountHighToLow}</option>
                      <option value="amount_asc">{t().common.amountLowToHigh}</option>
                      <option value="code_asc">{t().common.idAToZ}</option>
                    </select>
                  </div>
                </div>

                <div class="overflow-x-auto">
                  <table class="w-full text-left text-sm">
                    <thead class="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                      <tr>
                        <th class="px-4 py-3">{t().common.idLabel}</th>
                        <th class="px-4 py-3">{t().budget.provisionalSpendings.colOrder}</th>
                        <th class="px-4 py-3">{t().common.department}</th>
                        <th class="px-4 py-3 text-right">{t().budget.provisionalSpendings.colBaseFees}</th>
                        <th class="px-4 py-3 text-right">{t().budget.provisionalSpendings.colProvTotal}</th>
                        <th class="px-4 py-3">{t().budget.provisionalSpendings.colAction}</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                      <Show
                        when={filteredOrders().length > 0}
                        fallback={
                          <tr>
                            <td colSpan={6} class="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                              <Show
                                when={orderSearch().trim().length > 0 || deptFilter() !== "all"}
                                fallback={t().budget.provisionalSpendings.emptyNone}
                              >
                                {t().budget.provisionalSpendings.emptyFilter}{" "}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOrderSearch("");
                                    setSearchParams({ dept: undefined });
                                  }}
                                  class="text-red-600 dark:text-red-400 font-semibold hover:underline cursor-pointer"
                                >
                                  {t().common.clearSearch}
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
                              <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/50">
                                <td class="px-4 py-3 font-mono text-xs font-bold whitespace-nowrap">
                                  <A
                                    href={`/requests/${ord.requestCode}`}
                                    class="text-red-600 dark:text-red-400 hover:underline"
                                  >
                                    {ord.requestCode}
                                  </A>
                                </td>
                                <td class="px-4 py-3">
                                  <A
                                    href={`/requests/${ord.requestCode}`}
                                    class="font-semibold text-slate-900 dark:text-slate-100 hover:text-red-600 dark:hover:text-red-400"
                                  >
                                    {ord.title}
                                  </A>
                                  <div class="text-xs text-slate-500 dark:text-slate-400">{ord.chosenOptionLabel}</div>
                                  <div class="flex flex-wrap gap-1.5 mt-1">
                                    <Show when={ord.carSystem}>
                                      <span class="inline-flex items-center rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300">
                                        {ord.carSystem}
                                      </span>
                                    </Show>
                                    <Show when={age() > 21}>
                                      <span class="inline-flex items-center gap-1 rounded bg-amber-100 dark:bg-amber-950/70 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                                        <Clock class="h-3 w-3" />
                                        {t().budget.provisionalSpendings.awaitingInvoiceDays(age())}
                                      </span>
                                    </Show>
                                  </div>
                                </td>
                                <td class="px-4 py-3">
                                  <DepartmentBadge department={ord.department} />
                                </td>
                                <td class="px-4 py-3 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">
                                  {formatEur(ord.basePriceCents, locale())} +{" "}
                                  {formatEur(ord.shippingCents + ord.importFeeCents, locale())}
                                </td>
                                <td class="px-4 py-3 text-right tabular-nums font-bold text-orange-700 dark:text-orange-400">
                                  {formatEur(ord.provisionalTotalCents, locale())}
                                </td>
                                <td class="px-4 py-3">
                                  <div class="flex flex-wrap items-center gap-2">
                                    <A
                                      href={`/requests/${ord.requestCode}`}
                                      class="text-xs font-semibold text-red-600 dark:text-red-400 hover:underline"
                                    >
                                      {t().budget.provisionalSpendings.openOrder}
                                    </A>
                                    <Show when={isMaster(app.user()?.role)}>
                                      <A
                                        href={`/requests/${ord.requestCode}?masterEdit=1`}
                                        class="inline-flex items-center gap-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                                      >
                                        <ShieldAlert class="h-3 w-3" />
                                        {t().common.edit}
                                      </A>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setDeleteTarget({
                                            kind: "request",
                                            id: ord.id,
                                            code: ord.requestCode,
                                            title: ord.title,
                                            statusLabel: getRequestStatusLabel(locale(), "order"),
                                            attachmentCount: ord.attachments.length
                                          })
                                        }
                                        class="inline-flex items-center gap-1 rounded border border-rose-200 dark:border-rose-800/80 bg-rose-50 dark:bg-rose-950/60 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/60 cursor-pointer"
                                      >
                                        <Trash2 class="h-3 w-3" />
                                        {t().common.delete}
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
              <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
                <div class="p-4 border-b border-slate-100 dark:border-slate-800 space-y-3">
                  <div class="flex items-center justify-between">
                    <h2 class="text-base font-bold text-slate-900 dark:text-slate-100">
                      {t().budget.provisionalEntries.title(filteredProvisionalEntries().length)}
                    </h2>
                    <span class="font-extrabold tabular-nums text-amber-700 dark:text-amber-400">
                      {formatEur(
                        filteredProvisionalEntries().reduce(
                          (sum, e) => sum + e.initialAmountCents,
                          0
                        ),
                        locale()
                      )}
                    </span>
                  </div>
                  <div class="flex flex-col sm:flex-row gap-2.5">
                    <SearchInputBar
                      value={entrySearch()}
                      onInput={setEntrySearch}
                      placeholder={t().budget.provisionalEntries.searchPlaceholder}
                      class="flex-1"
                    />
                    <select
                      value={entryCategoryFilter()}
                      onChange={e =>
                        setEntryCategoryFilter(e.currentTarget.value as EntryCategory | "all")
                      }
                      class="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                    >
                      <option value="all">{t().common.allCategories}</option>
                      <For each={ENTRY_CATEGORIES}>
                        {c => <option value={c.id}>{getEntryCategoryLabel(locale(), c.id)}</option>}
                      </For>
                    </select>
                    <select
                      value={entrySort()}
                      onChange={e => setEntrySort(e.currentTarget.value as SortMode)}
                      class="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                    >
                      <option value="date_desc">{t().common.dateNewest}</option>
                      <option value="amount_desc">{t().common.amountHighToLow}</option>
                      <option value="amount_asc">{t().common.amountLowToHigh}</option>
                      <option value="code_asc">{t().common.idAToZ}</option>
                    </select>
                  </div>
                </div>
                <div class="divide-y divide-slate-100 dark:divide-slate-800">
                  <For each={filteredProvisionalEntries()}>
                    {entry => {
                      const isOverdue = () => entry.entryDate < todayIso;
                      return (
                        <div class="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                          <div class="space-y-1">
                            <div class="flex flex-wrap items-center gap-2">
                              <span class="font-mono text-xs font-bold text-slate-700 dark:text-slate-300">
                                {entry.entryCode}
                              </span>
                              <CategoryBadge category={entry.category} />
                              <EntryStatusBadge status={entry.status} />
                              <span class="text-xs text-slate-400 dark:text-slate-500">
                                {formatDate(entry.entryDate, locale())}
                              </span>
                              <Show when={isOverdue()}>
                                <span class="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-950/70 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                                  <Clock class="h-3 w-3" />
                                  {t().budget.provisionalEntries.overdueExpected}
                                </span>
                              </Show>
                            </div>
                            <div class="font-bold text-slate-900 dark:text-slate-100">{entry.title}</div>
                            <p class="text-xs text-slate-600 dark:text-slate-400">{entry.comment}</p>
                          </div>

                          <div class="flex flex-wrap items-center gap-2 shrink-0">
                            <span class="text-lg font-extrabold tabular-nums text-amber-700 dark:text-amber-400 mr-1">
                              {formatEur(entry.initialAmountCents, locale())}
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
                              class="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
                            >
                              <History class="h-3.5 w-3.5" />
                              {t().budget.provisionalEntries.logBtn}
                            </button>
                            <Show when={canWriteBudget()}>
                              <button
                                type="button"
                                onClick={() => setEditTarget(entry)}
                                class="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
                              >
                                <Edit3 class="h-3.5 w-3.5" />
                                {t().common.edit}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmTarget(entry)}
                                class="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 cursor-pointer"
                              >
                                <CheckCircle2 class="h-3.5 w-3.5" />
                                {t().budget.provisionalEntries.uploadConfirmBtn}
                              </button>
                              <form action={cancelEntryAction} method="post">
                                <input type="hidden" name="entryId" value={entry.id} />
                                <input
                                  type="hidden"
                                  name="reason"
                                  value={t().budget.provisionalEntries.cancelReasonDefault}
                                />
                                <button
                                  type="submit"
                                  disabled={cancelEntrySub.pending}
                                  class="rounded-lg border border-rose-200 dark:border-rose-800/80 px-2.5 py-1.5 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/60 cursor-pointer"
                                >
                                  {t().common.cancel}
                                </button>
                              </form>
                            </Show>
                            <Show when={isMaster(app.user()?.role)}>
                              <button
                                type="button"
                                onClick={() => setMasterEditEntryTarget(entry)}
                                class="inline-flex items-center gap-1 rounded-lg bg-slate-900 dark:bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-white cursor-pointer"
                              >
                                <ShieldAlert class="h-3.5 w-3.5" />
                                {t().budget.provisionalEntries.masterEditBtn}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setDeleteTarget({
                                    kind: "entry",
                                    id: entry.id,
                                    code: entry.entryCode,
                                    title: entry.title,
                                    statusLabel: getEntryStatusLabel(locale(), entry.status),
                                    attachmentCount: entry.attachments.length
                                  })
                                }
                                class="inline-flex items-center gap-1 rounded-lg border border-rose-200 dark:border-rose-800/80 bg-rose-50 dark:bg-rose-950/60 px-2.5 py-1.5 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/60 cursor-pointer"
                              >
                                <Trash2 class="h-3.5 w-3.5" />
                                {t().common.delete}
                              </button>
                            </Show>
                          </div>
                        </div>
                      );
                    }}
                  </For>
                  <Show when={filteredProvisionalEntries().length === 0}>
                    <div class="p-10 text-center text-sm text-slate-400 dark:text-slate-500">
                      {t().budget.provisionalEntries.emptyFilter}
                    </div>
                  </Show>
                </div>
              </div>
            </Match>

            {/* 7. All Entries */}
            <Match when={activeTab() === "all_entries"}>
              <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
                <div class="p-4 border-b border-slate-100 dark:border-slate-800 space-y-3">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <h2 class="text-base font-bold text-slate-900 dark:text-slate-100">
                      {t().budget.allEntries.title(filteredAllEntries().length, data().entries.length)}
                    </h2>
                    <span class="text-sm font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                      {t().budget.allEntries.shownTotal}{" "}
                      {formatEur(
                        filteredAllEntries()
                          .filter(e => e.status !== "cancelled")
                          .reduce((sum, e) => sum + e.effectiveAmountCents, 0),
                        locale()
                      )}
                    </span>
                  </div>
                  <div class="flex flex-col sm:flex-row gap-2.5">
                    <SearchInputBar
                      value={entrySearch()}
                      onInput={setEntrySearch}
                      placeholder={t().budget.allEntries.searchPlaceholder}
                      class="flex-1"
                    />
                    <select
                      value={entryCategoryFilter()}
                      onChange={e =>
                        setEntryCategoryFilter(e.currentTarget.value as EntryCategory | "all")
                      }
                      class="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                    >
                      <option value="all">{t().common.allCategories}</option>
                      <For each={ENTRY_CATEGORIES}>
                        {c => <option value={c.id}>{getEntryCategoryLabel(locale(), c.id)}</option>}
                      </For>
                    </select>
                    <select
                      value={entryStatusFilter()}
                      onChange={e =>
                        setEntryStatusFilter(e.currentTarget.value as EntryStatus | "all")
                      }
                      class="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                    >
                      <option value="all">{t().common.allStatuses}</option>
                      <option value="confirmed">{getEntryStatusLabel(locale(), "confirmed")}</option>
                      <option value="provisional">{getEntryStatusLabel(locale(), "provisional")}</option>
                      <option value="cancelled">{getEntryStatusLabel(locale(), "cancelled")}</option>
                    </select>
                    <select
                      value={entrySort()}
                      onChange={e => setEntrySort(e.currentTarget.value as SortMode)}
                      class="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                    >
                      <option value="date_desc">{t().common.dateNewest}</option>
                      <option value="amount_desc">{t().common.amountHighToLow}</option>
                      <option value="amount_asc">{t().common.amountLowToHigh}</option>
                      <option value="code_asc">{t().common.idAToZ}</option>
                    </select>
                  </div>
                </div>

                <div class="divide-y divide-slate-100 dark:divide-slate-800">
                  <For each={filteredAllEntries()}>
                    {entry => (
                      <div class="p-4 flex flex-col md:flex-row md:items-start justify-between gap-4">
                        <div class="space-y-1.5">
                          <div class="flex flex-wrap items-center gap-2">
                            <span class="font-mono text-xs font-bold text-slate-700 dark:text-slate-300">
                              {entry.entryCode}
                            </span>
                            <CategoryBadge category={entry.category} />
                            <EntryStatusBadge status={entry.status} />
                            <span class="text-xs text-slate-400 dark:text-slate-500">
                              {t().budget.allEntries.datePrefix} {formatDate(entry.entryDate, locale())}
                            </span>
                            <Show when={entry.status === "provisional" && entry.entryDate < todayIso}>
                              <span class="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-950/70 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                                {t().budget.allEntries.overdueBadge}
                              </span>
                            </Show>
                          </div>
                          <div class="font-bold text-slate-900 dark:text-slate-100">{entry.title}</div>
                          <p class="text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap">{entry.comment}</p>
                          <div class="flex flex-wrap gap-2 pt-1">
                            <For each={entry.attachments}>
                              {att => (
                                <a
                                  href={`/api/files/${att.id}`}
                                  download={att.originalName}
                                  rel="external"
                                  class="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                                >
                                  <FileText class="h-3 w-3" />
                                  {att.kind === "invoice" ? `${t().common.invoicePrefix} ` : ""}
                                  {att.originalName}
                                </a>
                              )}
                            </For>
                          </div>
                        </div>
                        <div class="flex flex-col items-end gap-1.5 shrink-0">
                          <div class="text-lg font-extrabold tabular-nums text-slate-900 dark:text-slate-100">
                            {formatEur(entry.effectiveAmountCents, locale())}
                          </div>
                          <div class="text-[11px] text-slate-400 dark:text-slate-500">
                            {t().budget.allEntries.byAuthor(entry.creatorName)}
                          </div>
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
                              class="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
                            >
                              <History class="h-3 w-3" />
                              {t().budget.allEntries.itemLogBtn}
                            </button>
                            <Show when={entry.status === "provisional" && canWriteBudget()}>
                              <button
                                type="button"
                                onClick={() => setEditTarget(entry)}
                                class="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
                              >
                                <Edit3 class="h-3 w-3" />
                                {t().budget.allEntries.editEntryBtn}
                              </button>
                            </Show>
                            <Show when={isMaster(app.user()?.role)}>
                              <button
                                type="button"
                                onClick={() => setMasterEditEntryTarget(entry)}
                                class="inline-flex items-center gap-1 rounded-lg bg-slate-900 dark:bg-slate-100 px-2.5 py-1 text-xs font-semibold text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-white cursor-pointer"
                              >
                                <ShieldAlert class="h-3 w-3" />
                                {t().budget.provisionalEntries.masterEditBtn}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setDeleteTarget({
                                    kind: "entry",
                                    id: entry.id,
                                    code: entry.entryCode,
                                    title: entry.title,
                                    statusLabel: getEntryStatusLabel(locale(), entry.status),
                                    attachmentCount: entry.attachments.length
                                  })
                                }
                                class="inline-flex items-center gap-1 rounded-lg border border-rose-200 dark:border-rose-800/80 bg-rose-50 dark:bg-rose-950/60 px-2.5 py-1 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/60 cursor-pointer"
                              >
                                <Trash2 class="h-3 w-3" />
                                {t().common.delete}
                              </button>
                            </Show>
                          </div>
                        </div>
                      </div>
                    )}
                  </For>
                  <Show when={filteredAllEntries().length === 0}>
                    <div class="p-10 text-center text-sm text-slate-400 dark:text-slate-500">
                      {t().budget.allEntries.emptyFilter}
                    </div>
                  </Show>
                </div>
              </div>
            </Match>

            {/* 8. Entries by category */}
            <Match when={activeTab() === "entries_by_category"}>
              <div class="space-y-6">
                <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs">
                  <h2 class="text-base font-bold text-slate-900 dark:text-slate-100 mb-4">
                    {t().budget.entriesByCategory.heading}
                  </h2>
                  <CategoryEntryChart rows={data().analytics.byCategory} />
                </div>

                <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
                  <div class="overflow-x-auto">
                    <table class="w-full text-left text-sm">
                      <thead class="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                        <tr>
                          <th class="px-4 py-3">{t().budget.entriesByCategory.colCategory}</th>
                          <th class="px-4 py-3 text-right">{t().budget.entriesByCategory.colConfirmed}</th>
                          <th class="px-4 py-3 text-right">{t().budget.entriesByCategory.colProvisional}</th>
                          <th class="px-4 py-3 text-right">{t().budget.entriesByCategory.colProjectedTotal}</th>
                          <th class="px-4 py-3 text-right">{t().budget.entriesByCategory.colShareConfirmed}</th>
                          <th class="px-4 py-3 text-right">{t().budget.entriesByCategory.colConfirmedCount}</th>
                          <th class="px-4 py-3 text-right">{t().budget.entriesByCategory.colProvisionalCount}</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                        <For each={data().analytics.byCategory}>
                          {row => (
                            <tr>
                              <td class="px-4 py-3">
                                <CategoryBadge category={row.category} />
                              </td>
                              <td class="px-4 py-3 text-right tabular-nums font-bold text-emerald-700 dark:text-emerald-400">
                                {formatEur(row.confirmedCents, locale())}
                              </td>
                              <td class="px-4 py-3 text-right tabular-nums text-amber-700 dark:text-amber-400">
                                {formatEur(row.provisionalCents, locale())}
                              </td>
                              <td class="px-4 py-3 text-right tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                                {formatEur(row.totalProjectedCents, locale())}
                              </td>
                              <td class="px-4 py-3 text-right tabular-nums text-slate-500 dark:text-slate-400">
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
                  <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs">
                    <div class="text-xs font-semibold uppercase text-slate-400 dark:text-slate-500">
                      {t().budget.cashflowRates.actualCashLeft}
                    </div>
                    <div class="mt-1.5 text-2xl font-extrabold tabular-nums text-slate-900 dark:text-slate-100">
                      {formatEur(data().analytics.actualCashLeftCents, locale())}
                    </div>
                    <div class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {t().budget.cashflowRates.runwayPrefix}{" "}
                      {(() => {
                        const runway = data().analytics.rates.runwayPeriods;
                        return runway !== null
                          ? t().budget.cashflowRates.runwayPeriods(
                              runway,
                              getRatePeriodLabel(locale(), periodUnit(), "noun")
                            )
                          : t().budget.cashflowRates.surplusNoOutflow;
                      })()}
                    </div>
                  </div>
                  <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs">
                    <div class="text-xs font-semibold uppercase text-slate-400 dark:text-slate-500">
                      {t().budget.cashflowRates.projectedBalance}
                    </div>
                    <div
                      class={`mt-1.5 text-2xl font-extrabold tabular-nums ${
                        data().analytics.projectedBalanceCents < 0 ? "text-rose-700 dark:text-rose-400" : "text-sky-700 dark:text-sky-400"
                      }`}
                    >
                      {formatEur(data().analytics.projectedBalanceCents, locale())}
                    </div>
                    <div class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {t().budget.cashflowRates.afterProvisional}
                    </div>
                  </div>
                  <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs">
                    <div class="text-xs font-semibold uppercase text-slate-400 dark:text-slate-500">
                      {t().budget.cashflowRates.avgInputRate(
                        getRatePeriodLabel(locale(), periodUnit(), "noun")
                      )}
                    </div>
                    <div class="mt-1.5 text-xl font-extrabold tabular-nums text-emerald-700 dark:text-emerald-400">
                      +{formatEur(data().analytics.rates.actualInputPerPeriodCents, locale())}
                    </div>
                    <div class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {t().budget.cashflowRates.projectedPrefix}{" "}
                      +{formatEur(data().analytics.rates.projectedInputPerPeriodCents, locale())}
                    </div>
                  </div>
                  <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs">
                    <div class="text-xs font-semibold uppercase text-slate-400 dark:text-slate-500">
                      {t().budget.cashflowRates.avgOutputRate(
                        getRatePeriodLabel(locale(), periodUnit(), "noun")
                      )}
                    </div>
                    <div class="mt-1.5 text-xl font-extrabold tabular-nums text-red-600 dark:text-red-400">
                      -{formatEur(data().analytics.rates.actualOutputPerPeriodCents, locale())}
                    </div>
                    <div class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {t().budget.cashflowRates.inOutRatioPrefix}{" "}
                      {data().analytics.rates.actualInputOutputRatio !== null
                        ? `${data().analytics.rates.actualInputOutputRatio}x`
                        : "∞"}
                    </div>
                  </div>
                </div>

                <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs">
                  <h2 class="text-base font-bold text-slate-900 dark:text-slate-100 mb-4">
                    {t().budget.cashflowRates.balanceCurveTitle(
                      getRatePeriodLabel(locale(), periodUnit(), "adj")
                    )}
                  </h2>
                  <BalanceCurveChart
                    buckets={data().analytics.timeSeries}
                    openingBalanceCents={data().analytics.openingBalanceCents}
                    periodUnit={periodUnit()}
                  />
                </div>

                <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs">
                  <h2 class="text-base font-bold text-slate-900 dark:text-slate-100 mb-4">
                    {t().budget.cashflowRates.inOutChartTitle(
                      getRatePeriodLabel(locale(), periodUnit(), "adj"),
                      data().analytics.rates.periodCount
                    )}
                  </h2>
                  <CashflowBarsChart
                    buckets={data().analytics.timeSeries}
                    mode="in_out"
                    periodUnit={periodUnit()}
                  />
                </div>

                <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
                  <div class="overflow-x-auto">
                    <table class="w-full text-left text-sm">
                      <thead class="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                        <tr>
                          <th class="px-4 py-3">{t().budget.cashflowRates.colPeriod}</th>
                          <th class="px-4 py-3 text-right">{t().budget.cashflowRates.colConfirmedInflow}</th>
                          <th class="px-4 py-3 text-right">{t().budget.cashflowRates.colFinalOutflow}</th>
                          <th class="px-4 py-3 text-right">{t().budget.cashflowRates.colNetActual}</th>
                          <th class="px-4 py-3 text-right">{t().budget.cashflowRates.colCumActual}</th>
                          <th class="px-4 py-3 text-right">{t().budget.cashflowRates.colCumProjected}</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                        <For each={data().analytics.timeSeries}>
                          {row => (
                            <tr>
                              <td class="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                                {formatTimeBucketLabel(row.bucketKey, row.label, periodUnit(), locale())}
                              </td>
                              <td class="px-4 py-3 text-right tabular-nums text-emerald-700 dark:text-emerald-400 font-semibold">
                                +{formatEur(row.confirmedEntriesCents, locale())}
                              </td>
                              <td class="px-4 py-3 text-right tabular-nums text-red-600 dark:text-red-400 font-semibold">
                                -{formatEur(row.finalSpendingsCents, locale())}
                              </td>
                              <td class="px-4 py-3 text-right tabular-nums font-medium text-slate-900 dark:text-slate-100">
                                {formatEur(row.netActualCents, locale())}
                              </td>
                              <td class="px-4 py-3 text-right tabular-nums font-bold text-slate-900 dark:text-slate-100">
                                {formatEur(row.cumulativeActualBalanceCents, locale())}
                              </td>
                              <td class="px-4 py-3 text-right tabular-nums text-sky-700 dark:text-sky-400 font-semibold">
                                {formatEur(row.cumulativeProjectedBalanceCents, locale())}
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
      </Suspense>

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

      <Suspense>
        <MasterEditEntryModal
          target={masterEditEntryTarget()}
          seasons={app.seasons()}
          users={(masterUsers.latest ?? masterUsers()) ?? []}
          onClose={() => setMasterEditEntryTarget(null)}
          onSuccess={refreshBudget}
        />
      </Suspense>

      <EntryItemLogModal
        entry={itemLogEntryTarget()}
        onClose={() => setItemLogEntryTarget(null)}
      />

      <MasterDeleteConfirmModal
        target={deleteTarget()}
        onClose={() => setDeleteTarget(null)}
        onDeleted={refreshBudget}
      />

      <Suspense>
        <Show when={activeSnapshot()}>
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
      </Suspense>
    </div>
  );
}
