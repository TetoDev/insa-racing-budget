import { Title } from "@solidjs/meta";
import { A, createAsync, revalidate, useParams, useSubmission } from "@solidjs/router";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Edit3,
  ExternalLink,
  FileCheck2,
  FileText,
  MessageSquare,
  Package,
  Plus,
  Receipt,
  Trash2,
  Upload,
  XCircle
} from "lucide-solid";
import { For, Show, createEffect, createSignal } from "solid-js";
import { useApp } from "~/components/AppContext";
import {
  DepartmentBadge,
  RequestStatusBadge,
  RoleBadge,
  UserAvatar
} from "~/components/Badges";
import { CarSystemField } from "~/components/CarSystemField";
import { DepartmentBudgetWarning } from "~/components/DepartmentBudgetWarning";
import { formatBytes, formatCentsPlain, formatDateTime, formatEur } from "~/lib/format";
import {
  canCommentOnRequests,
  canEditOrWithdrawUnreviewedRequest,
  canRespondToCounterProposition,
  canReviewRequest,
  canSelectOptionOrManageOrder
} from "~/lib/permissions";
import {
  cancelOrderAction,
  counterResponseAction,
  postCommentAction,
  queryRequestDetail,
  reviewRequestAction,
  stageTwoSelectionAction,
  withdrawRequestAction
} from "~/server/rpc";

