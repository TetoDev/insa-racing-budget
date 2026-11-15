import { Title } from "@solidjs/meta";
import { A, createAsync } from "@solidjs/router";
import { ArrowRight, Package } from "lucide-solid";
import { For, Show, createMemo, createSignal } from "solid-js";
import { useApp } from "~/components/AppContext";
import { DepartmentBadge } from "~/components/Badges";
import { SearchInputBar } from "~/components/SearchInputBar";
import { filterBudgetItemsByQuery } from "~/lib/budget-analytics";
import { formatDate, formatEur } from "~/lib/format";
import { queryBudgetSnapshot } from "~/server/rpc";

export default function OrdersPage() {
  const app = useApp();
  const [search, setSearch] = createSignal("");

  const snapshot = createAsync(async () => {
    const sid = app.selectedSeasonId();
    if (!sid) return null;
    return queryBudgetSnapshot({ seasonId: sid, periodUnit: "month" });
  });

  const filteredOrders = createMemo(() => {
    const data = snapshot();
    return data ? filterBudgetItemsByQuery(data.provisionalSpendings, search()) : [];
  });

  const filteredTotalCents = createMemo(() =>
    filteredOrders().reduce((sum, ord) => sum + ord.provisionalTotalCents, 0)
  );

  return (
    <div class="space-y-5">
      <Title>Orders (Provisional Spendings) — INSA Racing Achats</Title>

      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold text-slate-900">Orders — Provisional Spendings</h1>
          <p class="text-sm text-slate-500">
            Confirmed buying options awaiting final invoices. Approvers can add shipping/import fees or upload the invoice inside each order.
          </p>
        </div>

        <Show when={snapshot()}>
          {data => (
            <div class="rounded-xl border border-orange-200 bg-orange-50 px-4 py-2.5 text-right">
              <div class="text-[11px] font-semibold uppercase text-orange-700">
                Total Provisional Spendings
              </div>
              <div class="text-xl font-extrabold tabular-nums text-orange-900">
                {formatEur(data().analytics.provisionalSpendingsCents)}
              </div>
            </div>
          )}
        </Show>
      </div>

      <Show
        when={snapshot()}
        fallback={
          <div class="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
            Loading active orders...
          </div>
        }
      >
        {data => (
          <Show
            when={data().provisionalSpendings.length > 0}
            fallback={
              <div class="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center space-y-2">
                <Package class="h-8 w-8 text-slate-300 mx-auto" />
                <p class="text-sm font-medium text-slate-600">
                  No active orders awaiting invoices in this season.
                </p>
              </div>
            }
          >
            <div class="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
              <div class="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <SearchInputBar
                  value={search()}
                  onInput={setSearch}
                  placeholder="Search orders by ID (e.g. 26-AERO-001), product, option, or car system..."
                  class="w-full sm:max-w-md"
                />
                <div class="text-xs sm:text-sm font-semibold text-slate-600 tabular-nums shrink-0">
                  <Show
                    when={search().trim().length > 0}
                    fallback={<span>{data().provisionalSpendings.length} active order(s)</span>}
                  >
                    <span>
                      Showing {filteredOrders().length} of {data().provisionalSpendings.length} ·{" "}
                      <strong class="text-orange-700">{formatEur(filteredTotalCents())}</strong>
                    </span>
                  </Show>
                </div>
              </div>
              <div class="overflow-x-auto">
                <table class="w-full text-left text-sm">
                  <thead class="bg-slate-50 border-b border-slate-200 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th class="px-4 py-3">ID</th>
                      <th class="px-4 py-3">Order &amp; Option</th>
                      <th class="px-4 py-3">Department</th>
                      <th class="px-4 py-3 text-right">Base</th>
                      <th class="px-4 py-3 text-right">Shipping</th>
                      <th class="px-4 py-3 text-right">Import</th>
                      <th class="px-4 py-3 text-right">Provisional Total</th>
                      <th class="px-4 py-3">Ordered</th>
                      <th class="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">
                    <Show
                      when={filteredOrders().length > 0}
                      fallback={
                        <tr>
                          <td colSpan={9} class="px-4 py-10 text-center text-sm text-slate-500">
                            No active orders match "<span class="font-semibold text-slate-700">{search()}</span>".{" "}
                            <button
                              type="button"
                              onClick={() => setSearch("")}
                              class="text-red-600 font-semibold hover:underline cursor-pointer"
                            >
                              Clear search
                            </button>
                          </td>
                        </tr>
                      }
                    >
                      <For each={filteredOrders()}>
                        {ord => (
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
                              <Show when={ord.carSystem}>
                                <div class="mt-1 inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                                  {ord.carSystem}
                                </div>
                              </Show>
                            </td>
                            <td class="px-4 py-3">
                              <DepartmentBadge department={ord.department} />
                            </td>
                            <td class="px-4 py-3 text-right tabular-nums text-slate-700">
                              {formatEur(ord.basePriceCents)}
                            </td>
                            <td class="px-4 py-3 text-right tabular-nums text-slate-700">
                              {formatEur(ord.shippingCents)}
                            </td>
                            <td class="px-4 py-3 text-right tabular-nums text-slate-700">
                              {formatEur(ord.importFeeCents)}
                            </td>
                            <td class="px-4 py-3 text-right tabular-nums font-bold text-orange-700">
                              {formatEur(ord.provisionalTotalCents)}
                            </td>
                            <td class="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                              {formatDate(ord.orderedAt)}
                            </td>
                            <td class="px-4 py-3 text-right whitespace-nowrap">
                              <A
                                href={`/requests/${ord.requestCode}`}
                                class="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                              >
                                Manage / Invoice
                                <ArrowRight class="h-3 w-3" />
                              </A>
                            </td>
                          </tr>
                        )}
                      </For>
                    </Show>
                  </tbody>
                </table>
              </div>
            </div>
          </Show>
        )}
      </Show>
    </div>
  );
}
