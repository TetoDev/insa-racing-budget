import { Title } from "@solidjs/meta";
import { A, createAsync } from "@solidjs/router";
import { FileText, Image as ImageIcon, PlusCircle } from "lucide-solid";
import { For, Show, Suspense, createMemo, createSignal } from "solid-js";
import { useApp, useI18n } from "~/components/AppContext";
import { DepartmentBadge, RequestStatusBadge, UserAvatar } from "~/components/Badges";
import { SearchInputBar } from "~/components/SearchInputBar";
import { filterRequestsByQuery } from "~/lib/budget-analytics";
import { DEPARTMENTS, type DepartmentId, type RequestStatus } from "~/lib/constants";
import { formatDate, formatEur } from "~/lib/format";
import { getDepartmentLabel } from "~/lib/i18n";
import { canCreateRequest } from "~/lib/permissions";
import { queryRequestsList } from "~/server/rpc";

export default function RequestsListPage() {
  const app = useApp();
  const { locale, t } = useI18n();
  const [status, setStatus] = createSignal<RequestStatus | "all" | "archived">("all");
  const [department, setDepartment] = createSignal<DepartmentId | "all">("all");
  const [search, setSearch] = createSignal("");

  const statusFilters = (): Array<{
    value: RequestStatus | "all" | "archived";
    label: string;
  }> => {
    const f = t().requests.filters;
    return [
      { value: "all", label: f.all },
      { value: "pending_review", label: f.pending_review },
      { value: "counter_proposed", label: f.counter_proposed },
      { value: "option_selection", label: f.option_selection },
      { value: "order", label: f.order },
      { value: "spending", label: f.spending },
      { value: "archived", label: f.archived }
    ];
  };

  // Fetch once per season; filter status, department, and search client-side so typing never suspends/unmounts the search bar.
  const requests = createAsync(() => {
    const sid = app.selectedSeasonId();
    if (!sid) return Promise.resolve([]);
    return queryRequestsList({ seasonId: sid });
  });

  const allRequests = () => requests.latest ?? requests();

  const filteredRequests = createMemo(() => {
    const rows = allRequests();
    if (!rows) return [];
    return filterRequestsByQuery(rows, {
      status: status(),
      department: department(),
      query: search()
    });
  });

  return (
    <div class="space-y-5">
      <Title>{t().requests.listPageTitle} — {t().appName}</Title>

      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold text-slate-900 dark:text-slate-100">{t().requests.listHeading}</h1>
          <p class="text-sm text-slate-500 dark:text-slate-400">
            {t().requests.listSubtitle}
          </p>
        </div>

        <Show when={canCreateRequest(app.user()?.role) && !app.isViewingArchived()}>
          <A
            href="/requests/new"
            class="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            <PlusCircle class="h-4 w-4" />
            {t().requests.newRequestBtn}
          </A>
        </Show>
      </div>

      {/* Filters */}
      <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs space-y-3">
        <div class="flex flex-wrap gap-1.5">
          <For each={statusFilters()}>
            {tab => (
              <button
                type="button"
                onClick={() => setStatus(tab.value)}
                class={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                  status() === tab.value
                    ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                }`}
              >
                {tab.label}
              </button>
            )}
          </For>
        </div>

        <div class="grid sm:grid-cols-3 gap-3">
          <SearchInputBar
            value={search()}
            onInput={setSearch}
            placeholder={t().requests.searchPlaceholder}
            class="sm:col-span-2"
          />

          <select
            value={department()}
            onChange={e => setDepartment(e.currentTarget.value as DepartmentId | "all")}
            class="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-red-500 focus:outline-none"
          >
            <option value="all">{t().common.allDepartments}</option>
            <For each={DEPARTMENTS}>
              {dept => (
                <option value={dept.id}>
                  {getDepartmentLabel(locale(), dept.id)} ({dept.code})
                </option>
              )}
            </For>
          </select>
        </div>
      </div>

      {/* List */}
      <Suspense
        fallback={
          <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-400 dark:text-slate-500">
            {t().requests.loadingList}
          </div>
        }
      >
        <Show
          when={allRequests()}
          fallback={
            <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-400 dark:text-slate-500">
              {t().requests.loadingList}
            </div>
          }
        >
          <Show
            when={filteredRequests().length > 0}
            fallback={
              <div class="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-12 text-center space-y-3">
                <p class="text-sm font-medium text-slate-600 dark:text-slate-400">{t().requests.emptyMatch}</p>
                <div class="flex flex-wrap items-center justify-center gap-2">
                  <Show when={status() !== "all" || department() !== "all" || search().trim() !== ""}>
                    <button
                      type="button"
                      onClick={() => {
                        setStatus("all");
                        setDepartment("all");
                        setSearch("");
                      }}
                      class="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
                    >
                      {t().requests.clearFilters}
                    </button>
                  </Show>
                  <Show when={canCreateRequest(app.user()?.role) && !app.isViewingArchived()}>
                    <A
                      href="/requests/new"
                      class="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-red-700"
                    >
                      <PlusCircle class="h-3.5 w-3.5" />
                      {t().requests.createRequestBtn}
                    </A>
                  </Show>
                </div>
              </div>
            }
          >
            <div class="grid gap-3">
              <For each={filteredRequests()}>
                {req => (
                  <A
                    href={`/requests/${req.requestCode}`}
                    class="group rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-xs hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-md transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div class="flex items-start gap-4 min-w-0">
                      <Show
                        when={req.firstPhotoId}
                        fallback={
                          <div class="hidden sm:flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500">
                            <ImageIcon class="h-6 w-6" />
                          </div>
                        }
                      >
                        {photoId => (
                          <img
                            src={`/api/files/${photoId()}?inline=1`}
                            alt={req.title}
                            class="hidden sm:block h-16 w-16 shrink-0 rounded-xl object-cover border border-slate-200 dark:border-slate-700"
                          />
                        )}
                      </Show>

                      <div class="min-w-0 space-y-1.5">
                        <div class="flex flex-wrap items-center gap-2">
                          <span class="rounded-md bg-slate-900 dark:bg-slate-800 border border-transparent dark:border-slate-700 px-2 py-0.5 font-mono text-xs font-bold text-white dark:text-slate-100">
                            {req.requestCode}
                          </span>
                          <DepartmentBadge department={req.department} />
                          <RequestStatusBadge status={req.status} />
                          <Show when={req.carSystem}>
                            <span class="rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:text-slate-300">
                              {req.carSystem}
                            </span>
                          </Show>
                        </div>

                        <h2 class="text-base font-bold text-slate-900 dark:text-slate-100 group-hover:text-red-600 dark:group-hover:text-red-400 transition-colors truncate">
                          {req.title}
                        </h2>

                        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
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
                          <span>{formatDate(req.createdAt, locale())}</span>
                          <span>{t().requests.optionCountLabel(req.optionCount)}</span>
                          <Show when={req.photoCount > 0 || req.docCount > 0}>
                            <span class="inline-flex items-center gap-1">
                              <FileText class="h-3.5 w-3.5" />
                              {t().requests.mediaCountLabel(req.photoCount, req.docCount)}
                            </span>
                          </Show>
                        </div>
                      </div>
                    </div>

                    <div class="sm:text-right shrink-0 flex sm:flex-col items-center sm:items-end justify-between border-t sm:border-0 border-slate-100 dark:border-slate-800 pt-3 sm:pt-0">
                      <div class="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500 font-semibold">
                        {req.effectiveTotalCents !== null
                          ? t().requests.committedCost
                          : t().requests.optionsRange}
                      </div>
                      <div class="text-lg font-extrabold tabular-nums text-slate-900 dark:text-slate-100">
                        <Show
                          when={req.effectiveTotalCents !== null}
                          fallback={
                            <>
                              {formatEur(req.minPriceCents, locale())}
                              <Show when={req.maxPriceCents > req.minPriceCents}>
                                {" – "}
                                {formatEur(req.maxPriceCents, locale())}
                              </Show>
                            </>
                          }
                        >
                          {formatEur(req.effectiveTotalCents!, locale())}
                        </Show>
                      </div>
                    </div>
                  </A>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </Suspense>
    </div>
  );
}
