import { Title } from "@solidjs/meta";
import { A, createAsync } from "@solidjs/router";
import { Activity, Search } from "lucide-solid";
import { For, Show, createSignal } from "solid-js";
import { useApp } from "~/components/AppContext";
import { formatDateTime } from "~/lib/format";
import { queryAuditLogs } from "~/server/rpc";

export default function LogsPage() {
  const app = useApp();
  const [scope, setScope] = createSignal<"season" | "all">("season");
  const [search, setSearch] = createSignal("");

  const logs = createAsync(async () => {
    const sid = scope() === "season" ? app.selectedSeasonId() : "all";
    return queryAuditLogs({ seasonId: sid, search: search() });
  });

  return (
    <div class="space-y-5">
      <Title>Global Audit Log — INSA Racing Achats</Title>

      <div>
        <h1 class="text-2xl font-bold text-slate-900">Global Audit &amp; Activity Log</h1>
        <p class="text-sm text-slate-500">
          Complete immutable record of requests, counter-propositions, order updates, invoices, money entries, exports, and user management visible to all team members.
        </p>
      </div>

      <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs flex flex-col sm:flex-row gap-3">
        <div class="relative flex-1">
          <Search class="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search()}
            onInput={e => setSearch(e.currentTarget.value)}
            placeholder="Search by ID (e.g. 26-AERO-004), member, or action..."
            class="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-2 text-sm focus:border-red-500 focus:outline-none"
          />
        </div>

        <select
          value={scope()}
          onChange={e => setScope(e.currentTarget.value as "season" | "all")}
          class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
        >
          <option value="season">Selected Season Only</option>
          <option value="all">All Seasons + System Events</option>
        </select>
      </div>

      <Show
        when={logs()}
        fallback={
          <div class="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
            Loading activity logs...
          </div>
        }
      >
        {rows => (
          <Show
            when={rows().length > 0}
            fallback={
              <div class="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
                <Activity class="h-8 w-8 text-slate-300 mx-auto mb-2" />
                <p class="text-sm text-slate-500">No log entries found for this filter.</p>
              </div>
            }
          >
            <div class="rounded-2xl border border-slate-200 bg-white shadow-xs divide-y divide-slate-100">
              <For each={rows()}>
                {log => (
                  <div class="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-slate-50/70">
                    <div class="space-y-1 min-w-0">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="rounded bg-slate-900 px-2 py-0.5 font-mono text-[11px] font-semibold text-white">
                          {log.action}
                        </span>
                        <Show when={log.targetType === "request" && log.targetCode}>
                          <A
                            href={`/requests/${log.targetCode}`}
                            class="font-mono text-xs font-bold text-red-600 hover:underline"
                          >
                            {log.targetCode}
                          </A>
                        </Show>
                        <Show when={log.targetType !== "request" && log.targetCode}>
                          <span class="font-mono text-xs font-semibold text-slate-600">
                            {log.targetCode}
                          </span>
                        </Show>
                      </div>
                      <div class="text-sm font-medium text-slate-900">{log.summary}</div>
                      <div class="text-xs text-slate-500">Actor: {log.actorLabel}</div>
                    </div>

                    <div class="text-xs text-slate-400 shrink-0 whitespace-nowrap">
                      {formatDateTime(log.createdAt)}
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        )}
      </Show>
    </div>
  );
}
