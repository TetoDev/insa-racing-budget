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
import { useApp } from "~/components/AppContext";
import { RoleBadge, UserAvatar } from "~/components/Badges";
import { ASSIGNABLE_ROLES } from "~/lib/constants";
import { formatDate, formatEur } from "~/lib/format";
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
      <Title>Master Admin — INSA Racing Achats</Title>

      <div>
        <h1 class="text-2xl font-bold text-slate-900">Master Administration</h1>
        <p class="text-sm text-slate-500">
          Pre-approve and invite member emails via <code>contact@insa-racing.fr</code>, manage team roles, and administer season budgets.
        </p>
      </div>

      <Show
        when={canManageUsersAndSeasons(app.user()?.role)}
        fallback={
          <div class="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800 flex items-center gap-3">
            <ShieldAlert class="h-5 w-5" />
            Only the Master account can access this administration panel.
          </div>
        }
      >
        <Show
          when={data()}
          fallback={
            <div class="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
              Loading Master controls...
            </div>
          }
        >
          {panel => (
            <div class="space-y-8">
              {/* Section A: Pre-Approve & Invite Members */}
              <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-5">
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <UserPlus class="h-5 w-5 text-red-600" />
                    <h2 class="text-lg font-bold text-slate-900">Pre-Approve &amp; Invite Member</h2>
                  </div>
                  <p class="text-xs text-slate-500">
                    Roles: <strong>Viewer</strong> (read-only) · <strong>Requestor</strong> (submit &amp; negotiate) · <strong>Approver</strong> (review, budget &amp; export)
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
                    <label class="block text-xs font-semibold text-slate-600 mb-1">
                      Approved Member Email
                    </label>
                    <input
                      type="email"
                      name="email"
                      required
                      value={inviteEmail()}
                      onInput={e => setInviteEmail(e.currentTarget.value)}
                      placeholder="member@insa-racing.fr"
                      class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-600 mb-1">
                      Assigned Role
                    </label>
                    <select
                      name="role"
                      class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    >
                      <For each={ASSIGNABLE_ROLES}>
                        {r => <option value={r}>{r.toUpperCase()}</option>}
                      </For>
                    </select>
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-600 mb-1">
                      Suggested Title (opt.)
                    </label>
                    <input
                      type="text"
                      name="title"
                      value={inviteTitle()}
                      onInput={e => setInviteTitle(e.currentTarget.value)}
                      placeholder="e.g. Chassis Lead"
                      class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />
                  </div>

                  <div class="sm:col-span-4 flex items-center justify-between gap-3">
                    <Show when={inviteSub.result instanceof Error}>
                      <span class="text-xs text-red-600">
                        {(inviteSub.result as Error).message}
                      </span>
                    </Show>
                    <button
                      type="submit"
                      disabled={inviteSub.pending}
                      class="ml-auto rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer"
                    >
                      {inviteSub.pending ? "Sending Invite..." : "Approve & Send Invite Email"}
                    </button>
                  </div>
                </form>

                <Show when={inviteResult() || resendResult()}>
                  {res => (
                    <div class="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-900 space-y-1">
                      <div class="flex items-center gap-2 font-semibold">
                        <MailCheck class="h-4 w-4 text-emerald-700" />
                        <span>
                          {res().emailSent
                            ? `Invitation email sent to ${res().email} via contact@insa-racing.fr.`
                            : `Invite created for ${res().email}, but email delivery did not succeed (check SMTP settings in .env). Share the manual link below:`}
                        </span>
                      </div>
                      <Show when={res().fallbackInviteUrl}>
                        {url => (
                          <div class="flex items-center justify-between gap-2 font-mono break-all bg-white border border-emerald-200 rounded p-2 text-[11px]">
                            <span>Manual Setup Link: {url()}</span>
                            <button
                              type="button"
                              onClick={e => {
                                const btn = e.currentTarget;
                                navigator.clipboard?.writeText(url()).catch(() => {});
                                btn.textContent = "Copied!";
                                setTimeout(() => {
                                  btn.textContent = "Copy";
                                }, 1500);
                              }}
                              class="shrink-0 rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 font-sans text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 cursor-pointer"
                            >
                              Copy
                            </button>
                          </div>
                        )}
                      </Show>
                    </div>
                  )}
                </Show>

                {/* Users & Pending Invites Table */}
                <div class="overflow-x-auto border-t border-slate-100 pt-4">
                  <table class="w-full text-left text-sm">
                    <thead class="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                      <tr>
                        <th class="px-3 py-2.5">Member</th>
                        <th class="px-3 py-2.5">Status</th>
                        <th class="px-3 py-2.5">Role</th>
                        <th class="px-3 py-2.5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
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
                                  <div class="font-semibold text-slate-900">{u.fullName}</div>
                                  <div class="text-xs text-slate-500">
                                    {u.email} · {u.title}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td class="px-3 py-3">
                              <span
                                class={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                                  u.status === "active"
                                    ? "bg-emerald-50 text-emerald-700"
                                    : u.status === "invited"
                                      ? "bg-amber-50 text-amber-700"
                                      : "bg-rose-50 text-rose-700"
                                }`}
                              >
                                {u.status}
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
                                    class="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold"
                                  >
                                    <For each={ASSIGNABLE_ROLES}>
                                      {r => <option value={r}>{r.toUpperCase()}</option>}
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
                                    class="rounded border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
                                  >
                                    Resend Invite
                                  </button>
                                </form>
                                <form action={revokeInviteAction} method="post" class="inline">
                                  <input type="hidden" name="userId" value={u.id} />
                                  <button
                                    type="submit"
                                    class="rounded border border-rose-200 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 cursor-pointer"
                                  >
                                    Revoke
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
                                        ? "border-rose-200 text-rose-700 hover:bg-rose-50"
                                        : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                                    }`}
                                  >
                                    {u.status === "active" ? "Suspend" : "Reactivate"}
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
              <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-5">
                <div class="flex items-center gap-2">
                  <CalendarPlus class="h-5 w-5 text-red-600" />
                  <h2 class="text-lg font-bold text-slate-900">Season Budgets &amp; Archiving</h2>
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
                      <div class="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900 flex items-start gap-2.5">
                        <AlertTriangle class="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                        <span>
                          Active season currently has <strong>{unres().pendingRequests}</strong> open request(s),{" "}
                          <strong>{unres().provisionalOrders}</strong> un-invoiced order(s), and{" "}
                          <strong>{unres().provisionalEntries}</strong> provisional entry(ies). Archiving freezes the season read-only—resolve or cancel them beforehand if needed.
                        </span>
                      </div>
                    </Show>
                  )}
                </Show>

                <form action={createSeasonAction} method="post" class="grid sm:grid-cols-5 gap-3 items-end">
                  <div class="sm:col-span-2">
                    <label class="block text-xs font-semibold text-slate-600 mb-1">
                      New Season Name
                    </label>
                    <input
                      type="text"
                      name="name"
                      required
                      value={seasonName()}
                      onInput={e => setSeasonName(e.currentTarget.value)}
                      placeholder="Formula Student 2027-2028"
                      class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-600 mb-1">
                      ID Prefix (e.g. 27)
                    </label>
                    <input
                      type="text"
                      name="yearCode"
                      required
                      maxLength={4}
                      value={seasonYearCode()}
                      onInput={e => setSeasonYearCode(e.currentTarget.value)}
                      placeholder="27"
                      class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-600 mb-1">
                      Starting Day
                    </label>
                    <input
                      type="date"
                      name="startDate"
                      required
                      value={seasonStart()}
                      onInput={e => setSeasonStart(e.currentTarget.value)}
                      class="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-600 mb-1">
                      Deadline Date
                    </label>
                    <input
                      type="date"
                      name="deadlineDate"
                      required
                      value={seasonDeadline()}
                      onInput={e => setSeasonDeadline(e.currentTarget.value)}
                      class="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm"
                    />
                  </div>

                  <div class="sm:col-span-2">
                    <label class="block text-xs font-semibold text-slate-600 mb-1">
                      Opening Carry-Over Balance (EUR)
                    </label>
                    <input
                      type="text"
                      name="openingBalanceEur"
                      value={seasonOpening()}
                      onInput={e => setSeasonOpening(e.currentTarget.value)}
                      class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
                    />
                  </div>

                  <div class="sm:col-span-3 flex items-center justify-between gap-3">
                    <label class="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={archiveCurrent()}
                        onChange={e => setArchiveCurrent(e.currentTarget.checked)}
                        class="h-4 w-4 accent-red-600"
                      />
                      <span>Automatically archive current active season</span>
                    </label>
                    <input
                      type="hidden"
                      name="archiveCurrentActive"
                      value={archiveCurrent() ? "true" : "false"}
                    />
                    <button
                      type="submit"
                      disabled={seasonSub.pending}
                      class="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                    >
                      {seasonSub.pending ? "Creating..." : "Create Season Budget"}
                    </button>
                  </div>
                </form>

                <Show when={seasonSub.result instanceof Error}>
                  <p class="text-xs text-red-600">{(seasonSub.result as Error).message}</p>
                </Show>
                <Show when={archiveSub.result instanceof Error}>
                  <p class="text-xs text-red-600">{(archiveSub.result as Error).message}</p>
                </Show>

                <div class="divide-y divide-slate-100 border-t border-slate-100 pt-2">
                  <For each={panel().seasons}>
                    {s => (
                      <div class="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <div class="flex items-center gap-2">
                            <span class="font-mono text-xs font-bold bg-slate-100 px-2 py-0.5 rounded">
                              {s.yearCode}
                            </span>
                            <span class="font-bold text-slate-900">{s.name}</span>
                            <span
                              class={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${
                                s.status === "active"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {s.status}
                            </span>
                          </div>
                          <div class="text-xs text-slate-500 mt-0.5">
                            {formatDate(s.startDate)} → {formatDate(s.deadlineDate)} · Opening balance:{" "}
                            <span class="tabular-nums font-medium">
                              {formatEur(s.openingBalanceCents)}
                            </span>
                          </div>
                        </div>

                        <Show when={s.status === "active"}>
                          <form action={archiveSeasonAction} method="post">
                            <input type="hidden" name="seasonId" value={s.id} />
                            <button
                              type="submit"
                              disabled={archiveSub.pending}
                              class="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 cursor-pointer"
                            >
                              <Archive class="h-3.5 w-3.5" />
                              Archive Season
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
