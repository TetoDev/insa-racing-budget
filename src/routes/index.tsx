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
import { useApp } from "~/components/AppContext";
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
      <Title>Overview — INSA Racing Achats</Title>

      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold text-slate-900">Team Overview &amp; Summary</h1>
          <Show when={app.selectedSeason()}>
            {s => (
              <p class="text-sm text-slate-500">
                {s().name} · {formatDate(s().startDate)} to {formatDate(s().deadlineDate)} (Deadline)
              </p>
            )}
          </Show>
        </div>

        <div class="flex items-center gap-2">
          <A
            href="/budget"
            class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Full Budget Breakdown
            <ArrowRight class="h-4 w-4" />
          </A>
          <Show when={canCreateRequest(app.user()?.role) && !app.isViewingArchived()}>
            <A
              href="/requests/new"
              class="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-red-700"
            >
              Request Purchase
            </A>
          </Show>
        </div>
      </div>

      <Show
        when={snapshot()}
        fallback={
          <div class="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
            Loading season overview...
          </div>
        }
      >
        {data => (
          <>
            {/* KPI Cards */}
            <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
                <div class="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <span>Actual Cash Left</span>
                  <Wallet class="h-4 w-4 text-emerald-600" />
                </div>
                <div
                  class={`mt-2 text-2xl font-extrabold tabular-nums ${
                    data().analytics.actualCashLeftCents >= 0 ? "text-slate-900" : "text-red-600"
                  }`}
                >
                  {formatEur(data().analytics.actualCashLeftCents)}
                </div>
                <p class="mt-1 text-xs text-slate-500">
                  Confirmed inflows minus final invoiced spendings
                </p>
              </div>

              <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
                <div class="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <span>Projected Balance</span>
                  <TrendingUp class="h-4 w-4 text-sky-600" />
                </div>
                <div
                  class={`mt-2 text-2xl font-extrabold tabular-nums ${
                    data().analytics.projectedBalanceCents >= 0 ? "text-slate-900" : "text-red-600"
                  }`}
                >
                  {formatEur(data().analytics.projectedBalanceCents)}
                </div>
                <p class="mt-1 text-xs text-slate-500">
                  Includes {data().analytics.counts.provisionalEntries} prov. entries &amp;{" "}
                  {data().analytics.counts.activeOrders} orders
                </p>
              </div>

              <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
                <div class="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <span>Final Spendings</span>
                  <TrendingDown class="h-4 w-4 text-slate-700" />
                </div>
                <div class="mt-2 text-2xl font-extrabold tabular-nums text-slate-900">
                  {formatEur(data().analytics.finalSpendingsCents)}
                </div>
                <p class="mt-1 text-xs text-slate-500">
                  {data().analytics.counts.finalSpendings} invoiced ·{" "}
                  <span class="text-orange-600 font-medium">
                    +{formatEur(data().analytics.provisionalSpendingsCents)} provisional
                  </span>
                </p>
              </div>

              <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
                <div class="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <span>Active Pipeline</span>
                  <Clock class="h-4 w-4 text-amber-600" />
                </div>
                <div class="mt-2 flex items-baseline gap-3">
                  <span class="text-2xl font-extrabold tabular-nums text-slate-900">
                    {data().analytics.counts.pendingReview +
                      data().analytics.counts.counterProposed +
                      data().analytics.counts.optionSelection}
                  </span>
                  <span class="text-xs text-slate-500">awaiting decisions</span>
                </div>
                <p class="mt-1 text-xs text-slate-500">
                  {data().analytics.counts.activeOrders} active orders waiting for invoices
                </p>
              </div>
            </div>

            {/* Department Chart + Action Queue */}
            <div class="grid gap-6 lg:grid-cols-12">
              <div class="lg:col-span-7 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
                <div class="flex items-center justify-between mb-4">
                  <h2 class="text-base font-bold text-slate-900">Spendings by Department</h2>
                  <A href="/budget?tab=by_department" class="text-xs font-semibold text-red-600 hover:underline">
                    Department dashboard
                  </A>
                </div>
                <DepartmentSpendChart rows={data().analytics.byDepartment} />
              </div>

              <div class="lg:col-span-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs flex flex-col">
                <div class="flex items-center justify-between mb-4">
                  <h2 class="text-base font-bold text-slate-900">Requests Requiring Action</h2>
                  <A href="/requests" class="text-xs font-semibold text-red-600 hover:underline">
                    View all
                  </A>
                </div>
                <Show
                  when={(actionQueue()?.length ?? 0) > 0}
                  fallback={
                    <div class="flex-1 flex flex-col items-center justify-center py-8 text-center text-sm text-slate-400">
                      <CheckCircle2 class="h-8 w-8 text-emerald-500 mb-2" />
                      No pending or countered requests right now.
                    </div>
                  }
                >
                  <div class="space-y-2.5">
                    <For each={actionQueue()}>
                      {item => (
                        <A
                          href={`/requests/${item.requestCode}`}
                          class="block rounded-xl border border-slate-100 bg-slate-50/70 p-3 hover:border-slate-300 hover:bg-white transition-colors"
                        >
                          <div class="flex items-center justify-between gap-2">
                            <span class="font-mono text-xs font-bold text-slate-700">
                              {item.requestCode}
                            </span>
                            <RequestStatusBadge status={item.status} />
                          </div>
                          <div class="mt-1 font-semibold text-sm text-slate-900 truncate">
                            {item.title}
                          </div>
                          <div class="mt-1.5 flex items-center justify-between text-xs text-slate-500">
                            <DepartmentBadge department={item.department} />
                            <span class="tabular-nums font-medium text-slate-700">
                              {formatEur(item.minPriceCents)}
                              <Show when={item.maxPriceCents > item.minPriceCents}>
                                {" – "}
                                {formatEur(item.maxPriceCents)}
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
              <div class="lg:col-span-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
                <div class="flex items-center justify-between mb-4">
                  <div class="flex items-center gap-2">
                    <Package class="h-4 w-4 text-orange-500" />
                    <h2 class="text-base font-bold text-slate-900">Active Orders (Provisional)</h2>
                  </div>
                  <A href="/orders" class="text-xs font-semibold text-red-600 hover:underline">
                    Manage orders
                  </A>
                </div>

                <Show
                  when={data().provisionalSpendings.length > 0}
                  fallback={
                    <p class="py-6 text-center text-sm text-slate-400">
                      No active orders awaiting invoices.
                    </p>
                  }
                >
                  <div class="divide-y divide-slate-100">
                    <For each={data().provisionalSpendings.slice(0, 5)}>
                      {ord => (
                        <A
                          href={`/requests/${ord.requestCode}`}
                          class="flex items-center justify-between py-3 hover:bg-slate-50 -mx-2 px-2 rounded-lg transition-colors"
                        >
                          <div class="min-w-0 pr-3">
                            <div class="flex items-center gap-2">
                              <span class="font-mono text-xs font-bold text-slate-700">
                                {ord.requestCode}
                              </span>
                              <DepartmentBadge department={ord.department} />
                            </div>
                            <div class="text-sm font-medium text-slate-900 truncate mt-0.5">
                              {ord.title}
                            </div>
                          </div>
                          <div class="text-right shrink-0">
                            <div class="text-sm font-bold tabular-nums text-orange-700">
                              {formatEur(ord.provisionalTotalCents)}
                            </div>
                            <div class="text-[11px] text-slate-400">{formatDate(ord.orderedAt)}</div>
                          </div>
                        </A>
                      )}
                    </For>
                  </div>
                </Show>
              </div>

              <div class="lg:col-span-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
                <div class="flex items-center justify-between mb-4">
                  <h2 class="text-base font-bold text-slate-900">Recent Activity Log</h2>
                  <A href="/logs" class="text-xs font-semibold text-red-600 hover:underline">
                    Full log
                  </A>
                </div>
                <Show
                  when={(recentLogs()?.length ?? 0) > 0}
                  fallback={<p class="py-6 text-center text-sm text-slate-400">No events logged yet.</p>}
                >
                  <div class="space-y-3">
                    <For each={recentLogs()}>
                      {log => (
                        <div class="flex items-start justify-between gap-3 text-xs border-b border-slate-100 pb-2.5 last:border-0">
                          <div class="min-w-0">
                            <div class="font-medium text-slate-900">{log.summary}</div>
                            <div class="text-slate-500 mt-0.5">{log.actorLabel}</div>
                          </div>
                          <span class="shrink-0 text-[11px] text-slate-400 whitespace-nowrap">
                            {formatDateTime(log.createdAt)}
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
