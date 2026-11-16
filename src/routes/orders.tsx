import { Title } from "@solidjs/meta";
import { A, createAsync } from "@solidjs/router";
import { ArrowRight, Package } from "lucide-solid";
import { For, Show, Suspense, createMemo, createSignal } from "solid-js";
import { useApp, useI18n } from "~/components/AppContext";
import { DepartmentBadge } from "~/components/Badges";
import { SearchInputBar } from "~/components/SearchInputBar";
import { filterBudgetItemsByQuery } from "~/lib/budget-analytics";
import { formatDate, formatEur } from "~/lib/format";
import { queryBudgetSnapshot } from "~/server/rpc";

export default function OrdersPage() {
  const app = useApp();
  const { locale, t } = useI18n();
  const [search, setSearch] = createSignal("");

  const snapshot = createAsync(async () => {
    const sid = app.selectedSeasonId();
    if (!sid) return null;
    return queryBudgetSnapshot({ seasonId: sid, periodUnit: "month" });
  });

  const activeSnapshot = () => snapshot.latest ?? snapshot();

  const filteredOrders = createMemo(() => {
    const data = activeSnapshot();
    return data ? filterBudgetItemsByQuery(data.provisionalSpendings, search()) : [];
  });

  const filteredTotalCents = createMemo(() =>
    filteredOrders().reduce((sum, ord) => sum + ord.provisionalTotalCents, 0)
  );

  return (
    <div class="space-y-5">
      <Title>{t().orders.pageTitle} — {t().appName}</Title>

      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold text-slate-900 dark:text-slate-100">{t().orders.heading}</h1>
          <p class="text-sm text-slate-500 dark:text-slate-400">
            {t().orders.subtitle}
          </p>
        </div>

        <Suspense>
          <Show when={activeSnapshot()}>
            {data => (
              <div class="rounded-xl border border-orange-200 dark:border-orange-900/70 bg-orange-50 dark:bg-orange-950/50 px-4 py-2.5 text-right">
                <div class="text-[11px] font-semibold uppercase text-orange-700 dark:text-orange-400">
                  {t().orders.totalBanner}
                </div>
                <div class="text-xl font-extrabold tabular-nums text-orange-900 dark:text-orange-200">
                  {formatEur(data().analytics.provisionalSpendingsCents, locale())}
                </div>
              </div>
            )}
          </Show>
        </Suspense>
      </div>

      <Suspense
        fallback={
          <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-400 dark:text-slate-500">
            {t().orders.loading}
          </div>
        }
      >
        <Show
          when={activeSnapshot()}
          fallback={
            <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-400 dark:text-slate-500">
              {t().orders.loading}
            </div>
          }
        >
        {data => (
          <Show
            when={data().provisionalSpendings.length > 0}
            fallback={
              <div class="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-12 text-center space-y-2">
                <Package class="h-8 w-8 text-slate-300 dark:text-slate-600 mx-auto" />
                <p class="text-sm font-medium text-slate-600 dark:text-slate-400">
                  {t().orders.empty}
                </p>
              </div>
            }
          >
            <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
              <div class="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <SearchInputBar
                  value={search()}
                  onInput={setSearch}
                  placeholder={t().orders.searchPlaceholder}
                  class="w-full sm:max-w-md"
                />
                <div class="text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-400 tabular-nums shrink-0">
                  <Show
                    when={search().trim().length > 0}
                    fallback={<span>{t().orders.activeCount(data().provisionalSpendings.length)}</span>}
                  >
                    <span>
                      {t().orders.showingCount(filteredOrders().length, data().provisionalSpendings.length)} ·{" "}
                      <strong class="text-orange-700 dark:text-orange-400">{formatEur(filteredTotalCents(), locale())}</strong>
                    </span>
                  </Show>
                </div>
              </div>
              <div class="overflow-x-auto">
                <table class="w-full text-left text-sm">
                  <thead class="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <tr>
                      <th class="px-4 py-3">{t().common.idLabel}</th>
                      <th class="px-4 py-3">{t().orders.colOrderOption}</th>
                      <th class="px-4 py-3">{t().common.department}</th>
                      <th class="px-4 py-3 text-right">{t().orders.colBase}</th>
                      <th class="px-4 py-3 text-right">{t().orders.colShipping}</th>
                      <th class="px-4 py-3 text-right">{t().orders.colImport}</th>
                      <th class="px-4 py-3 text-right">{t().orders.colProvTotal}</th>
                      <th class="px-4 py-3">{t().orders.colOrdered}</th>
                      <th class="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                    <Show
                      when={filteredOrders().length > 0}
                      fallback={
                        <tr>
                          <td colSpan={9} class="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                            {t().orders.noMatchPrefix} "<span class="font-semibold text-slate-700 dark:text-slate-200">{search()}</span>".{" "}
                            <button
                              type="button"
                              onClick={() => setSearch("")}
                              class="text-red-600 dark:text-red-400 font-semibold hover:underline cursor-pointer"
                            >
                              {t().common.clearSearch}
                            </button>
                          </td>
                        </tr>
                      }
                    >
                      <For each={filteredOrders()}>
                        {ord => (
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
                              <Show when={ord.carSystem}>
                                <div class="mt-1 inline-flex items-center rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300">
                                  {ord.carSystem}
                                </div>
                              </Show>
                            </td>
                            <td class="px-4 py-3">
                              <DepartmentBadge department={ord.department} />
                            </td>
                            <td class="px-4 py-3 text-right tabular-nums text-slate-700 dark:text-slate-300">
                              {formatEur(ord.basePriceCents, locale())}
                            </td>
                            <td class="px-4 py-3 text-right tabular-nums text-slate-700 dark:text-slate-300">
                              {formatEur(ord.shippingCents, locale())}
                            </td>
                            <td class="px-4 py-3 text-right tabular-nums text-slate-700 dark:text-slate-300">
                              {formatEur(ord.importFeeCents, locale())}
                            </td>
                            <td class="px-4 py-3 text-right tabular-nums font-bold text-orange-700 dark:text-orange-400">
                              {formatEur(ord.provisionalTotalCents, locale())}
                            </td>
                            <td class="px-4 py-3 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                              {formatDate(ord.orderedAt, locale())}
                            </td>
                            <td class="px-4 py-3 text-right whitespace-nowrap">
                              <A
                                href={`/requests/${ord.requestCode}`}
                                class="inline-flex items-center gap-1 rounded-lg bg-slate-900 dark:bg-slate-100 px-3 py-1.5 text-xs font-semibold text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-white"
                              >
                                {t().orders.manageInvoiceBtn}
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
      </Suspense>
    </div>
  );
}
