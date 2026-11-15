import { Title } from "@solidjs/meta";
import { A, createAsync } from "@solidjs/router";
import { Download, Receipt } from "lucide-solid";
import { For, Show, createMemo, createSignal } from "solid-js";
import { useApp } from "~/components/AppContext";
import { DepartmentBadge } from "~/components/Badges";
import { SearchInputBar } from "~/components/SearchInputBar";
import { filterBudgetItemsByQuery } from "~/lib/budget-analytics";
import { formatDate, formatEur } from "~/lib/format";
import { queryBudgetSnapshot } from "~/server/rpc";

export default function SpendingsPage() {
  const app = useApp();
  const [search, setSearch] = createSignal("");

  const snapshot = createAsync(() => {
    const sid = app.selectedSeasonId();
    if (!sid) return Promise.resolve(null);
    return queryBudgetSnapshot({ seasonId: sid, periodUnit: "month" });
  });

  const filteredSpendings = createMemo(() => {
    const data = snapshot();
    if (!data) return [];
    return filterBudgetItemsByQuery(data.spendings, search());
  });

  const filteredTotalCents = createMemo(() =>
    filteredSpendings().reduce((sum, sp) => sum + sp.finalAmountCents, 0)
  );

  return (
    <div class="space-y-5">
      <Title>Final Spendings — INSA Racing Achats</Title>

      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold text-slate-900">All Final Spendings</h1>
          <p class="text-sm text-slate-500">
            Orders finalized with an uploaded invoice and counted toward the final season budget.
          </p>
        </div>

        <Show when={snapshot()}>
          {data => (
            <div class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-right">
              <div class="text-[11px] font-semibold uppercase text-emerald-700">
                Total Final Spendings
              </div>
              <div class="text-xl font-extrabold tabular-nums text-emerald-900">
                {formatEur(data().analytics.finalSpendingsCents)}
              </div>
            </div>
          )}
        </Show>
      </div>

      <Show
        when={snapshot()}
        fallback={
          <div class="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
            Loading final spendings...
          </div>
        }
      >
        {data => (
          <Show
            when={data().spendings.length > 0}
            fallback={
              <div class="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center space-y-2">
                <Receipt class="h-8 w-8 text-slate-300 mx-auto" />
                <p class="text-sm font-medium text-slate-600">
                  No invoiced spendings recorded yet for this season.
                </p>
              </div>
            }
          >
            <div class="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
              <div class="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <SearchInputBar
                  value={search()}
                  onInput={setSearch}
                  placeholder="Search by ID (e.g. 26-AERO-001), product name, option, or car system..."
                  class="w-full sm:max-w-md"
                />
                <div class="text-xs sm:text-sm font-semibold text-slate-600 tabular-nums shrink-0">
                  <Show
                    when={search().trim().length > 0}
                    fallback={<span>{data().spendings.length} final spending(s)</span>}
                  >
                    <span>
                      Showing {filteredSpendings().length} of {data().spendings.length} ·{" "}
                      <strong class="text-emerald-800">{formatEur(filteredTotalCents())}</strong>
                    </span>
                  </Show>
                </div>
              </div>
              <div class="overflow-x-auto">
                <table class="w-full text-left text-sm">
                  <thead class="bg-slate-50 border-b border-slate-200 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th class="px-4 py-3">ID</th>
                      <th class="px-4 py-3">Product &amp; Chosen Option</th>
                      <th class="px-4 py-3">Department</th>
                      <th class="px-4 py-3 text-right">Base + Fees</th>
                      <th class="px-4 py-3 text-right">Final Invoiced</th>
                      <th class="px-4 py-3">Invoiced On</th>
                      <th class="px-4 py-3">Invoice File</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">
                    <Show
                      when={filteredSpendings().length > 0}
                      fallback={
                        <tr>
                          <td colSpan={7} class="px-4 py-10 text-center text-sm text-slate-500">
                            No spendings match "<span class="font-semibold text-slate-700">{search()}</span>".{" "}
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
                      <For each={filteredSpendings()}>
                        {sp => {
                          const invoiceAtt = () => sp.attachments.find(a => a.kind === "invoice");
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
                            <td class="px-4 py-3 text-right text-xs tabular-nums text-slate-500">
                              {formatEur(sp.basePriceCents)} + {formatEur(sp.shippingCents + sp.importFeeCents)}
                            </td>
                            <td class="px-4 py-3 text-right tabular-nums font-extrabold text-emerald-800">
                              {formatEur(sp.finalAmountCents)}
                            </td>
                            <td class="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                              {formatDate(sp.effectiveDate)}
                            </td>
                            <td class="px-4 py-3">
                              <Show
                                when={invoiceAtt()}
                                fallback={<span class="text-xs text-slate-400">—</span>}
                              >
                                {att => (
                                  <a
                                    href={`/api/files/${att().id}`}
                                    class="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                                  >
                                    <Download class="h-3.5 w-3.5" />
                                    Invoice
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
    </div>
  );
}
