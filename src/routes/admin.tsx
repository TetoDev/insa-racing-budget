import { Title } from "@solidjs/meta";
import { createAsync, useSubmission } from "@solidjs/router";
import {
  AlertTriangle,
  Archive,
  CalendarPlus,
  MailCheck,
  ShieldAlert,
  UserPlus
} from "lucide-solid";
import { For, Show, createSignal } from "solid-js";
import { useApp, useI18n } from "~/components/AppContext";
import { RoleBadge, UserAvatar } from "~/components/Badges";
import { ASSIGNABLE_ROLES } from "~/lib/constants";
import { formatDate, formatEur } from "~/lib/format";
import { getRoleLabel, getSeasonStatusLabel, getUserStatusLabel } from "~/lib/i18n";
import { canManageUsersAndSeasons } from "~/lib/permissions";
import {
  archiveSeasonAction,
  createSeasonAction,
  inviteUserAction,
  queryAdminPanelData,
  resendInviteAction,
  revokeInviteAction,
  toggleUserStatusAction,
  updateUserRoleAction
} from "~/server/rpc";

export default function AdminPage() {
  const app = useApp();
  const { locale, t } = useI18n();
  const data = createAsync(() => queryAdminPanelData());

  const inviteSub = useSubmission(inviteUserAction);
  const resendSub = useSubmission(resendInviteAction);
  const seasonSub = useSubmission(createSeasonAction);
  const archiveSub = useSubmission(archiveSeasonAction);

  const [inviteEmail, setInviteEmail] = createSignal("");
  const [inviteTitle, setInviteTitle] = createSignal("");
  const [seasonName, setSeasonName] = createSignal("");
  const [seasonYearCode, setSeasonYearCode] = createSignal("");
  const [seasonStart, setSeasonStart] = createSignal("");
  const [seasonDeadline, setSeasonDeadline] = createSignal("");
  const [seasonOpening, setSeasonOpening] = createSignal("0.00");
  const [archiveCurrent, setArchiveCurrent] = createSignal(true);

  const inviteResult = () => {
    const r = inviteSub.result;
    if (r && !(r instanceof Error) && "email" in r) {
      return r as {
        email: string;
        emailSent: boolean;
        fallbackInviteUrl: string | null;
      };
    }
    return null;
  };

  const resendResult = () => {
    const r = resendSub.result;
    if (r && !(r instanceof Error) && "email" in r) {
      return r as {
        email: string;
        emailSent: boolean;
        fallbackInviteUrl: string | null;
      };
    }
    return null;
  };

  return (
    <div class="space-y-8">
      <Title>{t().admin.pageTitle} — {t().appName}</Title>

      <div>
        <h1 class="text-2xl font-bold text-slate-900 dark:text-slate-100">{t().admin.heading}</h1>
        <p class="text-sm text-slate-500 dark:text-slate-400">
          {t().admin.subtitlePre} <code>contact@insa-racing.fr</code>
          {t().admin.subtitlePost}
        </p>
      </div>

      <Show
        when={canManageUsersAndSeasons(app.user()?.role)}
        fallback={
          <div class="rounded-2xl border border-rose-200 dark:border-rose-900/70 bg-rose-50 dark:bg-rose-950/60 p-6 text-sm text-rose-800 dark:text-rose-200 flex items-center gap-3">
            <ShieldAlert class="h-5 w-5" />
            {t().admin.restrictedMsg}
          </div>
        }
      >
        <Show
          when={data()}
          fallback={
            <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-400 dark:text-slate-500">
              {t().admin.loadingMsg}
            </div>
          }
        >
          {panel => (
            <div class="space-y-8">
              {/* Section A: Pre-Approve & Invite Members */}
              <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs space-y-5">
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <UserPlus class="h-5 w-5 text-red-600 dark:text-red-400" />
                    <h2 class="text-lg font-bold text-slate-900 dark:text-slate-100">{t().admin.inviteHeading}</h2>
                  </div>
                  <p class="text-xs text-slate-500 dark:text-slate-400">
                    {t().admin.rolesSummaryPrefix} <strong>{t().admin.rolesSummaryViewer}</strong>{" "}
                    {t().admin.rolesSummaryViewerDesc} · <strong>{t().admin.rolesSummaryRequestor}</strong>{" "}
                    {t().admin.rolesSummaryRequestorDesc} · <strong>{t().admin.rolesSummaryApprover}</strong>{" "}
                    {t().admin.rolesSummaryApproverDesc}
                  </p>
                </div>

                <form
                  action={inviteUserAction}
                  method="post"
                  onSubmit={() =>
                    setTimeout(() => {
                      setInviteEmail("");
                      setInviteTitle("");
                    }, 100)
                  }
                  class="grid sm:grid-cols-4 gap-3 items-end"
                >
                  <div class="sm:col-span-2">
                    <label class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      {t().admin.approvedEmailLabel}
                    </label>
                    <input
                      type="email"
                      name="email"
                      required
                      value={inviteEmail()}
                      onInput={e => setInviteEmail(e.currentTarget.value)}
                      placeholder={t().auth.emailPlaceholder}
                      class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-red-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      {t().admin.assignedRoleLabel}
                    </label>
                    <select
                      name="role"
                      class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-red-500 focus:outline-none"
                    >
                      <For each={ASSIGNABLE_ROLES}>
                        {r => <option value={r}>{getRoleLabel(locale(), r)}</option>}
                      </For>
                    </select>
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      {t().admin.suggestedTitleLabel}
                    </label>
                    <input
                      type="text"
                      name="title"
                      value={inviteTitle()}
                      onInput={e => setInviteTitle(e.currentTarget.value)}
                      placeholder={t().admin.suggestedTitlePlaceholder}
                      class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-red-500 focus:outline-none"
                    />
                  </div>

                  <div class="sm:col-span-4 flex items-center justify-between gap-3">
                    <Show when={inviteSub.result instanceof Error}>
                      <span class="text-xs text-red-600 dark:text-red-400">
                        {(inviteSub.result as Error).message}
                      </span>
                    </Show>
                    <button
                      type="submit"
                      disabled={inviteSub.pending}
                      class="ml-auto rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer"
                    >
                      {inviteSub.pending ? t().admin.sendingInviteBtn : t().admin.sendInviteBtn}
                    </button>
                  </div>
                </form>

                <Show when={inviteResult() || resendResult()}>
                  {res => (
                    <div class="rounded-xl border border-emerald-200 dark:border-emerald-900/70 bg-emerald-50 dark:bg-emerald-950/50 p-3.5 text-xs text-emerald-900 dark:text-emerald-200 space-y-1">
                      <div class="flex items-center gap-2 font-semibold">
                        <MailCheck class="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                        <span>
                          {res().emailSent
                            ? t().admin.inviteSentMsg(res().email)
                            : t().admin.inviteManualMsg(res().email)}
                        </span>
                      </div>
                      <Show when={res().fallbackInviteUrl}>
                        {url => (
                          <div class="flex items-center justify-between gap-2 font-mono break-all bg-white dark:bg-slate-950 border border-emerald-200 dark:border-emerald-900/70 rounded p-2 text-[11px] text-slate-800 dark:text-slate-200">
                            <span>
                              {t().admin.manualSetupPrefix} {url()}
                            </span>
                            <button
                              type="button"
                              onClick={e => {
                                const btn = e.currentTarget;
                                const copyTxt = t().common.copy;
                                navigator.clipboard?.writeText(url()).catch(() => {});
                                btn.textContent = t().common.copied;
                                setTimeout(() => {
                                  btn.textContent = copyTxt;
                                }, 1500);
                              }}
                              class="shrink-0 rounded border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 font-sans text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 cursor-pointer"
                            >
                              {t().common.copy}
                            </button>
                          </div>
                        )}
                      </Show>
                    </div>
                  )}
                </Show>

                {/* Users & Pending Invites Table */}
                <div class="overflow-x-auto border-t border-slate-100 dark:border-slate-800 pt-4">
                  <table class="w-full text-left text-sm">
                    <thead class="bg-slate-50 dark:bg-slate-800/70 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                      <tr>
                        <th class="px-3 py-2.5">{t().admin.colMember}</th>
                        <th class="px-3 py-2.5">{t().admin.colStatus}</th>
                        <th class="px-3 py-2.5">{t().admin.colRole}</th>
                        <th class="px-3 py-2.5 text-right">{t().admin.colActions}</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                      <For each={panel().users}>
                        {u => (
                          <tr>
                            <td class="px-3 py-3">
                              <div class="flex items-center gap-3">
                                <UserAvatar
                                  name={u.fullName}
                                  avatarId={u.avatarAttachmentId}
                                  size="sm"
                                />
                                <div>
                                  <div class="font-semibold text-slate-900 dark:text-slate-100">{u.fullName}</div>
                                  <div class="text-xs text-slate-500 dark:text-slate-400">
                                    {u.email} · {u.title}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td class="px-3 py-3">
                              <span
                                class={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                                  u.status === "active"
                                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                                    : u.status === "invited"
                                      ? "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                                      : "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                                }`}
                              >
                                {getUserStatusLabel(locale(), u.status)}
                              </span>
                            </td>
                            <td class="px-3 py-3">
                              <Show when={!u.isEnvMaster} fallback={<RoleBadge role={u.role} />}>
                                <form action={updateUserRoleAction} method="post" class="flex items-center gap-1.5">
                                  <input type="hidden" name="userId" value={u.id} />
                                  <select
                                    name="role"
                                    value={u.role}
                                    onChange={e => e.currentTarget.form?.requestSubmit()}
                                    class="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-xs font-semibold text-slate-900 dark:text-slate-100"
                                  >
                                    <For each={ASSIGNABLE_ROLES}>
                                      {r => <option value={r}>{getRoleLabel(locale(), r)}</option>}
                                    </For>
                                  </select>
                                </form>
                              </Show>
                            </td>
                            <td class="px-3 py-3 text-right space-x-2 whitespace-nowrap">
                              <Show when={u.status === "invited"}>
                                <form action={resendInviteAction} method="post" class="inline">
                                  <input type="hidden" name="userId" value={u.id} />
                                  <button
                                    type="submit"
                                    class="rounded border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                                  >
                                    {t().admin.resendInviteBtn}
                                  </button>
                                </form>
                                <form action={revokeInviteAction} method="post" class="inline">
                                  <input type="hidden" name="userId" value={u.id} />
                                  <button
                                    type="submit"
                                    class="rounded border border-rose-200 dark:border-rose-800/80 px-2.5 py-1 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/60 cursor-pointer"
                                  >
                                    {t().admin.revokeBtn}
                                  </button>
                                </form>
                              </Show>

                              <Show when={!u.isEnvMaster && u.status !== "invited"}>
                                <form action={toggleUserStatusAction} method="post" class="inline">
                                  <input type="hidden" name="userId" value={u.id} />
                                  <input
                                    type="hidden"
                                    name="nextStatus"
                                    value={u.status === "active" ? "suspended" : "active"}
                                  />
                                  <button
                                    type="submit"
                                    class={`rounded border px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                                      u.status === "active"
                                        ? "border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-800/80 dark:text-rose-300 dark:hover:bg-rose-950/60"
                                        : "border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800/80 dark:text-emerald-300 dark:hover:bg-emerald-950/60"
                                    }`}
                                  >
                                    {u.status === "active"
                                      ? t().admin.suspendBtn
                                      : t().admin.reactivateBtn}
                                  </button>
                                </form>
                              </Show>
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Section B: Season Budgets Management */}
              <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs space-y-5">
                <div class="flex items-center gap-2">
                  <CalendarPlus class="h-5 w-5 text-red-600 dark:text-red-400" />
                  <h2 class="text-lg font-bold text-slate-900 dark:text-slate-100">{t().admin.seasonsHeading}</h2>
                </div>

                <Show when={panel().activeUnresolved}>
                  {unres => (
                    <Show
                      when={
                        unres().pendingRequests > 0 ||
                        unres().provisionalOrders > 0 ||
                        unres().provisionalEntries > 0
                      }
                    >
                      <div class="rounded-xl border border-amber-200 dark:border-amber-900/70 bg-amber-50 dark:bg-amber-950/50 p-3.5 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
                        <AlertTriangle class="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                        <span>
                          {t().admin.unresolvedWarning(
                            unres().pendingRequests,
                            unres().provisionalOrders,
                            unres().provisionalEntries
                          )}
                        </span>
                      </div>
                    </Show>
                  )}
                </Show>

                <form action={createSeasonAction} method="post" class="grid sm:grid-cols-5 gap-3 items-end">
                  <div class="sm:col-span-2">
                    <label class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      {t().admin.newSeasonNameLabel}
                    </label>
                    <input
                      type="text"
                      name="name"
                      required
                      value={seasonName()}
                      onInput={e => setSeasonName(e.currentTarget.value)}
                      placeholder={t().admin.newSeasonPlaceholder}
                      class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-red-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      {t().admin.idPrefixLabel}
                    </label>
                    <input
                      type="text"
                      name="yearCode"
                      required
                      maxLength={4}
                      value={seasonYearCode()}
                      onInput={e => setSeasonYearCode(e.currentTarget.value)}
                      placeholder="27"
                      class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 font-mono focus:border-red-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      {t().admin.startingDayLabel}
                    </label>
                    <input
                      type="date"
                      name="startDate"
                      required
                      value={seasonStart()}
                      onInput={e => setSeasonStart(e.currentTarget.value)}
                      class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-red-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      {t().admin.deadlineDateLabel}
                    </label>
                    <input
                      type="date"
                      name="deadlineDate"
                      required
                      value={seasonDeadline()}
                      onInput={e => setSeasonDeadline(e.currentTarget.value)}
                      class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-red-500 focus:outline-none"
                    />
                  </div>

                  <div class="sm:col-span-2">
                    <label class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      {t().admin.openingBalanceLabel}
                    </label>
                    <input
                      type="text"
                      name="openingBalanceEur"
                      value={seasonOpening()}
                      onInput={e => setSeasonOpening(e.currentTarget.value)}
                      class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 tabular-nums focus:border-red-500 focus:outline-none"
                    />
                  </div>

                  <div class="sm:col-span-3 flex items-center justify-between gap-3">
                    <label class="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={archiveCurrent()}
                        onChange={e => setArchiveCurrent(e.currentTarget.checked)}
                        class="h-4 w-4 accent-red-600"
                      />
                      <span>{t().admin.autoArchiveLabel}</span>
                    </label>
                    <input
                      type="hidden"
                      name="archiveCurrentActive"
                      value={archiveCurrent() ? "true" : "false"}
                    />
                    <button
                      type="submit"
                      disabled={seasonSub.pending}
                      class="rounded-lg bg-slate-900 dark:bg-slate-100 px-4 py-2 text-xs font-semibold text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-white disabled:opacity-50 cursor-pointer"
                    >
                      {seasonSub.pending ? t().admin.creatingBtn : t().admin.createSeasonBtn}
                    </button>
                  </div>
                </form>

                <Show when={seasonSub.result instanceof Error}>
                  <p class="text-xs text-red-600 dark:text-red-400">{(seasonSub.result as Error).message}</p>
                </Show>
                <Show when={archiveSub.result instanceof Error}>
                  <p class="text-xs text-red-600 dark:text-red-400">{(archiveSub.result as Error).message}</p>
                </Show>

                <div class="divide-y divide-slate-100 dark:divide-slate-800 border-t border-slate-100 dark:border-slate-800 pt-2">
                  <For each={panel().seasons}>
                    {s => (
                      <div class="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <div class="flex items-center gap-2">
                            <span class="font-mono text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 px-2 py-0.5 rounded">
                              {s.yearCode}
                            </span>
                            <span class="font-bold text-slate-900 dark:text-slate-100">{s.name}</span>
                            <span
                              class={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${
                                s.status === "active"
                                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                                  : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                              }`}
                            >
                              {getSeasonStatusLabel(locale(), s.status)}
                            </span>
                          </div>
                          <div class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {formatDate(s.startDate, locale())} → {formatDate(s.deadlineDate, locale())} ·{" "}
                            {t().admin.openingBalancePrefix}{" "}
                            <span class="tabular-nums font-medium text-slate-700 dark:text-slate-300">
                              {formatEur(s.openingBalanceCents, locale())}
                            </span>
                          </div>
                        </div>

                        <Show when={s.status === "active"}>
                          <form action={archiveSeasonAction} method="post">
                            <input type="hidden" name="seasonId" value={s.id} />
                            <button
                              type="submit"
                              disabled={archiveSub.pending}
                              class="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 dark:border-amber-800/80 bg-amber-50 dark:bg-amber-950/60 px-3 py-1.5 text-xs font-semibold text-amber-900 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/60 cursor-pointer"
                            >
                              <Archive class="h-3.5 w-3.5" />
                              {t().admin.archiveSeasonBtn}
                            </button>
                          </form>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </div>
          )}
        </Show>
      </Show>
    </div>
  );
}
