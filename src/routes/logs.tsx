import { Title } from "@solidjs/meta";
import { A, createAsync } from "@solidjs/router";
import { Activity } from "lucide-solid";
import { For, Show, Suspense, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { useApp, useI18n } from "~/components/AppContext";
import { SearchInputBar } from "~/components/SearchInputBar";
import { filterAuditLogsByQuery } from "~/lib/budget-analytics";
import { formatDateTime } from "~/lib/format";
import { getAuditActionLabel } from "~/lib/i18n";
import { queryAuditLogs } from "~/server/rpc";

export default function LogsPage() {
  const app = useApp();
  const { locale, t } = useI18n();
  const [scope, setScope] = createSignal<"season" | "all">("season");
  const [search, setSearch] = createSignal("");
  const [debouncedSearch, setDebouncedSearch] = createSignal("");

  createEffect(() => {
    const val = search().trim();
    if (!val) {
      setDebouncedSearch("");
      return;
    }
    const timer = setTimeout(() => setDebouncedSearch(val), 250);
    onCleanup(() => clearTimeout(timer));
  });

  const logs = createAsync(async () => {
    const sid = scope() === "season" ? app.selectedSeasonId() : "all";
    return queryAuditLogs({ seasonId: sid, search: debouncedSearch() });
  });

  // Read `logs.latest` during search updates so already-mounted search inputs and lists never suspend or blur.
  const visibleRows = createMemo(() => {
    const resolved = logs.latest ?? logs();
    if (!resolved) return null;
    return filterAuditLogsByQuery(resolved, search());
  });

  return (
    <div class="space-y-5">
      <Title>{t().logs.pageTitle} — {t().appName}</Title>

      <div>
        <h1 class="text-2xl font-bold text-slate-900 dark:text-slate-100">{t().logs.heading}</h1>
        <p class="text-sm text-slate-500 dark:text-slate-400">
          {t().logs.subtitle}
        </p>
      </div>

      <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs flex flex-col sm:flex-row gap-3">
        <SearchInputBar
          value={search()}
          onInput={setSearch}
          placeholder={t().logs.searchPlaceholder}
          class="flex-1"
        />

        <select
          value={scope()}
          onChange={e => setScope(e.currentTarget.value as "season" | "all")}
          class="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-red-500 focus:outline-none"
        >
          <option value="season">{t().logs.scopeSelectedSeason}</option>
          <option value="all">{t().logs.scopeAllSeasons}</option>
        </select>
      </div>

      <Suspense
        fallback={
          <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-400 dark:text-slate-500">
            {t().logs.loading}
          </div>
        }
      >
        <Show
          when={visibleRows()}
          fallback={
            <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-400 dark:text-slate-500">
              {t().logs.loading}
            </div>
          }
        >
          {rows => (
          <Show
            when={rows().length > 0}
            fallback={
              <div class="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-12 text-center">
                <Activity class="h-8 w-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                <p class="text-sm text-slate-500 dark:text-slate-400">{t().logs.empty}</p>
              </div>
            }
          >
            <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs divide-y divide-slate-100 dark:divide-slate-800">
              <For each={rows()}>
                {log => (
                  <div class="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                    <div class="space-y-1 min-w-0">
                      <div class="flex flex-wrap items-center gap-2">
                        <span
                          title={log.action}
                          class="rounded bg-slate-900 dark:bg-slate-800 border border-transparent dark:border-slate-700 px-2 py-0.5 font-mono text-[11px] font-semibold text-white dark:text-slate-200"
                        >
                          {getAuditActionLabel(locale(), log.action)}
                        </span>
                        <Show when={log.targetType === "request" && log.targetCode}>
                          <A
                            href={`/requests/${log.targetCode}`}
                            class="font-mono text-xs font-bold text-red-600 dark:text-red-400 hover:underline"
                          >
                            {log.targetCode}
                          </A>
                        </Show>
                        <Show when={log.targetType !== "request" && log.targetCode}>
                          <span class="font-mono text-xs font-semibold text-slate-600 dark:text-slate-400">
                            {log.targetCode}
                          </span>
                        </Show>
                      </div>
                      <div class="text-sm font-medium text-slate-900 dark:text-slate-100">{log.summary}</div>
                      <div class="text-xs text-slate-500 dark:text-slate-400">
                        {t().logs.actorPrefix} {log.actorLabel}
                      </div>
                    </div>

                    <div class="text-xs text-slate-400 dark:text-slate-500 shrink-0 whitespace-nowrap">
                      {formatDateTime(log.createdAt, locale())}
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
          )}
        </Show>
      </Suspense>
    </div>
  );
}
