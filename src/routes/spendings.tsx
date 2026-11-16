import { Title } from "@solidjs/meta";
import { A, createAsync } from "@solidjs/router";
import { Download, Receipt } from "lucide-solid";
import { For, Show, Suspense, createMemo, createSignal } from "solid-js";
import { useApp, useI18n } from "~/components/AppContext";
import { DepartmentBadge } from "~/components/Badges";
import { SearchInputBar } from "~/components/SearchInputBar";
import { filterBudgetItemsByQuery } from "~/lib/budget-analytics";
import { formatDate, formatEur } from "~/lib/format";
import { queryBudgetSnapshot } from "~/server/rpc";

export default function SpendingsPage() {
  const app = useApp();
  const { locale, t } = useI18n();
  const [search, setSearch] = createSignal("");

  const snapshot = createAsync(() => {
    const sid = app.selectedSeasonId();
    if (!sid) return Promise.resolve(null);
    return queryBudgetSnapshot({ seasonId: sid, periodUnit: "month" });
  });

  const activeSnapshot = () => snapshot.latest ?? snapshot();

  const filteredSpendings = createMemo(() => {
    const data = activeSnapshot();
    if (!data) return [];
    return filterBudgetItemsByQuery(data.spendings, search());
  });

  const filteredTotalCents = createMemo(() =>
    filteredSpendings().reduce((sum, sp) => sum + sp.finalAmountCents, 0)
  );

  return (
    <div class="space-y-5">
      <Title>{t().spendings.pageTitle} — {t().appName}</Title>

      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold text-slate-900 dark:text-slate-100">{t().spendings.heading}</h1>
          <p class="text-sm text-slate-500 dark:text-slate-400">
            {t().spendings.subtitle}
          </p>
        </div>

        <Suspense>
          <Show when={activeSnapshot()}>
            {data => (
              <div class="rounded-xl border border-emerald-200 dark:border-emerald-900/70 bg-emerald-50 dark:bg-emerald-950/50 px-4 py-2.5 text-right">
                <div class="text-[11px] font-semibold uppercase text-emerald-700 dark:text-emerald-400">
                  {t().spendings.totalBanner}
                </div>
                <div class="text-xl font-extrabold tabular-nums text-emerald-900 dark:text-emerald-200">
                  {formatEur(data().analytics.finalSpendingsCents, locale())}
                </div>
              </div>
            )}
          </Show>
        </Suspense>
      </div>

      <Suspense
        fallback={
          <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-400 dark:text-slate-500">
            {t().spendings.loading}
          </div>
        }
      >
        <Show
          when={activeSnapshot()}
          fallback={
            <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-400 dark:text-slate-500">
              {t().spendings.loading}
            </div>
          }
        >
        {data => (
          <Show
            when={data().spendings.length > 0}
            fallback={
              <div class="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-12 text-center space-y-2">
                <Receipt class="h-8 w-8 text-slate-300 dark:text-slate-600 mx-auto" />
                <p class="text-sm font-medium text-slate-600 dark:text-slate-400">
                  {t().spendings.empty}
                </p>
              </div>
            }
          >
            <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
              <div class="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <SearchInputBar
                  value={search()}
                  onInput={setSearch}
                  placeholder={t().spendings.searchPlaceholder}
                  class="w-full sm:max-w-md"
                />
                <div class="text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-400 tabular-nums shrink-0">
                  <Show
                    when={search().trim().length > 0}
                    fallback={<span>{t().spendings.spendingCount(data().spendings.length)}</span>}
                  >
                    <span>
                      {t().spendings.showingCount(filteredSpendings().length, data().spendings.length)} ·{" "}
                      <strong class="text-emerald-800 dark:text-emerald-400">{formatEur(filteredTotalCents(), locale())}</strong>
                    </span>
                  </Show>
                </div>
              </div>
              <div class="overflow-x-auto">
                <table class="w-full text-left text-sm">
                  <thead class="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <tr>
                      <th class="px-4 py-3">{t().common.idLabel}</th>
                      <th class="px-4 py-3">{t().spendings.colProductOption}</th>
                      <th class="px-4 py-3">{t().common.department}</th>
                      <th class="px-4 py-3 text-right">{t().spendings.colBaseFees}</th>
                      <th class="px-4 py-3 text-right">{t().spendings.colFinalInvoiced}</th>
                      <th class="px-4 py-3">{t().spendings.colInvoicedOn}</th>
                      <th class="px-4 py-3">{t().spendings.colInvoiceFile}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                    <Show
                      when={filteredSpendings().length > 0}
                      fallback={
                        <tr>
                          <td colSpan={7} class="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                            {t().spendings.noMatchPrefix} "<span class="font-semibold text-slate-700 dark:text-slate-200">{search()}</span>".{" "}
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
                      <For each={filteredSpendings()}>
                        {sp => {
                          const invoiceAtt = () => sp.attachments.find(a => a.kind === "invoice");
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
                            <td class="px-4 py-3 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">
                              {formatEur(sp.basePriceCents, locale())} + {formatEur(sp.shippingCents + sp.importFeeCents, locale())}
                            </td>
                            <td class="px-4 py-3 text-right tabular-nums font-extrabold text-emerald-800 dark:text-emerald-400">
                              {formatEur(sp.finalAmountCents, locale())}
                            </td>
                            <td class="px-4 py-3 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                              {formatDate(sp.effectiveDate, locale())}
                            </td>
                            <td class="px-4 py-3">
                              <Show
                                when={invoiceAtt()}
                                fallback={<span class="text-xs text-slate-400 dark:text-slate-500">—</span>}
                              >
                                {att => (
                                  <a
                                    href={`/api/files/${att().id}`}
                                    download={att().originalName}
                                    rel="external"
                                    class="inline-flex items-center gap-1 rounded-lg border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60"
                                  >
                                    <Download class="h-3.5 w-3.5" />
                                    {t().spendings.invoiceDownload}
                                  </a>
                                )}
                              </Show>
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
          </Show>
          )}
        </Show>
      </Suspense>
    </div>
  );
}
