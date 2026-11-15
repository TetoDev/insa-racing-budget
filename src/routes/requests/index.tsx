import { Title } from "@solidjs/meta";
import { A, createAsync } from "@solidjs/router";
import { FileText, Image as ImageIcon, PlusCircle, Search } from "lucide-solid";
import { For, Show, createSignal } from "solid-js";
import { useApp } from "~/components/AppContext";
import { DepartmentBadge, RequestStatusBadge, UserAvatar } from "~/components/Badges";
import { DEPARTMENTS, type DepartmentId, type RequestStatus } from "~/lib/constants";
import { formatDate, formatEur } from "~/lib/format";
import { canCreateRequest } from "~/lib/permissions";
import { queryRequestsList } from "~/server/rpc";

const STATUS_FILTERS: Array<{ value: RequestStatus | "all" | "archived"; label: string }> = [
  { value: "all", label: "All" },
  { value: "pending_review", label: "Pending Review" },
  { value: "counter_proposed", label: "Counter-Proposed" },
  { value: "option_selection", label: "Option Selection" },
  { value: "order", label: "Orders" },
  { value: "spending", label: "Final Spendings" },
  { value: "archived", label: "Archived" }
];

export default function RequestsListPage() {
  const app = useApp();
  const [status, setStatus] = createSignal<RequestStatus | "all" | "archived">("all");
  const [department, setDepartment] = createSignal<DepartmentId | "all">("all");
  const [search, setSearch] = createSignal("");

  const requests = createAsync(() => {
    const sid = app.selectedSeasonId();
    if (!sid) return Promise.resolve([]);
    return queryRequestsList({
      seasonId: sid,
      status: status(),
      department: department(),
      search: search()
    });
  });

  return (
    <div class="space-y-5">
      <Title>Purchase Requests — INSA Racing Achats</Title>

      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold text-slate-900">Purchase Requests</h1>
          <p class="text-sm text-slate-500">
            All requests, counter-propositions, confirmed orders, and archived items are visible team-wide.
          </p>
        </div>

        <Show when={canCreateRequest(app.user()?.role) && !app.isViewingArchived()}>
          <A
            href="/requests/new"
            class="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            <PlusCircle class="h-4 w-4" />
            New Purchase Request
          </A>
        </Show>
      </div>

      {/* Filters */}
      <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
        <div class="flex flex-wrap gap-1.5">
          <For each={STATUS_FILTERS}>
            {tab => (
              <button
                type="button"
                onClick={() => setStatus(tab.value)}
                class={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                  status() === tab.value
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {tab.label}
              </button>
            )}
          </For>
        </div>

        <div class="grid sm:grid-cols-3 gap-3">
          <div class="relative sm:col-span-2">
            <Search class="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search()}
              onInput={e => setSearch(e.currentTarget.value)}
              placeholder="Search by ID (e.g. 26-AERO-004), title, car system, or justification..."
              class="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-2 text-sm focus:border-red-500 focus:outline-none"
            />
          </div>

          <select
            value={department()}
            onChange={e => setDepartment(e.currentTarget.value as DepartmentId | "all")}
            class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
          >
            <option value="all">All Departments</option>
            <For each={DEPARTMENTS}>
              {dept => <option value={dept.id}>{dept.label} ({dept.code})</option>}
            </For>
          </select>
        </div>
      </div>

      {/* List */}
      <Show
        when={requests()}
        fallback={
          <div class="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
            Loading requests...
          </div>
        }
      >
        {items => (
          <Show
            when={items().length > 0}
            fallback={
              <div class="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center space-y-3">
                <p class="text-sm font-medium text-slate-600">No purchase requests match your filters.</p>
                <div class="flex flex-wrap items-center justify-center gap-2">
                  <Show when={status() !== "all" || department() !== "all" || search().trim() !== ""}>
                    <button
                      type="button"
                      onClick={() => {
                        setStatus("all");
                        setDepartment("all");
                        setSearch("");
                      }}
                      class="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      Clear filters
                    </button>
                  </Show>
                  <Show when={canCreateRequest(app.user()?.role) && !app.isViewingArchived()}>
                    <A
                      href="/requests/new"
                      class="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-red-700"
                    >
                      <PlusCircle class="h-3.5 w-3.5" />
                      Create Request
                    </A>
                  </Show>
                </div>
              </div>
            }
          >
            <div class="grid gap-3">
              <For each={items()}>
                {req => (
                  <A
                    href={`/requests/${req.requestCode}`}
                    class="group rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs hover:border-slate-300 hover:shadow-md transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div class="flex items-start gap-4 min-w-0">
                      <Show
                        when={req.firstPhotoId}
                        fallback={
                          <div class="hidden sm:flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                            <ImageIcon class="h-6 w-6" />
                          </div>
                        }
                      >
                        {photoId => (
                          <img
                            src={`/api/files/${photoId()}?inline=1`}
                            alt={req.title}
                            class="hidden sm:block h-16 w-16 shrink-0 rounded-xl object-cover border border-slate-200"
                          />
                        )}
                      </Show>

                      <div class="min-w-0 space-y-1.5">
                        <div class="flex flex-wrap items-center gap-2">
                          <span class="rounded-md bg-slate-900 px-2 py-0.5 font-mono text-xs font-bold text-white">
                            {req.requestCode}
                          </span>
                          <DepartmentBadge department={req.department} />
                          <RequestStatusBadge status={req.status} />
                          <Show when={req.carSystem}>
                            <span class="rounded-md bg-slate-100 border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                              {req.carSystem}
                            </span>
                          </Show>
                        </div>

                        <h2 class="text-base font-bold text-slate-900 group-hover:text-red-600 transition-colors truncate">
                          {req.title}
                        </h2>

                        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                          <span class="inline-flex items-center gap-1.5">
                            <UserAvatar
                              name={req.creatorName}
                              avatarId={req.creatorAvatarId}
                              size="sm"
                            />
                            <span>
                              {req.creatorName} · {req.creatorTitle}
                            </span>
                          </span>
                          <span>{formatDate(req.createdAt)}</span>
                          <span>{req.optionCount} option(s)</span>
                          <Show when={req.photoCount > 0 || req.docCount > 0}>
                            <span class="inline-flex items-center gap-1">
                              <FileText class="h-3.5 w-3.5" />
                              {req.photoCount} photo(s), {req.docCount} doc(s)
                            </span>
                          </Show>
                        </div>
                      </div>
                    </div>

                    <div class="sm:text-right shrink-0 flex sm:flex-col items-center sm:items-end justify-between border-t sm:border-0 border-slate-100 pt-3 sm:pt-0">
                      <div class="text-xs uppercase tracking-wider text-slate-400 font-semibold">
                        {req.effectiveTotalCents !== null ? "Committed Cost" : "Options Range"}
                      </div>
                      <div class="text-lg font-extrabold tabular-nums text-slate-900">
                        <Show
                          when={req.effectiveTotalCents !== null}
                          fallback={
                            <>
                              {formatEur(req.minPriceCents)}
                              <Show when={req.maxPriceCents > req.minPriceCents}>
                                {" – "}
                                {formatEur(req.maxPriceCents)}
                              </Show>
                            </>
                          }
                        >
                          {formatEur(req.effectiveTotalCents!)}
                        </Show>
                      </div>
                    </div>
                  </A>
                )}
              </For>
            </div>
          </Show>
        )}
      </Show>
    </div>
  );
}
