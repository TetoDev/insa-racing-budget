import { Title } from "@solidjs/meta";
import { A, createAsync } from "@solidjs/router";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Package,
  TrendingDown,
  TrendingUp,
  Wallet
} from "lucide-solid";
import { For, Show } from "solid-js";
import { useApp, useI18n } from "~/components/AppContext";
import { DepartmentBadge, RequestStatusBadge } from "~/components/Badges";
import { DepartmentSpendChart } from "~/components/BudgetCharts";
import { formatDate, formatDateTime, formatEur } from "~/lib/format";
import { canCreateRequest } from "~/lib/permissions";
import {
  queryAuditLogs,
  queryBudgetSnapshot,
  queryRequestsList
} from "~/server/rpc";

export default function OverviewPage() {
  const app = useApp();
  const { locale, t } = useI18n();

  const snapshot = createAsync(async () => {
    const sid = app.selectedSeasonId();
    if (!sid) return null;
    return queryBudgetSnapshot({ seasonId: sid, periodUnit: "month" });
  });

  const actionQueue = createAsync(async () => {
    const sid = app.selectedSeasonId();
    if (!sid) return [];
    const list = await queryRequestsList({ seasonId: sid, status: "all" });
    return list
      .filter(
        r =>
          r.status === "pending_review" ||
          r.status === "counter_proposed" ||
          r.status === "option_selection"
      )
      .slice(0, 6);
  });

  const recentLogs = createAsync(() => {
    const sid = app.selectedSeasonId();
    if (!sid) return Promise.resolve([]);
    return queryAuditLogs({ seasonId: sid }).then(rows => rows.slice(0, 6));
  });

  return (
    <div class="space-y-6">
      <Title>{t().overview.pageTitle} — {t().appName}</Title>

      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold text-slate-900 dark:text-slate-100">{t().overview.heading}</h1>
          <Show when={app.selectedSeason()}>
            {s => (
              <p class="text-sm text-slate-500 dark:text-slate-400">
                {s().name} · {formatDate(s().startDate, locale())} {t().overview.toDateWord}{" "}
                {formatDate(s().deadlineDate, locale())} {t().overview.deadlineSuffix}
              </p>
            )}
          </Show>
        </div>

        <div class="flex items-center gap-2">
          <A
            href="/budget"
            class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            {t().overview.fullBreakdownBtn}
            <ArrowRight class="h-4 w-4" />
          </A>
          <Show when={canCreateRequest(app.user()?.role) && !app.isViewingArchived()}>
            <A
              href="/requests/new"
              class="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-red-700"
            >
              {t().overview.requestPurchaseBtn}
            </A>
          </Show>
        </div>
      </div>

      <Show
        when={snapshot()}
        fallback={
          <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-400 dark:text-slate-500">
            {t().overview.loadingOverview}
          </div>
        }
      >
        {data => (
          <>
            {/* KPI Cards */}
            <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs">
                <div class="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  <span>{t().overview.actualCashLeft}</span>
                  <Wallet class="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div
                  class={`mt-2 text-2xl font-extrabold tabular-nums ${
                    data().analytics.actualCashLeftCents >= 0 ? "text-slate-900 dark:text-slate-100" : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {formatEur(data().analytics.actualCashLeftCents, locale())}
                </div>
                <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {t().overview.actualCashLeftSub}
                </p>
              </div>

              <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs">
                <div class="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  <span>{t().overview.projectedBalance}</span>
                  <TrendingUp class="h-4 w-4 text-sky-600 dark:text-sky-400" />
                </div>
                <div
                  class={`mt-2 text-2xl font-extrabold tabular-nums ${
                    data().analytics.projectedBalanceCents >= 0 ? "text-slate-900 dark:text-slate-100" : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {formatEur(data().analytics.projectedBalanceCents, locale())}
                </div>
                <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {t().overview.projectedBalanceSub(
                    data().analytics.counts.provisionalEntries,
                    data().analytics.counts.activeOrders
                  )}
                </p>
              </div>

              <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs">
                <div class="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  <span>{t().overview.finalSpendings}</span>
                  <TrendingDown class="h-4 w-4 text-slate-700 dark:text-slate-300" />
                </div>
                <div class="mt-2 text-2xl font-extrabold tabular-nums text-slate-900 dark:text-slate-100">
                  {formatEur(data().analytics.finalSpendingsCents, locale())}
                </div>
                <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {t().overview.finalSpendingsInvoiced(data().analytics.counts.finalSpendings)} ·{" "}
                  <span class="text-orange-600 dark:text-orange-400 font-medium">
                    +{formatEur(data().analytics.provisionalSpendingsCents, locale())}{" "}
                    {t().overview.finalSpendingsProvSuffix}
                  </span>
                </p>
              </div>

              <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs">
                <div class="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  <span>{t().overview.activePipeline}</span>
                  <Clock class="h-4 w-4 text-amber-600 dark:text-amber-400" />
                </div>
                <div class="mt-2 flex items-baseline gap-3">
                  <span class="text-2xl font-extrabold tabular-nums text-slate-900 dark:text-slate-100">
                    {data().analytics.counts.pendingReview +
                      data().analytics.counts.counterProposed +
                      data().analytics.counts.optionSelection}
                  </span>
                  <span class="text-xs text-slate-500 dark:text-slate-400">{t().overview.awaitingDecisions}</span>
                </div>
                <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {t().overview.activeOrdersWaiting(data().analytics.counts.activeOrders)}
                </p>
              </div>
            </div>

            {/* Department Chart + Action Queue */}
            <div class="grid gap-6 lg:grid-cols-12">
              <div class="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs">
                <div class="flex items-center justify-between mb-4">
                  <h2 class="text-base font-bold text-slate-900 dark:text-slate-100">{t().overview.spendingsByDept}</h2>
                  <A href="/budget?tab=by_department" class="text-xs font-semibold text-red-600 dark:text-red-400 hover:underline">
                    {t().overview.deptDashboardLink}
                  </A>
                </div>
                <DepartmentSpendChart rows={data().analytics.byDepartment} />
              </div>

              <div class="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs flex flex-col">
                <div class="flex items-center justify-between mb-4">
                  <h2 class="text-base font-bold text-slate-900 dark:text-slate-100">{t().overview.requestsRequiringAction}</h2>
                  <A href="/requests" class="text-xs font-semibold text-red-600 dark:text-red-400 hover:underline">
                    {t().overview.viewAllLink}
                  </A>
                </div>
                <Show
                  when={(actionQueue()?.length ?? 0) > 0}
                  fallback={
                    <div class="flex-1 flex flex-col items-center justify-center py-8 text-center text-sm text-slate-400 dark:text-slate-500">
                      <CheckCircle2 class="h-8 w-8 text-emerald-500 mb-2" />
                      {t().overview.noActionRequests}
                    </div>
                  }
                >
                  <div class="space-y-2.5">
                    <For each={actionQueue()}>
                      {item => (
                        <A
                          href={`/requests/${item.requestCode}`}
                          class="block rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 p-3 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-white dark:hover:bg-slate-800 transition-colors"
                        >
                          <div class="flex items-center justify-between gap-2">
                            <span class="font-mono text-xs font-bold text-slate-700 dark:text-slate-300">
                              {item.requestCode}
                            </span>
                            <RequestStatusBadge status={item.status} />
                          </div>
                          <div class="mt-1 font-semibold text-sm text-slate-900 dark:text-slate-100 truncate">
                            {item.title}
                          </div>
                          <div class="mt-1.5 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                            <DepartmentBadge department={item.department} />
                            <span class="tabular-nums font-medium text-slate-700 dark:text-slate-300">
                              {formatEur(item.minPriceCents, locale())}
                              <Show when={item.maxPriceCents > item.minPriceCents}>
                                {" – "}
                                {formatEur(item.maxPriceCents, locale())}
                              </Show>
                            </span>
                          </div>
                        </A>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </div>

            {/* Active Orders + Global Recent Logs */}
            <div class="grid gap-6 lg:grid-cols-12">
              <div class="lg:col-span-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs">
                <div class="flex items-center justify-between mb-4">
                  <div class="flex items-center gap-2">
                    <Package class="h-4 w-4 text-orange-500" />
                    <h2 class="text-base font-bold text-slate-900 dark:text-slate-100">{t().overview.activeOrdersTitle}</h2>
                  </div>
                  <A href="/orders" class="text-xs font-semibold text-red-600 dark:text-red-400 hover:underline">
                    {t().overview.manageOrdersLink}
                  </A>
                </div>

                <Show
                  when={data().provisionalSpendings.length > 0}
                  fallback={
                    <p class="py-6 text-center text-sm text-slate-400 dark:text-slate-500">
                      {t().overview.noActiveOrders}
                    </p>
                  }
                >
                  <div class="divide-y divide-slate-100 dark:divide-slate-800">
                    <For each={data().provisionalSpendings.slice(0, 5)}>
                      {ord => (
                        <A
                          href={`/requests/${ord.requestCode}`}
                          class="flex items-center justify-between py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 -mx-2 px-2 rounded-lg transition-colors"
                        >
                          <div class="min-w-0 pr-3">
                            <div class="flex items-center gap-2">
                              <span class="font-mono text-xs font-bold text-slate-700 dark:text-slate-300">
                                {ord.requestCode}
                              </span>
                              <DepartmentBadge department={ord.department} />
                            </div>
                            <div class="text-sm font-medium text-slate-900 dark:text-slate-100 truncate mt-0.5">
                              {ord.title}
                            </div>
                          </div>
                          <div class="text-right shrink-0">
                            <div class="text-sm font-bold tabular-nums text-orange-700 dark:text-orange-400">
                              {formatEur(ord.provisionalTotalCents, locale())}
                            </div>
                            <div class="text-[11px] text-slate-400 dark:text-slate-500">{formatDate(ord.orderedAt, locale())}</div>
                          </div>
                        </A>
                      )}
                    </For>
                  </div>
                </Show>
              </div>

              <div class="lg:col-span-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs">
                <div class="flex items-center justify-between mb-4">
                  <h2 class="text-base font-bold text-slate-900 dark:text-slate-100">{t().overview.recentActivityTitle}</h2>
                  <A href="/logs" class="text-xs font-semibold text-red-600 dark:text-red-400 hover:underline">
                    {t().overview.fullLogLink}
                  </A>
                </div>
                <Show
                  when={(recentLogs()?.length ?? 0) > 0}
                  fallback={<p class="py-6 text-center text-sm text-slate-400 dark:text-slate-500">{t().overview.noEventsYet}</p>}
                >
                  <div class="space-y-3">
                    <For each={recentLogs()}>
                      {log => (
                        <div class="flex items-start justify-between gap-3 text-xs border-b border-slate-100 dark:border-slate-800 pb-2.5 last:border-0">
                          <div class="min-w-0">
                            <div class="font-medium text-slate-900 dark:text-slate-100">{log.summary}</div>
                            <div class="text-slate-500 dark:text-slate-400 mt-0.5">{log.actorLabel}</div>
                          </div>
                          <span class="shrink-0 text-[11px] text-slate-400 dark:text-slate-500 whitespace-nowrap">
                            {formatDateTime(log.createdAt, locale())}
                          </span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}