export default function RequestDetailPage() {
  const params = useParams();
  const app = useApp();
  const detail = createAsync(() => queryRequestDetail(params.id ?? ""));

  const [lightboxId, setLightboxId] = createSignal<string | null>(null);

  // Stage 1 Review state
  const [reviewComment, setReviewComment] = createSignal("");
  const reviewSub = useSubmission(reviewRequestAction);

  // Counter-proposition response state
  const [counterComment, setCounterComment] = createSignal("");
  const counterSub = useSubmission(counterResponseAction);

  // Stage 2 Option selection state
  const [selectedOptId, setSelectedOptId] = createSignal("");
  const [stage2Comment, setStage2Comment] = createSignal("");
  const stage2Sub = useSubmission(stageTwoSelectionAction);

  // Order supplemental fees state
  const [shippingEur, setShippingEur] = createSignal("0.00");
  const [importFeeEur, setImportFeeEur] = createSignal("0.00");
  const [feeComment, setFeeComment] = createSignal("");
  const [feeProofFiles, setFeeProofFiles] = createSignal<File[]>([]);
  const [feeBusy, setFeeBusy] = createSignal(false);
  const [feeMsg, setFeeMsg] = createSignal("");
  const [feeErr, setFeeErr] = createSignal("");

  // Order invoice upload -> Spending state
  const [invoiceFile, setInvoiceFile] = createSignal<File | null>(null);
  const [finalAmountEur, setFinalAmountEur] = createSignal("");
  const [invoiceComment, setInvoiceComment] = createSignal("");
  const [invBusy, setInvBusy] = createSignal(false);
  const [invErr, setInvErr] = createSignal("");

  // Cancel Order state
  const [cancelOrderReason, setCancelOrderReason] = createSignal("");
  const cancelOrderSub = useSubmission(cancelOrderAction);

  // Withdraw before review
  const [withdrawReason, setWithdrawReason] = createSignal("");
  const withdrawSub = useSubmission(withdrawRequestAction);

  // Pre-review Edit modal
  const [editOpen, setEditOpen] = createSignal(false);
  const [editTitle, setEditTitle] = createSignal("");
  const [editCarSystem, setEditCarSystem] = createSignal("");
  const [editExplanation, setEditExplanation] = createSignal("");
  const [editOptions, setEditOptions] = createSignal<
    Array<{ label: string; productUrl: string; priceEur: string; drawbacks: string; notes: string }>
  >([]);
  const [editRemoveIds, setEditRemoveIds] = createSignal<string[]>([]);
  const [editNewPhotos, setEditNewPhotos] = createSignal<File[]>([]);
  const [editNewDocs, setEditNewDocs] = createSignal<File[]>([]);
  const [editBusy, setEditBusy] = createSignal(false);
  const [editErr, setEditErr] = createSignal("");

  // General comment
  const [discussionText, setDiscussionText] = createSignal("");
  const commentSub = useSubmission(postCommentAction);

  createEffect(() => {
    const d = detail();
    if (!d) return;
    setShippingEur(formatCentsPlain(d.shippingCents));
    setImportFeeEur(formatCentsPlain(d.importFeeCents));
    setFinalAmountEur(formatCentsPlain(d.effectiveTotalCents));
    if (!selectedOptId() && d.options.length > 0) {
      setSelectedOptId(d.options[0].id);
    }
  });

  const openEditModal = () => {
    const d = detail();
    if (!d) return;
    setEditTitle(d.title);
    setEditCarSystem(d.carSystem);
    setEditExplanation(d.explanation);
    setEditOptions(
      d.options.map(o => ({
        label: o.label,
        productUrl: o.productUrl ?? "",
        priceEur: formatCentsPlain(o.priceCents),
        drawbacks: o.drawbacks,
        notes: o.notes ?? ""
      }))
    );
    setEditRemoveIds([]);
    setEditNewPhotos([]);
    setEditNewDocs([]);
    setEditErr("");
    setEditOpen(true);
  };

  const refreshAll = async () => {
    await revalidate(["request-detail", "requests-list", "budget-snapshot", "audit-logs"]);
  };

  async function submitFeesUpdate(e: SubmitEvent) {
    e.preventDefault();
    const d = detail();
    if (!d) return;
    setFeeBusy(true);
    setFeeErr("");
    setFeeMsg("");
    try {
      const fd = new FormData();
      fd.set("shippingEur", shippingEur());
      fd.set("importFeeEur", importFeeEur());
      fd.set("comment", feeComment());
      for (const f of feeProofFiles()) {
        fd.append("proofFiles", f);
      }
      const res = await fetch(`/api/requests/${d.id}/fees`, { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update fees.");
      setFeeProofFiles([]);
      setFeeComment("");
      setFeeMsg("Supplemental charges updated.");
      await refreshAll();
    } catch (err) {
      setFeeErr(err instanceof Error ? err.message : "Failed to update charges.");
    } finally {
      setFeeBusy(false);
    }
  }

  async function submitInvoiceUpload(e: SubmitEvent) {
    e.preventDefault();
    const d = detail();
    const file = invoiceFile();
    if (!d || !file) {
      setInvErr("Please select the invoice file first.");
      return;
    }
    setInvBusy(true);
    setInvErr("");
    try {
      const fd = new FormData();
      fd.set("invoiceFile", file);
      fd.set("finalAmountEur", finalAmountEur());
      fd.set("comment", invoiceComment());
      const res = await fetch(`/api/requests/${d.id}/invoice`, { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to upload invoice.");
      setInvoiceFile(null);
      setInvoiceComment("");
      await refreshAll();
    } catch (err) {
      setInvErr(err instanceof Error ? err.message : "Failed to finalize spending.");
    } finally {
      setInvBusy(false);
    }
  }

  async function submitPreReviewEdit(e: SubmitEvent) {
    e.preventDefault();
    const d = detail();
    if (!d) return;
    setEditBusy(true);
    setEditErr("");
    try {
      const fd = new FormData();
      fd.set(
        "payload",
        JSON.stringify({
          title: editTitle(),
          carSystem: editCarSystem(),
          explanation: editExplanation(),
          options: editOptions(),
          removeAttachmentIds: editRemoveIds()
        })
      );
      for (const f of editNewPhotos()) fd.append("photos", f);
      for (const f of editNewDocs()) fd.append("documents", f);
      const res = await fetch(`/api/requests/${d.id}/edit`, { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to save edits.");
      setEditOpen(false);
      await refreshAll();
    } catch (err) {
      setEditErr(err instanceof Error ? err.message : "Failed to edit request.");
    } finally {
      setEditBusy(false);
    }
  }

  const isSeasonEditable = () => detail()?.seasonStatus === "active";

  return (
    <div class="space-y-6">
      <Title>
        {detail() ? `${detail()!.requestCode} — ${detail()!.title}` : "Request Details"} — INSA Racing
      </Title>

      <A
        href="/requests"
        class="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft class="h-3.5 w-3.5" />
        Back to all requests
      </A>

      <Show
        when={detail()}
        fallback={
          <div class="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
            Loading purchase request details...
          </div>
        }
      >
        {d => {
          const photos = () => d().attachments.filter(a => a.kind === "photo");
          const docs = () =>
            d().attachments.filter(a => a.kind === "document" || a.kind === "fee_proof");
          const invoices = () => d().attachments.filter(a => a.kind === "invoice");

          const canEditWithdraw = () =>
            isSeasonEditable() &&
            canEditOrWithdrawUnreviewedRequest({
              role: app.user()?.role,
              userId: app.user()?.id ?? "",
              creatorId: d().creator.id,
              status: d().status,
              hasApproverResponse: d().hasApproverResponse
            });

          const canReviewStage1 = () =>
            isSeasonEditable() && d().status === "pending_review" && canReviewRequest(app.user()?.role);

          const canRespondCounter = () =>
            isSeasonEditable() &&
            canRespondToCounterProposition({
              role: app.user()?.role,
              userId: app.user()?.id ?? "",
              creatorId: d().creator.id,
              status: d().status
            });

          const canActStage2 = () =>
            isSeasonEditable() &&
            d().status === "option_selection" &&
            canSelectOptionOrManageOrder(app.user()?.role);

          const canActOrder = () =>
            isSeasonEditable() &&
            d().status === "order" &&
            canSelectOptionOrManageOrder(app.user()?.role);

          return (
            <div class="space-y-6">
              {/* Header Card */}
              <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
                <div class="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  <div class="space-y-2">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="rounded-lg bg-slate-950 px-3 py-1 font-mono text-sm font-bold text-white">
                        {d().requestCode}
                      </span>
                      <button
                        type="button"
                        onClick={e => {
                          const btn = e.currentTarget;
                          navigator.clipboard?.writeText(d().requestCode).catch(() => {});
                          btn.textContent = "Copied!";
                          setTimeout(() => {
                            btn.textContent = "Copy ID";
                          }, 1500);
                        }}
                        class="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                      >
                        Copy ID
                      </button>
                      <DepartmentBadge department={d().department} />
                      <RequestStatusBadge status={d().status} />
                      <span class="text-xs text-slate-400">· {d().seasonName}</span>
                    </div>

                    {/* Visual 4-Step Lifecycle Progress */}
                    <Show
                      when={!d().status.endsWith("_archived")}
                      fallback={
                        <div class="text-xs font-medium text-slate-500">
                          Archived (
                          {d().status === "denied_archived"
                            ? "denied"
                            : d().status === "withdrawn_archived"
                              ? "withdrawn"
                              : "order cancelled"}
                          ) — kept permanently visible for team audit history.
                        </div>
                      }
                    >
                      {(() => {
                        const stageIdx = () =>
                          d().status === "pending_review" || d().status === "counter_proposed"
                            ? 1
                            : d().status === "option_selection"
                              ? 2
                              : d().status === "order"
                                ? 3
                                : 4;
                        const steps = [
                          { n: 1, label: "1. Review / Counter-Prop" },
                          { n: 2, label: "2. Option Selection" },
                          { n: 3, label: "3. Order (Provisional)" },
                          { n: 4, label: "4. Invoiced Spending" }
                        ];
                        return (
                          <div class="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pt-1">
                            <For each={steps}>
                              {st => {
                                const state = () =>
                                  stageIdx() > st.n
                                    ? "done"
                                    : stageIdx() === st.n
                                      ? "current"
                                      : "todo";
                                return (
                                  <div
                                    class={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold border ${
                                      state() === "done"
                                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                        : state() === "current"
                                          ? "border-slate-900 bg-slate-900 text-white"
                                          : "border-slate-200 bg-slate-50 text-slate-400"
                                    }`}
                                  >
                                    {st.label}
                                  </div>
                                );
                              }}
                            </For>
                          </div>
                        );
                      })()}
                    </Show>

                    <h1 class="text-2xl font-extrabold text-slate-900">{d().title}</h1>

                    <Show when={d().carSystem}>
                      <div class="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700">
                        <span class="text-slate-400 font-medium">Car System:</span>
                        <span>{d().carSystem}</span>
                      </div>
                    </Show>

                    <div class="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                      <span class="inline-flex items-center gap-2">
                        <UserAvatar
                          name={d().creator.fullName}
                          avatarId={d().creator.avatarAttachmentId}
                          size="sm"
                        />
                        <span class="font-medium text-slate-800">{d().creator.fullName}</span>
                        <span>({d().creator.title})</span>
                      </span>
                      <span>· Created {formatDateTime(d().createdAt)}</span>
                    </div>
                  </div>

                  <Show when={canEditWithdraw()}>
                    <div class="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={openEditModal}
                        class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        <Edit3 class="h-3.5 w-3.5" />
                        Edit Request
                      </button>
                    </div>
                  </Show>
                </div>

                <div class="rounded-xl bg-slate-50 border border-slate-100 p-4">
                  <div class="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                    Explanation &amp; Justification
                  </div>
                  <p class="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
                    {d().explanation}
                  </p>
                </div>

                {/* Order / Final Spending Cost Breakdown Banner */}
                <Show when={d().status === "order" || d().status === "spending"}>
                  <div
                    class={`rounded-xl border p-4 grid sm:grid-cols-4 gap-4 ${
                      d().status === "spending"
                        ? "border-emerald-200 bg-emerald-50/70"
                        : "border-orange-200 bg-orange-50/70"
                    }`}
                  >
                    <div>
                      <div class="text-[11px] font-semibold uppercase text-slate-500">
                        Selected Option Base
                      </div>
                      <div class="text-base font-bold tabular-nums text-slate-900">
                        {formatEur(d().selectedOptionPriceCents ?? 0)}
                      </div>
                    </div>
                    <div>
                      <div class="text-[11px] font-semibold uppercase text-slate-500">
                        Shipping Charges
                      </div>
                      <div class="text-base font-bold tabular-nums text-slate-900">
                        {formatEur(d().shippingCents)}
                      </div>
                    </div>
                    <div>
                      <div class="text-[11px] font-semibold uppercase text-slate-500">
                        Import / Customs Fees
                      </div>
                      <div class="text-base font-bold tabular-nums text-slate-900">
                        {formatEur(d().importFeeCents)}
                      </div>
                    </div>
                    <div>
                      <div class="text-[11px] font-semibold uppercase text-slate-500">
                        {d().status === "spending" ? "Final Invoiced Cost" : "Provisional Total"}
                      </div>
                      <div
                        class={`text-lg font-extrabold tabular-nums ${
                          d().status === "spending" ? "text-emerald-800" : "text-orange-800"
                        }`}
                      >
                        {formatEur(d().effectiveTotalCents)}
                      </div>
                    </div>
                  </div>
                </Show>
              </div>

              {/* Photos & Documents */}
              <div class="grid gap-6 lg:grid-cols-2">
                <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
                  <h2 class="text-sm font-bold text-slate-900">Photos ({photos().length})</h2>
                  <Show
                    when={photos().length > 0}
                    fallback={<p class="text-xs text-slate-400">No photos attached.</p>}
                  >
                    <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <For each={photos()}>
                        {photo => (
                          <button
                            type="button"
                            onClick={() => setLightboxId(photo.id)}
                            class="group relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-slate-100 cursor-pointer"
                          >
                            <img
                              src={`/api/files/${photo.id}?inline=1`}
                              alt={photo.originalName}
                              class="h-full w-full object-cover group-hover:scale-105 transition-transform duration-200"
                            />
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>

                <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
                  <h2 class="text-sm font-bold text-slate-900">
                    Documents &amp; Invoices ({docs().length + invoices().length})
                  </h2>
                  <Show
                    when={docs().length + invoices().length > 0}
                    fallback={<p class="text-xs text-slate-400">No documents attached.</p>}
                  >
                    <div class="space-y-2">
                      <For each={invoices()}>
                        {inv => (
                          <a
                            href={`/api/files/${inv.id}`}
                            class="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs hover:bg-emerald-100 transition-colors"
                          >
                            <span class="flex items-center gap-2 min-w-0 font-semibold text-emerald-900">
                              <FileCheck2 class="h-4 w-4 shrink-0 text-emerald-700" />
                              <span class="truncate">INVOICE: {inv.originalName}</span>
                            </span>
                            <span class="shrink-0 inline-flex items-center gap-1 text-emerald-800">
                              {formatBytes(inv.sizeBytes)}
                              <Download class="h-3.5 w-3.5" />
                            </span>
                          </a>
                        )}
                      </For>
                      <For each={docs()}>
                        {doc => (
                          <a
                            href={`/api/files/${doc.id}`}
                            class="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs hover:bg-slate-100 transition-colors"
                          >
                            <span class="flex items-center gap-2 min-w-0 font-medium text-slate-800">
                              <FileText class="h-4 w-4 shrink-0 text-slate-500" />
                              <span class="truncate">
                                {doc.kind === "fee_proof" ? "[Fee Proof] " : ""}
                                {doc.originalName}
                              </span>
                            </span>
                            <span class="shrink-0 inline-flex items-center gap-1 text-slate-500">
                              {formatBytes(doc.sizeBytes)}
                              <Download class="h-3.5 w-3.5" />
                            </span>
                          </a>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </div>

              {/* Buying Options */}
              <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
                <div class="flex items-center justify-between">
                  <h2 class="text-base font-bold text-slate-900">
                    Buying Options ({d().options.length})
                  </h2>
                  <span class="text-xs text-slate-400">All prices in EUR (TTC)</span>
                </div>

                <div class="grid gap-4 md:grid-cols-2">
                  <For each={d().options}>
                    {(opt, i) => {
                      const isSelectedOrderOpt = () => d().selectedOptionId === opt.id;
                      const isStage2Checked = () => selectedOptId() === opt.id;

                      return (
                        <div
                          class={`rounded-xl border p-4 space-y-2.5 transition-all ${
                            isSelectedOrderOpt()
                              ? "border-emerald-500 bg-emerald-50/40 ring-1 ring-emerald-500"
                              : canActStage2() && isStage2Checked()
                                ? "border-sky-500 bg-sky-50/40 ring-1 ring-sky-500"
                                : "border-slate-200 bg-slate-50/60"
                          }`}
                        >
                          <div class="flex items-start justify-between gap-2">
                            <div class="flex items-center gap-2">
                              <Show when={canActStage2()}>
                                <input
                                  type="radio"
                                  name="stage2_option_pick"
                                  checked={isStage2Checked()}
                                  onChange={() => setSelectedOptId(opt.id)}
                                  class="h-4 w-4 accent-sky-600 cursor-pointer"
                                />
                              </Show>
                              <div>
                                <span class="text-[11px] font-bold uppercase text-slate-400">
                                  Option #{i() + 1}
                                </span>
                                <h3 class="text-sm font-bold text-slate-900">{opt.label}</h3>
                              </div>
                            </div>
                            <span class="text-lg font-extrabold tabular-nums text-slate-900 shrink-0">
                              {formatEur(opt.priceCents)}
                            </span>
                          </div>

                          <Show when={isSelectedOrderOpt()}>
                            <span class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800">
                              <CheckCircle2 class="h-3 w-3" />
                              Confirmed Option
                            </span>
                          </Show>

                          <div class="text-xs text-slate-700 bg-white rounded-lg border border-slate-200 p-2.5">
                            <span class="font-semibold text-rose-700">Drawbacks: </span>
                            {opt.drawbacks}
                          </div>

                          <Show when={opt.notes}>
                            <p class="text-xs text-slate-600">
                              <span class="font-semibold">Notes:</span> {opt.notes}
                            </p>
                          </Show>

                          <Show when={opt.productUrl}>
                            <a
                              href={opt.productUrl!}
                              target="_blank"
                              rel="noopener noreferrer"
                              class="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:underline"
                            >
                              Open product link
                              <ExternalLink class="h-3 w-3" />
                            </a>
                          </Show>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </div>

              {/* WORKFLOW ACTION PANELS */}

              {/* Pre-Review Withdraw */}
              <Show when={canEditWithdraw()}>
                <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
                  <h3 class="text-sm font-bold text-slate-900">Withdraw Request (Before Review)</h3>
                  <form action={withdrawRequestAction} method="post" class="flex flex-col sm:flex-row gap-3">
                    <input type="hidden" name="requestId" value={d().id} />
                    <input
                      type="text"
                      name="reason"
                      value={withdrawReason()}
                      onInput={e => setWithdrawReason(e.currentTarget.value)}
                      placeholder="Optional withdrawal reason..."
                      class="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={withdrawSub.pending}
                      class="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 cursor-pointer"
                    >
                      {withdrawSub.pending ? "Withdrawing..." : "Withdraw & Archive"}
                    </button>
                  </form>
                  <Show when={withdrawSub.result instanceof Error}>
                    <p class="text-xs text-red-600">{(withdrawSub.result as Error).message}</p>
                  </Show>
                </div>
              </Show>

              {/* Stage 1: Approver Review */}
              <Show when={canReviewStage1()}>
                <div class="rounded-2xl border-2 border-slate-900 bg-white p-6 shadow-sm space-y-4">
                  <h2 class="text-base font-bold text-slate-900">
                    Approver Decision — Stage 1 Review
                  </h2>
                  <DepartmentBudgetWarning
                    department={d().department}
                    allocatedCents={d().departmentBudgetContext.allocatedCents}
                    spentAndCommittedCents={d().departmentBudgetContext.spentAndCommittedCents}
                    additionalEstimateCents={
                      d().options.length > 0 ? Math.min(...d().options.map(o => o.priceCents)) : 0
                    }
                  />
                  <p class="text-xs text-slate-500">
                    Approve to advance to Stage 2 option selection, counter-propose to negotiate with the requestor, or deny to archive immediately.
                  </p>
                  <form action={reviewRequestAction} method="post" class="space-y-3">
                    <input type="hidden" name="requestId" value={d().id} />
                    <textarea
                      name="comment"
                      required
                      rows={3}
                      value={reviewComment()}
                      onInput={e => setReviewComment(e.currentTarget.value)}
                      placeholder="Write your approval note, counter-proposition terms, or reason for denial..."
                      class="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-red-500 focus:outline-none"
                    />
                    <Show when={reviewSub.result instanceof Error}>
                      <p class="text-xs text-red-600">{(reviewSub.result as Error).message}</p>
                    </Show>
                    <div class="flex flex-wrap gap-2.5">
                      <button
                        type="submit"
                        name="decision"
                        value="approve"
                        disabled={reviewSub.pending}
                        class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
                      >
                        Approve to Stage 2
                      </button>
                      <button
                        type="submit"
                        name="decision"
                        value="counter_propose"
                        disabled={reviewSub.pending}
                        class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
                      >
                        Make Counter-Proposition
                      </button>
                      <button
                        type="submit"
                        name="decision"
                        value="deny"
                        disabled={reviewSub.pending}
                        class="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
                      >
                        Deny &amp; Archive
                      </button>
                    </div>
                  </form>
                </div>
              </Show>

              {/* Requestor Counter-Proposition Response */}
              <Show when={canRespondCounter()}>
                <div class="rounded-2xl border-2 border-indigo-600 bg-white p-6 shadow-sm space-y-4">
                  <h2 class="text-base font-bold text-slate-900">
                    Counter-Proposition Response Required
                  </h2>
                  <p class="text-xs text-slate-500">
                    Accept to move to Stage 2 option selection, submit a counter-argument to send back to approvers, or deny to close and archive this request.
                  </p>
                  <form action={counterResponseAction} method="post" class="space-y-3">
                    <input type="hidden" name="requestId" value={d().id} />
                    <textarea
                      name="comment"
                      rows={3}
                      value={counterComment()}
                      onInput={e => setCounterComment(e.currentTarget.value)}
                      placeholder="Required for counter-argument; optional note when accepting or denying..."
                      class="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                    />
                    <Show when={counterSub.result instanceof Error}>
                      <p class="text-xs text-red-600">{(counterSub.result as Error).message}</p>
                    </Show>
                    <div class="flex flex-wrap gap-2.5">
                      <button
                        type="submit"
                        name="decision"
                        value="accept"
                        disabled={counterSub.pending}
                        class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
                      >
                        Accept Counter-Proposition
                      </button>
                      <button
                        type="submit"
                        name="decision"
                        value="counter_argue"
                        disabled={counterSub.pending}
                        class="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50 cursor-pointer"
                      >
                        Send Counter-Argument
                      </button>
                      <button
                        type="submit"
                        name="decision"
                        value="deny"
                        disabled={counterSub.pending}
                        class="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
                      >
                        Deny &amp; Archive
                      </button>
                    </div>
                  </form>
                </div>
              </Show>

              {/* Stage 2: Select Option -> Order */}
              <Show when={canActStage2()}>
                <div class="rounded-2xl border-2 border-sky-600 bg-white p-6 shadow-sm space-y-4">
                  <h2 class="text-base font-bold text-slate-900">
                    Stage 2 — Confirm Buying Option (Creates Provisional Order)
                  </h2>
                  <p class="text-xs text-slate-500">
                    Pick one of the initial options above and confirm to relabel this request as an <strong>Order</strong> in Provisional Spendings, or deny to archive.
                  </p>
                  <DepartmentBudgetWarning
                    department={d().department}
                    allocatedCents={d().departmentBudgetContext.allocatedCents}
                    spentAndCommittedCents={d().departmentBudgetContext.spentAndCommittedCents}
                    additionalEstimateCents={
                      d().options.find(o => o.id === selectedOptId())?.priceCents ?? 0
                    }
                  />
                  <form action={stageTwoSelectionAction} method="post" class="space-y-3">
                    <input type="hidden" name="requestId" value={d().id} />
                    <input type="hidden" name="optionId" value={selectedOptId()} />
                    <textarea
                      name="comment"
                      rows={2}
                      value={stage2Comment()}
                      onInput={e => setStage2Comment(e.currentTarget.value)}
                      placeholder="Order confirmation note (required if denying)..."
                      class="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-sky-500 focus:outline-none"
                    />
                    <Show when={stage2Sub.result instanceof Error}>
                      <p class="text-xs text-red-600">{(stage2Sub.result as Error).message}</p>
                    </Show>
                    <div class="flex flex-wrap gap-2.5">
                      <button
                        type="submit"
                        name="decision"
                        value="confirm_option"
                        disabled={stage2Sub.pending || !selectedOptId()}
                        class="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50 cursor-pointer"
                      >
                        Confirm Selected Option as Order
                      </button>
                      <button
                        type="submit"
                        name="decision"
                        value="deny"
                        disabled={stage2Sub.pending}
                        class="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
                      >
                        Deny &amp; Archive
                      </button>
                    </div>
                  </form>
                </div>
              </Show>

              {/* Order Stage: Fees, Invoice Upload -> Spending, Cancel */}
              <Show when={canActOrder()}>
                <div class="grid gap-6 lg:grid-cols-2">
                  {/* Supplemental Fees */}
                  <form
                    onSubmit={submitFeesUpdate}
                    class="rounded-2xl border border-orange-300 bg-white p-6 shadow-xs space-y-4"
                  >
                    <div class="flex items-center gap-2">
                      <Package class="h-5 w-5 text-orange-600" />
                      <h3 class="text-base font-bold text-slate-900">
                        Supplemental Shipping &amp; Import Fees
                      </h3>
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                      <div>
                        <label class="block text-xs font-semibold text-slate-600 mb-1">
                          Shipping (EUR)
                        </label>
                        <input
                          type="text"
                          value={shippingEur()}
                          onInput={e => setShippingEur(e.currentTarget.value)}
                          class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums focus:border-orange-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label class="block text-xs font-semibold text-slate-600 mb-1">
                          Import / Customs (EUR)
                        </label>
                        <input
                          type="text"
                          value={importFeeEur()}
                          onInput={e => setImportFeeEur(e.currentTarget.value)}
                          class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums focus:border-orange-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    <input
                      type="text"
                      value={feeComment()}
                      onInput={e => setFeeComment(e.currentTarget.value)}
                      placeholder="Optional note about shipping/customs charges..."
                      class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none"
                    />

                    <label class="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-600 cursor-pointer">
                      <Upload class="h-4 w-4" />
                      <span>
                        {feeProofFiles().length > 0
                          ? `${feeProofFiles().length} proof file(s) selected`
                          : "Attach shipping/customs proof (optional)"}
                      </span>
                      <input
                        type="file"
                        multiple
                        class="hidden"
                        onChange={e =>
                          setFeeProofFiles(
                            e.currentTarget.files ? Array.from(e.currentTarget.files) : []
                          )
                        }
                      />
                    </label>

                    <Show when={feeErr()}>
                      <p class="text-xs text-red-600">{feeErr()}</p>
                    </Show>
                    <Show when={feeMsg()}>
                      <p class="text-xs text-emerald-700">{feeMsg()}</p>
                    </Show>

                    <button
                      type="submit"
                      disabled={feeBusy()}
                      class="w-full rounded-lg bg-orange-600 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50 cursor-pointer"
                    >
                      {feeBusy() ? "Updating..." : "Save Supplemental Charges"}
                    </button>
                  </form>

                  {/* Upload Invoice -> Final Spending */}
                  <form
                    onSubmit={submitInvoiceUpload}
                    class="rounded-2xl border border-emerald-300 bg-white p-6 shadow-xs space-y-4"
                  >
                    <div class="flex items-center gap-2">
                      <Receipt class="h-5 w-5 text-emerald-600" />
                      <h3 class="text-base font-bold text-slate-900">
                        Upload Invoice (Finalize Spending)
                      </h3>
                    </div>
                    <p class="text-xs text-slate-500">
                      Uploading the final invoice moves this order out of Provisional Spendings and counts it into the Final Budget.
                    </p>

                    <label class="flex items-center gap-2 rounded-lg border border-dashed border-emerald-400 bg-emerald-50/50 px-3.5 py-3 text-xs font-medium text-emerald-900 cursor-pointer">
                      <Upload class="h-4 w-4 text-emerald-600" />
                      <span class="truncate">
                        {invoiceFile() ? invoiceFile()!.name : "Select invoice file (PDF / image)..."}
                      </span>
                      <input
                        type="file"
                        required
                        accept=".pdf,.png,.jpg,.jpeg,.webp"
                        class="hidden"
                        onChange={e => setInvoiceFile(e.currentTarget.files?.[0] ?? null)}
                      />
                    </label>

                    <div>
                      <label class="block text-xs font-semibold text-slate-600 mb-1">
                        Final Invoiced Amount (EUR TTC — adjust if bill differs)
                      </label>
                      <input
                        type="text"
                        required
                        value={finalAmountEur()}
                        onInput={e => setFinalAmountEur(e.currentTarget.value)}
                        class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums focus:border-emerald-500 focus:outline-none"
                      />
                    </div>

                    <input
                      type="text"
                      value={invoiceComment()}
                      onInput={e => setInvoiceComment(e.currentTarget.value)}
                      placeholder="Optional invoice reference / note..."
                      class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                    />

                    <Show when={invErr()}>
                      <p class="text-xs text-red-600">{invErr()}</p>
                    </Show>

                    <button
                      type="submit"
                      disabled={invBusy()}
                      class="w-full rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
                    >
                      {invBusy() ? "Finalizing Spending..." : "Upload Invoice & Mark as Spending"}
                    </button>
                  </form>

                  {/* Cancel Order */}
                  <div class="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
                    <h3 class="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <XCircle class="h-4 w-4 text-rose-600" />
                      Cancel Active Order
                    </h3>
                    <form action={cancelOrderAction} method="post" class="flex flex-col sm:flex-row gap-3">
                      <input type="hidden" name="requestId" value={d().id} />
                      <input
                        type="text"
                        name="reason"
                        required
                        value={cancelOrderReason()}
                        onInput={e => setCancelOrderReason(e.currentTarget.value)}
                        placeholder="Reason for cancelling (e.g. supplier out of stock, order cancelled)..."
                        class="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none"
                      />
                      <button
                        type="submit"
                        disabled={cancelOrderSub.pending}
                        class="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 cursor-pointer"
                      >
                        {cancelOrderSub.pending ? "Cancelling..." : "Cancel Order & Remove from Provisional"}
                      </button>
                    </form>
                    <Show when={cancelOrderSub.result instanceof Error}>
                      <p class="text-xs text-red-600">{(cancelOrderSub.result as Error).message}</p>
                    </Show>
                  </div>
                </div>
              </Show>

              {/* Timeline & Team Discussion */}
              <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-5">
                <div class="flex items-center gap-2">
                  <MessageSquare class="h-5 w-5 text-slate-600" />
                  <h2 class="text-base font-bold text-slate-900">
                    Negotiation History &amp; Activity Timeline
                  </h2>
                </div>

                <div class="space-y-4">
                  <For each={d().timeline}>
                    {entry => (
                      <div class="flex gap-3 border-l-2 border-slate-200 pl-4 py-1">
                        <UserAvatar
                          name={entry.actorName}
                          avatarId={entry.actorAvatarId}
                          size="sm"
                        />
                        <div class="flex-1 min-w-0 space-y-1">
                          <div class="flex flex-wrap items-center gap-2 text-xs">
                            <span class="font-bold text-slate-900">{entry.actorName}</span>
                            <span class="text-slate-400">{entry.actorTitle}</span>
                            <RoleBadge role={entry.actorRole} />
                            <span class="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600">
                              {entry.eventType}
                            </span>
                            <span class="text-slate-400 ml-auto">
                              {formatDateTime(entry.createdAt)}
                            </span>
                          </div>
                          <p class="text-sm text-slate-800 whitespace-pre-wrap">{entry.comment}</p>
                        </div>
                      </div>
                    )}
                  </For>
                </div>

                <Show when={isSeasonEditable() && canCommentOnRequests(app.user()?.role)}>
                  <form
                    action={postCommentAction}
                    method="post"
                    onSubmit={() => setTimeout(() => setDiscussionText(""), 50)}
                    class="pt-4 border-t border-slate-100 flex flex-col sm:flex-row gap-3"
                  >
                    <input type="hidden" name="requestId" value={d().id} />
                    <input
                      type="text"
                      name="comment"
                      required
                      value={discussionText()}
                      onInput={e => setDiscussionText(e.currentTarget.value)}
                      placeholder="Add a discussion comment on this request..."
                      class="flex-1 rounded-lg border border-slate-200 px-3.5 py-2 text-sm focus:border-red-500 focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={commentSub.pending}
                      class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                    >
                      {commentSub.pending ? "Posting..." : "Post Comment"}
                    </button>
                  </form>
                </Show>
              </div>

              {/* Photo Lightbox */}
              <Show when={lightboxId()}>
                {attId => (
                  <div
                    class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4"
                    onClick={() => setLightboxId(null)}
                  >
                    <div class="relative max-w-4xl max-h-[90vh]" onClick={e => e.stopPropagation()}>
                      <img
                        src={`/api/files/${attId()}?inline=1`}
                        alt="Full resolution preview"
                        class="max-h-[85vh] rounded-xl shadow-2xl object-contain"
                      />
                      <div class="mt-3 flex justify-between items-center text-xs text-white">
                        <a
                          href={`/api/files/${attId()}`}
                          class="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 hover:bg-white/25"
                        >
                          <Download class="h-3.5 w-3.5" />
                          Download Original
                        </a>
                        <button
                          type="button"
                          onClick={() => setLightboxId(null)}
                          class="rounded-lg bg-white/15 px-3 py-1.5 hover:bg-white/25 cursor-pointer"
                        >
                          Close
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </Show>

              {/* Edit Unreviewed Request Modal */}
              <Show when={editOpen()}>
                <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 overflow-y-auto">
                  <form
                    onSubmit={submitPreReviewEdit}
                    class="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl space-y-4 my-8 max-h-[90vh] overflow-y-auto"
                  >
                    <div class="flex items-center justify-between">
                      <h3 class="text-lg font-bold text-slate-900">
                        Edit Request {d().requestCode}
                      </h3>
                      <button
                        type="button"
                        onClick={() => setEditOpen(false)}
                        class="text-xs font-semibold text-slate-500 hover:text-slate-900 cursor-pointer"
                      >
                        Close
                      </button>
                    </div>

                    <div>
                      <label class="block text-xs font-semibold text-slate-600 mb-1">Title</label>
                      <input
                        type="text"
                        required
                        value={editTitle()}
                        onInput={e => setEditTitle(e.currentTarget.value)}
                        class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      />
                    </div>

                    <CarSystemField
                      value={editCarSystem()}
                      onInput={setEditCarSystem}
                      listId="car-system-suggestions-edit"
                      compact
                    />

                    <div>
                      <label class="block text-xs font-semibold text-slate-600 mb-1">
                        Explanation
                      </label>
                      <textarea
                        required
                        rows={3}
                        value={editExplanation()}
                        onInput={e => setEditExplanation(e.currentTarget.value)}
                        class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      />
                    </div>

                    <div class="space-y-2">
                      <div class="flex items-center justify-between">
                        <span class="text-xs font-semibold text-slate-600">Options</span>
                        <button
                          type="button"
                          onClick={() =>
                            setEditOptions(prev => [
                              ...prev,
                              { label: "", productUrl: "", priceEur: "", drawbacks: "", notes: "" }
                            ])
                          }
                          class="inline-flex items-center gap-1 text-xs font-semibold text-red-600 cursor-pointer"
                        >
                          <Plus class="h-3.5 w-3.5" /> Add Option
                        </button>
                      </div>
                      <For each={editOptions()}>
                        {(opt, i) => (
                          <div class="rounded-lg border border-slate-200 p-3 space-y-2 bg-slate-50">
                            <div class="flex justify-between items-center text-xs">
                              <span class="font-bold">Option #{i() + 1}</span>
                              <Show when={editOptions().length > 1}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditOptions(prev => prev.filter((_, idx) => idx !== i()))
                                  }
                                  class="text-rose-600 inline-flex items-center gap-1 cursor-pointer"
                                >
                                  <Trash2 class="h-3 w-3" /> Remove
                                </button>
                              </Show>
                            </div>
                            <div class="grid grid-cols-3 gap-2">
                              <input
                                type="text"
                                required
                                value={opt.label}
                                placeholder="Supplier / Label"
                                onInput={e =>
                                  setEditOptions(prev =>
                                    prev.map((x, idx) =>
                                      idx === i() ? { ...x, label: e.currentTarget.value } : x
                                    )
                                  )
                                }
                                class="col-span-2 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                              />
                              <input
                                type="text"
                                required
                                value={opt.priceEur}
                                placeholder="Price EUR"
                                onInput={e =>
                                  setEditOptions(prev =>
                                    prev.map((x, idx) =>
                                      idx === i() ? { ...x, priceEur: e.currentTarget.value } : x
                                    )
                                  )
                                }
                                class="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs tabular-nums"
                              />
                            </div>
                            <input
                              type="text"
                              required
                              value={opt.drawbacks}
                              placeholder="Drawbacks"
                              onInput={e =>
                                setEditOptions(prev =>
                                  prev.map((x, idx) =>
                                    idx === i() ? { ...x, drawbacks: e.currentTarget.value } : x
                                  )
                                )
                              }
                              class="w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                            />
                            <div class="grid grid-cols-2 gap-2">
                              <input
                                type="url"
                                value={opt.productUrl}
                                placeholder="https://... (optional)"
                                onInput={e =>
                                  setEditOptions(prev =>
                                    prev.map((x, idx) =>
                                      idx === i() ? { ...x, productUrl: e.currentTarget.value } : x
                                    )
                                  )
                                }
                                class="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                              />
                              <input
                                type="text"
                                value={opt.notes}
                                placeholder="Notes (optional)"
                                onInput={e =>
                                  setEditOptions(prev =>
                                    prev.map((x, idx) =>
                                      idx === i() ? { ...x, notes: e.currentTarget.value } : x
                                    )
                                  )
                                }
                                class="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                              />
                            </div>
                          </div>
                        )}
                      </For>
                    </div>

                    <Show when={d().attachments.length > 0}>
                      <div class="space-y-1">
                        <span class="text-xs font-semibold text-slate-600">
                          Existing Attachments (check to remove)
                        </span>
                        <div class="space-y-1">
                          <For each={d().attachments}>
                            {att => (
                              <label class="flex items-center gap-2 text-xs text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={editRemoveIds().includes(att.id)}
                                  onChange={e => {
                                    const checked = e.currentTarget.checked;
                                    setEditRemoveIds(prev =>
                                      checked ? [...prev, att.id] : prev.filter(id => id !== att.id)
                                    );
                                  }}
                                />
                                <span>
                                  [{att.kind}] {att.originalName}
                                </span>
                              </label>
                            )}
                          </For>
                        </div>
                      </div>
                    </Show>

                    <div class="grid sm:grid-cols-2 gap-3 text-xs">
                      <label class="block rounded-lg border border-dashed border-slate-300 p-3 cursor-pointer">
                        <span class="font-semibold block mb-1">Add Photos</span>
                        <input
                          type="file"
                          multiple
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          onChange={e =>
                            setEditNewPhotos(
                              e.currentTarget.files ? Array.from(e.currentTarget.files) : []
                            )
                          }
                        />
                      </label>
                      <label class="block rounded-lg border border-dashed border-slate-300 p-3 cursor-pointer">
                        <span class="font-semibold block mb-1">Add Documents</span>
                        <input
                          type="file"
                          multiple
                          onChange={e =>
                            setEditNewDocs(
                              e.currentTarget.files ? Array.from(e.currentTarget.files) : []
                            )
                          }
                        />
                      </label>
                    </div>

                    <Show when={editErr()}>
                      <p class="text-xs text-red-600">{editErr()}</p>
                    </Show>

                    <div class="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setEditOpen(false)}
                        class="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={editBusy()}
                        class="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer"
                      >
                        {editBusy() ? "Saving..." : "Save Changes"}
                      </button>
                    </div>
                  </form>
                </div>
              </Show>
            </div>
          );
        }}
      </Show>
    </div>
  );
}
