import { Title } from "@solidjs/meta";
import {
  A,
  createAsync,
  revalidate,
  useNavigate,
  useParams,
  useSearchParams,
  useSubmission
} from "@solidjs/router";
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
  ShieldAlert,
  Trash2,
  Upload,
  XCircle
} from "lucide-solid";
import { For, Show, createEffect, createSignal } from "solid-js";
import { useApp, useI18n } from "~/components/AppContext";
import {
  DepartmentBadge,
  RequestStatusBadge,
  RoleBadge,
  UserAvatar
} from "~/components/Badges";
import { CarSystemField } from "~/components/CarSystemField";
import { DepartmentBudgetWarning } from "~/components/DepartmentBudgetWarning";
import {
  MasterDeleteConfirmModal,
  MasterEditRequestModal,
  type MasterDeleteTarget
} from "~/components/MasterModals";
import { formatBytes, formatCentsPlain, formatDateTime, formatEur } from "~/lib/format";
import {
  getAttachmentKindLabel,
  getRequestStatusLabel,
  getTimelineEventLabel
} from "~/lib/i18n";
import {
  canCommentOnRequests,
  canEditOrWithdrawUnreviewedRequest,
  canRespondToCounterProposition,
  canReviewRequest,
  canSelectOptionOrManageOrder,
  isMaster
} from "~/lib/permissions";
import {
  cancelOrderAction,
  counterResponseAction,
  postCommentAction,
  queryMasterUsers,
  queryRequestDetail,
  reviewRequestAction,
  stageTwoSelectionAction,
  withdrawRequestAction
} from "~/server/rpc";

export default function RequestDetailPage() {
  const params = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const app = useApp();
  const { locale, t } = useI18n();
  const detail = createAsync(() => queryRequestDetail(params.id ?? ""));
  const masterUsers = createAsync(() =>
    isMaster(app.user()?.role) ? queryMasterUsers() : Promise.resolve([])
  );

  const [lightboxId, setLightboxId] = createSignal<string | null>(null);
  const [masterEditOpen, setMasterEditOpen] = createSignal(false);
  const [deleteTarget, setDeleteTarget] = createSignal<MasterDeleteTarget | null>(null);

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

  createEffect(() => {
    if (searchParams.masterEdit === "1" && detail() && isMaster(app.user()?.role)) {
      setMasterEditOpen(true);
      setSearchParams({ masterEdit: undefined }, { replace: true });
    }
  });

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
      if (!res.ok) throw new Error(json.error || t().requestDetail.failedFeesErr);
      setFeeProofFiles([]);
      setFeeComment("");
      setFeeMsg(t().requestDetail.feesUpdatedMsg);
      await refreshAll();
    } catch (err) {
      setFeeErr(err instanceof Error ? err.message : t().requestDetail.failedFeesErr);
    } finally {
      setFeeBusy(false);
    }
  }

  async function submitInvoiceUpload(e: SubmitEvent) {
    e.preventDefault();
    const d = detail();
    const file = invoiceFile();
    if (!d || !file) {
      setInvErr(t().requestDetail.selectInvoiceRequiredErr);
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
      if (!res.ok) throw new Error(json.error || t().requestDetail.failedInvoiceErr);
      setInvoiceFile(null);
      setInvoiceComment("");
      await refreshAll();
    } catch (err) {
      setInvErr(err instanceof Error ? err.message : t().requestDetail.failedInvoiceErr);
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
      if (!res.ok) throw new Error(json.error || t().requestDetail.failedEditErr);
      setEditOpen(false);
      await refreshAll();
    } catch (err) {
      setEditErr(err instanceof Error ? err.message : t().requestDetail.failedEditErr);
    } finally {
      setEditBusy(false);
    }
  }

  const isSeasonEditable = () => detail()?.seasonStatus === "active";

  return (
    <div class="space-y-6">
      <Title>
        {detail()
          ? `${detail()!.requestCode} — ${detail()!.title}`
          : t().requestDetail.defaultTitle}{" "}
        — INSA Racing
      </Title>

      <A
        href="/requests"
        class="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
      >
        <ArrowLeft class="h-3.5 w-3.5" />
        {t().requestDetail.backToAll}
      </A>

      <Show
        when={detail()}
        fallback={
          <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center text-sm text-slate-500 dark:text-slate-400">
            {t().requestDetail.loadingDetails}
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
              <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs space-y-4">
                <div class="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  <div class="space-y-2">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="rounded-lg bg-slate-950 dark:bg-slate-800 border border-transparent dark:border-slate-700 px-3 py-1 font-mono text-sm font-bold text-white">
                        {d().requestCode}
                      </span>
                      <button
                        type="button"
                        onClick={e => {
                          const btn = e.currentTarget;
                          const copyIdLabel = t().requestDetail.copyId;
                          navigator.clipboard?.writeText(d().requestCode).catch(() => {});
                          btn.textContent = t().common.copied;
                          setTimeout(() => {
                            btn.textContent = copyIdLabel;
                          }, 1500);
                        }}
                        class="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
                      >
                        {t().requestDetail.copyId}
                      </button>
                      <DepartmentBadge department={d().department} />
                      <RequestStatusBadge status={d().status} />
                      <span class="text-xs text-slate-400 dark:text-slate-500">· {d().seasonName}</span>
                    </div>

                    {/* Visual 4-Step Lifecycle Progress */}
                    <Show
                      when={!d().status.endsWith("_archived")}
                      fallback={
                        <div class="text-xs font-medium text-slate-500 dark:text-slate-400">
                          {t().requestDetail.archivedNote(
                            d().status === "denied_archived"
                              ? "denied"
                              : d().status === "withdrawn_archived"
                                ? "withdrawn"
                                : "order cancelled"
                          )}
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
                        const steps = () => [
                          { n: 1, label: t().requestDetail.steps.review },
                          { n: 2, label: t().requestDetail.steps.selection },
                          { n: 3, label: t().requestDetail.steps.order },
                          { n: 4, label: t().requestDetail.steps.spending }
                        ];
                        return (
                          <div class="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pt-1">
                            <For each={steps()}>
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
                                        ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/80 dark:bg-emerald-950/60 dark:text-emerald-300"
                                        : state() === "current"
                                          ? "border-slate-900 bg-slate-900 text-white dark:border-red-500 dark:bg-red-600/20 dark:text-white"
                                          : "border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-500"
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

                    <h1 class="text-2xl font-extrabold text-slate-900 dark:text-slate-100">{d().title}</h1>

                    <Show when={d().carSystem}>
                      <div class="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
                        <span class="text-slate-400 dark:text-slate-500 font-medium">{t().requestDetail.carSystemPrefix}</span>
                        <span>{d().carSystem}</span>
                      </div>
                    </Show>

                    <div class="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                      <span class="inline-flex items-center gap-2">
                        <UserAvatar
                          name={d().creator.fullName}
                          avatarId={d().creator.avatarAttachmentId}
                          size="sm"
                        />
                        <span class="font-medium text-slate-800 dark:text-slate-200">{d().creator.fullName}</span>
                        <span>({d().creator.title})</span>
                      </span>
                      <span>
                        · {t().requestDetail.createdPrefix} {formatDateTime(d().createdAt, locale())}
                      </span>
                    </div>
                  </div>

                  <div class="flex flex-wrap items-center gap-2 shrink-0">
                    <Show when={canEditWithdraw()}>
                      <button
                        type="button"
                        onClick={openEditModal}
                        class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
                      >
                        <Edit3 class="h-3.5 w-3.5" />
                        {t().requestDetail.editRequestBtn}
                      </button>
                    </Show>
                    <Show when={isMaster(app.user()?.role)}>
                      <button
                        type="button"
                        onClick={() => setMasterEditOpen(true)}
                        class="inline-flex items-center gap-1.5 rounded-lg border border-slate-900 dark:border-slate-100 bg-slate-900 dark:bg-slate-100 px-3 py-2 text-xs font-semibold text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-white cursor-pointer"
                      >
                        <ShieldAlert class="h-3.5 w-3.5" />
                        {t().requestDetail.masterEditAllBtn}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDeleteTarget({
                            kind: "request",
                            id: d().id,
                            code: d().requestCode,
                            title: d().title,
                            statusLabel: getRequestStatusLabel(locale(), d().status),
                            attachmentCount: d().attachments.length
                          })
                        }
                        class="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 dark:border-rose-800/80 bg-rose-50 dark:bg-rose-950/60 px-3 py-2 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/60 cursor-pointer"
                      >
                        <Trash2 class="h-3.5 w-3.5" />
                        {t().common.delete}
                      </button>
                    </Show>
                  </div>
                </div>

                <div class="rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 p-4">
                  <div class="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5">
                    {t().requestDetail.explanationHeading}
                  </div>
                  <p class="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
                    {d().explanation}
                  </p>
                </div>

                {/* Order / Final Spending Cost Breakdown Banner */}
                <Show when={d().status === "order" || d().status === "spending"}>
                  <div
                    class={`rounded-xl border p-4 grid sm:grid-cols-4 gap-4 ${
                      d().status === "spending"
                        ? "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/70 dark:bg-emerald-950/40"
                        : "border-orange-200 bg-orange-50/70 dark:border-orange-900/70 dark:bg-orange-950/40"
                    }`}
                  >
                    <div>
                      <div class="text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                        {t().requestDetail.selectedOptionBase}
                      </div>
                      <div class="text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">
                        {formatEur(d().selectedOptionPriceCents ?? 0, locale())}
                      </div>
                    </div>
                    <div>
                      <div class="text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                        {t().requestDetail.shippingCharges}
                      </div>
                      <div class="text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">
                        {formatEur(d().shippingCents, locale())}
                      </div>
                    </div>
                    <div>
                      <div class="text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                        {t().requestDetail.importCustomsFees}
                      </div>
                      <div class="text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">
                        {formatEur(d().importFeeCents, locale())}
                      </div>
                    </div>
                    <div>
                      <div class="text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                        {d().status === "spending"
                          ? t().requestDetail.finalInvoicedCost
                          : t().requestDetail.provisionalTotal}
                      </div>
                      <div
                        class={`text-lg font-extrabold tabular-nums ${
                          d().status === "spending" ? "text-emerald-800 dark:text-emerald-300" : "text-orange-800 dark:text-orange-300"
                        }`}
                      >
                        {formatEur(d().effectiveTotalCents, locale())}
                      </div>
                    </div>
                  </div>
                </Show>
              </div>

              {/* Photos & Documents */}
              <div class="grid gap-6 lg:grid-cols-2">
                <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-3">
                  <h2 class="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {t().requestDetail.photosHeading(photos().length)}
                  </h2>
                  <Show
                    when={photos().length > 0}
                    fallback={<p class="text-xs text-slate-400 dark:text-slate-500">{t().requestDetail.noPhotos}</p>}
                  >
                    <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <For each={photos()}>
                        {photo => (
                          <button
                            type="button"
                            onClick={() => setLightboxId(photo.id)}
                            class="group relative aspect-square overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 cursor-pointer"
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

                <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-3">
                  <h2 class="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {t().requestDetail.docsInvoicesHeading(docs().length + invoices().length)}
                  </h2>
                  <Show
                    when={docs().length + invoices().length > 0}
                    fallback={<p class="text-xs text-slate-400 dark:text-slate-500">{t().requestDetail.noDocs}</p>}
                  >
                    <div class="space-y-2">
                      <For each={invoices()}>
                        {inv => (
                          <a
                            href={`/api/files/${inv.id}`}
                            download={inv.originalName}
                            rel="external"
                            class="flex items-center justify-between rounded-xl border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50 dark:bg-emerald-950/60 px-3 py-2 text-xs hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition-colors"
                          >
                            <span class="flex items-center gap-2 min-w-0 font-semibold text-emerald-900 dark:text-emerald-200">
                              <FileCheck2 class="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
                              <span class="truncate">
                                {t().common.invoiceUpperPrefix} {inv.originalName}
                              </span>
                            </span>
                            <span class="shrink-0 inline-flex items-center gap-1 text-emerald-800 dark:text-emerald-300">
                              {formatBytes(inv.sizeBytes, locale())}
                              <Download class="h-3.5 w-3.5" />
                            </span>
                          </a>
                        )}
                      </For>
                      <For each={docs()}>
                        {doc => (
                          <a
                            href={`/api/files/${doc.id}`}
                            download={doc.originalName}
                            rel="external"
                            class="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                          >
                            <span class="flex items-center gap-2 min-w-0 font-medium text-slate-800 dark:text-slate-200">
                              <FileText class="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
                              <span class="truncate">
                                {doc.kind === "fee_proof" ? t().common.feeProofPrefix : ""}
                                {doc.originalName}
                              </span>
                            </span>
                            <span class="shrink-0 inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
                              {formatBytes(doc.sizeBytes, locale())}
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
              <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs space-y-4">
                <div class="flex items-center justify-between">
                  <h2 class="text-base font-bold text-slate-900 dark:text-slate-100">
                    {t().requestDetail.buyingOptionsHeading(d().options.length)}
                  </h2>
                  <span class="text-xs text-slate-400 dark:text-slate-500">{t().requestDetail.allPricesTtc}</span>
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
                              ? "border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/30 ring-1 ring-emerald-500"
                              : canActStage2() && isStage2Checked()
                                ? "border-sky-500 bg-sky-50/40 dark:bg-sky-950/30 ring-1 ring-sky-500"
                                : "border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/50"
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
                                <span class="text-[11px] font-bold uppercase text-slate-400 dark:text-slate-500">
                                  {t().requests.optionNumber(i() + 1)}
                                </span>
                                <h3 class="text-sm font-bold text-slate-900 dark:text-slate-100">{opt.label}</h3>
                              </div>
                            </div>
                            <span class="text-lg font-extrabold tabular-nums text-slate-900 dark:text-slate-100 shrink-0">
                              {formatEur(opt.priceCents, locale())}
                            </span>
                          </div>

                          <Show when={isSelectedOrderOpt()}>
                            <span class="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-950/70 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
                              <CheckCircle2 class="h-3 w-3" />
                              {t().requestDetail.confirmedOption}
                            </span>
                          </Show>

                          <div class="text-xs text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-2.5">
                            <span class="font-semibold text-rose-700 dark:text-rose-400">
                              {t().requestDetail.drawbacksPrefix}{" "}
                            </span>
                            {opt.drawbacks}
                          </div>

                          <Show when={opt.notes}>
                            <p class="text-xs text-slate-600 dark:text-slate-400">
                              <span class="font-semibold">{t().requestDetail.notesPrefix}</span>{" "}
                              {opt.notes}
                            </p>
                          </Show>

                          <Show when={opt.productUrl}>
                            <a
                              href={opt.productUrl!}
                              target="_blank"
                              rel="noopener noreferrer"
                              class="inline-flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400 hover:underline"
                            >
                              {t().requestDetail.openProductLink}
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
                <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-3">
                  <h3 class="text-sm font-bold text-slate-900 dark:text-slate-100">{t().requestDetail.withdrawHeading}</h3>
                  <form action={withdrawRequestAction} method="post" class="flex flex-col sm:flex-row gap-3">
                    <input type="hidden" name="requestId" value={d().id} />
                    <input
                      type="text"
                      name="reason"
                      value={withdrawReason()}
                      onInput={e => setWithdrawReason(e.currentTarget.value)}
                      placeholder={t().requestDetail.withdrawPlaceholder}
                      class="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-red-500 focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={withdrawSub.pending}
                      class="rounded-lg border border-rose-200 dark:border-rose-800/80 bg-rose-50 dark:bg-rose-950/60 px-4 py-2 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/60 cursor-pointer"
                    >
                      {withdrawSub.pending
                        ? t().requestDetail.withdrawingBtn
                        : t().requestDetail.withdrawArchiveBtn}
                    </button>
                  </form>
                  <Show when={withdrawSub.result instanceof Error}>
                    <p class="text-xs text-red-600 dark:text-red-400">{(withdrawSub.result as Error).message}</p>
                  </Show>
                </div>
              </Show>

              {/* Stage 1: Approver Review */}
              <Show when={canReviewStage1()}>
                <div class="rounded-2xl border-2 border-slate-900 dark:border-red-500/80 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-4">
                  <h2 class="text-base font-bold text-slate-900 dark:text-slate-100">
                    {t().requestDetail.stage1Heading}
                  </h2>
                  <DepartmentBudgetWarning
                    department={d().department}
                    allocatedCents={d().departmentBudgetContext.allocatedCents}
                    spentAndCommittedCents={d().departmentBudgetContext.spentAndCommittedCents}
                    additionalEstimateCents={
                      d().options.length > 0 ? Math.min(...d().options.map(o => o.priceCents)) : 0
                    }
                  />
                  <p class="text-xs text-slate-500 dark:text-slate-400">
                    {t().requestDetail.stage1Subtitle}
                  </p>
                  <form action={reviewRequestAction} method="post" class="space-y-3">
                    <input type="hidden" name="requestId" value={d().id} />
                    <textarea
                      name="comment"
                      required
                      rows={3}
                      value={reviewComment()}
                      onInput={e => setReviewComment(e.currentTarget.value)}
                      placeholder={t().requestDetail.stage1Placeholder}
                      class="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-red-500 focus:outline-none"
                    />
                    <Show when={reviewSub.result instanceof Error}>
                      <p class="text-xs text-red-600 dark:text-red-400">{(reviewSub.result as Error).message}</p>
                    </Show>
                    <div class="flex flex-wrap gap-2.5">
                      <button
                        type="submit"
                        name="decision"
                        value="approve"
                        disabled={reviewSub.pending}
                        class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
                      >
                        {t().requestDetail.approveStage2Btn}
                      </button>
                      <button
                        type="submit"
                        name="decision"
                        value="counter_propose"
                        disabled={reviewSub.pending}
                        class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
                      >
                        {t().requestDetail.counterProposeBtn}
                      </button>
                      <button
                        type="submit"
                        name="decision"
                        value="deny"
                        disabled={reviewSub.pending}
                        class="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
                      >
                        {t().requestDetail.denyArchiveBtn}
                      </button>
                    </div>
                  </form>
                </div>
              </Show>

              {/* Requestor Counter-Proposition Response */}
              <Show when={canRespondCounter()}>
                <div class="rounded-2xl border-2 border-indigo-600 dark:border-indigo-500 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-4">
                  <h2 class="text-base font-bold text-slate-900 dark:text-slate-100">
                    {t().requestDetail.counterRespHeading}
                  </h2>
                  <p class="text-xs text-slate-500 dark:text-slate-400">
                    {t().requestDetail.counterRespSubtitle}
                  </p>
                  <form action={counterResponseAction} method="post" class="space-y-3">
                    <input type="hidden" name="requestId" value={d().id} />
                    <textarea
                      name="comment"
                      rows={3}
                      value={counterComment()}
                      onInput={e => setCounterComment(e.currentTarget.value)}
                      placeholder={t().requestDetail.counterRespPlaceholder}
                      class="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                    />
                    <Show when={counterSub.result instanceof Error}>
                      <p class="text-xs text-red-600 dark:text-red-400">{(counterSub.result as Error).message}</p>
                    </Show>
                    <div class="flex flex-wrap gap-2.5">
                      <button
                        type="submit"
                        name="decision"
                        value="accept"
                        disabled={counterSub.pending}
                        class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
                      >
                        {t().requestDetail.acceptCounterBtn}
                      </button>
                      <button
                        type="submit"
                        name="decision"
                        value="counter_argue"
                        disabled={counterSub.pending}
                        class="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50 cursor-pointer"
                      >
                        {t().requestDetail.sendCounterArgBtn}
                      </button>
                      <button
                        type="submit"
                        name="decision"
                        value="deny"
                        disabled={counterSub.pending}
                        class="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
                      >
                        {t().requestDetail.denyArchiveBtn}
                      </button>
                    </div>
                  </form>
                </div>
              </Show>

              {/* Stage 2: Select Option -> Order */}
              <Show when={canActStage2()}>
                <div class="rounded-2xl border-2 border-sky-600 dark:border-sky-500 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-4">
                  <h2 class="text-base font-bold text-slate-900 dark:text-slate-100">
                    {t().requestDetail.stage2Heading}
                  </h2>
                  <p class="text-xs text-slate-500 dark:text-slate-400">
                    {t().requestDetail.stage2SubtitlePrefix}{" "}
                    <strong>{t().requestDetail.stage2OrderWord}</strong>{" "}
                    {t().requestDetail.stage2SubtitleSuffix}
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
                      placeholder={t().requestDetail.stage2Placeholder}
                      class="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                    />
                    <Show when={stage2Sub.result instanceof Error}>
                      <p class="text-xs text-red-600 dark:text-red-400">{(stage2Sub.result as Error).message}</p>
                    </Show>
                    <div class="flex flex-wrap gap-2.5">
                      <button
                        type="submit"
                        name="decision"
                        value="confirm_option"
                        disabled={stage2Sub.pending || !selectedOptId()}
                        class="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50 cursor-pointer"
                      >
                        {t().requestDetail.confirmOptionBtn}
                      </button>
                      <button
                        type="submit"
                        name="decision"
                        value="deny"
                        disabled={stage2Sub.pending}
                        class="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
                      >
                        {t().requestDetail.denyArchiveBtn}
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
                    class="rounded-2xl border border-orange-300 dark:border-orange-800/80 bg-white dark:bg-slate-900 p-6 shadow-xs space-y-4"
                  >
                    <div class="flex items-center gap-2">
                      <Package class="h-5 w-5 text-orange-600 dark:text-orange-400" />
                      <h3 class="text-base font-bold text-slate-900 dark:text-slate-100">
                        {t().requestDetail.feesHeading}
                      </h3>
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                      <div>
                        <label class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                          {t().requestDetail.shippingEurLabel}
                        </label>
                        <input
                          type="text"
                          value={shippingEur()}
                          onInput={e => setShippingEur(e.currentTarget.value)}
                          class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 tabular-nums focus:border-orange-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                          {t().requestDetail.importEurLabel}
                        </label>
                        <input
                          type="text"
                          value={importFeeEur()}
                          onInput={e => setImportFeeEur(e.currentTarget.value)}
                          class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 tabular-nums focus:border-orange-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    <input
                      type="text"
                      value={feeComment()}
                      onInput={e => setFeeComment(e.currentTarget.value)}
                      placeholder={t().requestDetail.feeCommentPlaceholder}
                      class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-orange-500 focus:outline-none"
                    />

                    <label class="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                      <Upload class="h-4 w-4" />
                      <span>
                        {feeProofFiles().length > 0
                          ? t().requestDetail.feeProofsSelected(feeProofFiles().length)
                          : t().requestDetail.attachFeeProof}
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
                      <p class="text-xs text-red-600 dark:text-red-400">{feeErr()}</p>
                    </Show>
                    <Show when={feeMsg()}>
                      <p class="text-xs text-emerald-700 dark:text-emerald-400">{feeMsg()}</p>
                    </Show>

                    <button
                      type="submit"
                      disabled={feeBusy()}
                      class="w-full rounded-lg bg-orange-600 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50 cursor-pointer"
                    >
                      {feeBusy() ? t().requestDetail.updatingFeesBtn : t().requestDetail.saveFeesBtn}
                    </button>
                  </form>

                  {/* Upload Invoice -> Final Spending */}
                  <form
                    onSubmit={submitInvoiceUpload}
                    class="rounded-2xl border border-emerald-300 dark:border-emerald-800/80 bg-white dark:bg-slate-900 p-6 shadow-xs space-y-4"
                  >
                    <div class="flex items-center gap-2">
                      <Receipt class="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                      <h3 class="text-base font-bold text-slate-900 dark:text-slate-100">
                        {t().requestDetail.invoiceHeading}
                      </h3>
                    </div>
                    <p class="text-xs text-slate-500 dark:text-slate-400">
                      {t().requestDetail.invoiceSubtitle}
                    </p>

                    <label class="flex items-center gap-2 rounded-lg border border-dashed border-emerald-400 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/50 px-3.5 py-3 text-xs font-medium text-emerald-900 dark:text-emerald-200 cursor-pointer">
                      <Upload class="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      <span class="truncate">
                        {invoiceFile() ? invoiceFile()!.name : t().requestDetail.selectInvoicePrompt}
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
                      <label class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                        {t().requestDetail.finalAmountLabel}
                      </label>
                      <input
                        type="text"
                        required
                        value={finalAmountEur()}
                        onInput={e => setFinalAmountEur(e.currentTarget.value)}
                        class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 tabular-nums focus:border-emerald-500 focus:outline-none"
                      />
                    </div>

                    <input
                      type="text"
                      value={invoiceComment()}
                      onInput={e => setInvoiceComment(e.currentTarget.value)}
                      placeholder={t().requestDetail.invoiceCommentPlaceholder}
                      class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                    />

                    <Show when={invErr()}>
                      <p class="text-xs text-red-600 dark:text-red-400">{invErr()}</p>
                    </Show>

                    <button
                      type="submit"
                      disabled={invBusy()}
                      class="w-full rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
                    >
                      {invBusy() ? t().requestDetail.finalizingBtn : t().requestDetail.uploadInvoiceBtn}
                    </button>
                  </form>

                  {/* Cancel Order */}
                  <div class="lg:col-span-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-3">
                    <h3 class="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <XCircle class="h-4 w-4 text-rose-600 dark:text-rose-400" />
                      {t().requestDetail.cancelOrderHeading}
                    </h3>
                    <form action={cancelOrderAction} method="post" class="flex flex-col sm:flex-row gap-3">
                      <input type="hidden" name="requestId" value={d().id} />
                      <input
                        type="text"
                        name="reason"
                        required
                        value={cancelOrderReason()}
                        onInput={e => setCancelOrderReason(e.currentTarget.value)}
                        placeholder={t().requestDetail.cancelOrderPlaceholder}
                        class="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-rose-500 focus:outline-none"
                      />
                      <button
                        type="submit"
                        disabled={cancelOrderSub.pending}
                        class="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 cursor-pointer"
                      >
                        {cancelOrderSub.pending
                          ? t().requestDetail.cancellingOrderBtn
                          : t().requestDetail.cancelOrderBtn}
                      </button>
                    </form>
                    <Show when={cancelOrderSub.result instanceof Error}>
                      <p class="text-xs text-red-600 dark:text-red-400">{(cancelOrderSub.result as Error).message}</p>
                    </Show>
                  </div>
                </div>
              </Show>

              {/* Timeline & Team Discussion */}
              <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs space-y-5">
                <div class="flex items-center gap-2">
                  <MessageSquare class="h-5 w-5 text-slate-600 dark:text-slate-400" />
                  <h2 class="text-base font-bold text-slate-900 dark:text-slate-100">
                    {t().requestDetail.timelineHeading}
                  </h2>
                </div>

                <div class="space-y-4">
                  <For each={d().timeline}>
                    {entry => (
                      <div class="flex gap-3 border-l-2 border-slate-200 dark:border-slate-700 pl-4 py-1">
                        <UserAvatar
                          name={entry.actorName}
                          avatarId={entry.actorAvatarId}
                          size="sm"
                        />
                        <div class="flex-1 min-w-0 space-y-1">
                          <div class="flex flex-wrap items-center gap-2 text-xs">
                            <span class="font-bold text-slate-900 dark:text-slate-100">{entry.actorName}</span>
                            <span class="text-slate-400 dark:text-slate-500">{entry.actorTitle}</span>
                            <RoleBadge role={entry.actorRole} />
                            <span
                              title={entry.eventType}
                              class={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                                entry.eventType === "master_edited"
                                  ? "bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800/80"
                                  : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                              }`}
                            >
                              {getTimelineEventLabel(locale(), entry.eventType)}
                            </span>
                            <span class="text-slate-400 dark:text-slate-500 ml-auto">
                              {formatDateTime(entry.createdAt, locale())}
                            </span>
                          </div>
                          <p class="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{entry.comment}</p>
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
                    class="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row gap-3"
                  >
                    <input type="hidden" name="requestId" value={d().id} />
                    <input
                      type="text"
                      name="comment"
                      required
                      value={discussionText()}
                      onInput={e => setDiscussionText(e.currentTarget.value)}
                      placeholder={t().requestDetail.commentPlaceholder}
                      class="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-red-500 focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={commentSub.pending}
                      class="rounded-lg bg-slate-900 dark:bg-slate-100 px-4 py-2 text-sm font-semibold text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-white disabled:opacity-50 cursor-pointer"
                    >
                      {commentSub.pending
                        ? t().requestDetail.postingBtn
                        : t().requestDetail.postCommentBtn}
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
                        alt={t().requestDetail.fullPreviewAlt}
                        class="max-h-[85vh] rounded-xl shadow-2xl object-contain"
                      />
                      <div class="mt-3 flex justify-between items-center text-xs text-white">
                        <a
                          href={`/api/files/${attId()}`}
                          download={photos().find(p => p.id === attId())?.originalName ?? ""}
                          rel="external"
                          class="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 hover:bg-white/25"
                        >
                          <Download class="h-3.5 w-3.5" />
                          {t().common.downloadOriginal}
                        </a>
                        <button
                          type="button"
                          onClick={() => setLightboxId(null)}
                          class="rounded-lg bg-white/15 px-3 py-1.5 hover:bg-white/25 cursor-pointer"
                        >
                          {t().common.close}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </Show>

              {/* Edit Unreviewed Request Modal */}
              <Show when={editOpen()}>
                <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 dark:bg-black/75 p-4 overflow-y-auto">
                  <form
                    onSubmit={submitPreReviewEdit}
                    class="w-full max-w-2xl rounded-2xl border border-transparent dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4 my-8 max-h-[90vh] overflow-y-auto"
                  >
                    <div class="flex items-center justify-between">
                      <h3 class="text-lg font-bold text-slate-900 dark:text-slate-100">
                        {t().requestDetail.editModalHeading(d().requestCode)}
                      </h3>
                      <button
                        type="button"
                        onClick={() => setEditOpen(false)}
                        class="text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                      >
                        {t().common.close}
                      </button>
                    </div>

                    <div>
                      <label class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                        {t().common.title}
                      </label>
                      <input
                        type="text"
                        required
                        value={editTitle()}
                        onInput={e => setEditTitle(e.currentTarget.value)}
                        class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-red-500 focus:outline-none"
                      />
                    </div>

                    <CarSystemField
                      value={editCarSystem()}
                      onInput={setEditCarSystem}
                      listId="car-system-suggestions-edit"
                      compact
                    />

                    <div>
                      <label class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                        {t().common.explanation}
                      </label>
                      <textarea
                        required
                        rows={3}
                        value={editExplanation()}
                        onInput={e => setEditExplanation(e.currentTarget.value)}
                        class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-red-500 focus:outline-none"
                      />
                    </div>

                    <div class="space-y-2">
                      <div class="flex items-center justify-between">
                        <span class="text-xs font-semibold text-slate-600 dark:text-slate-400">
                          {t().requestDetail.editModalOptions}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setEditOptions(prev => [
                              ...prev,
                              { label: "", productUrl: "", priceEur: "", drawbacks: "", notes: "" }
                            ])
                          }
                          class="inline-flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400 cursor-pointer"
                        >
                          <Plus class="h-3.5 w-3.5" /> {t().requests.addOptionBtn}
                        </button>
                      </div>
                      <For each={editOptions()}>
                        {(opt, i) => (
                          <div class="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2 bg-slate-50 dark:bg-slate-800/60">
                            <div class="flex justify-between items-center text-xs">
                              <span class="font-bold text-slate-800 dark:text-slate-200">{t().requests.optionNumber(i() + 1)}</span>
                              <Show when={editOptions().length > 1}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditOptions(prev => prev.filter((_, idx) => idx !== i()))
                                  }
                                  class="text-rose-600 dark:text-rose-400 inline-flex items-center gap-1 cursor-pointer"
                                >
                                  <Trash2 class="h-3 w-3" /> {t().common.remove}
                                </button>
                              </Show>
                            </div>
                            <div class="grid grid-cols-3 gap-2">
                              <input
                                type="text"
                                required
                                value={opt.label}
                                placeholder={t().requestDetail.editModalSupplierPlaceholder}
                                onInput={e =>
                                  setEditOptions(prev =>
                                    prev.map((x, idx) =>
                                      idx === i() ? { ...x, label: e.currentTarget.value } : x
                                    )
                                  )
                                }
                                class="col-span-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                              />
                              <input
                                type="text"
                                required
                                value={opt.priceEur}
                                placeholder={t().requestDetail.editModalPricePlaceholder}
                                onInput={e =>
                                  setEditOptions(prev =>
                                    prev.map((x, idx) =>
                                      idx === i() ? { ...x, priceEur: e.currentTarget.value } : x
                                    )
                                  )
                                }
                                class="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 tabular-nums"
                              />
                            </div>
                            <input
                              type="text"
                              required
                              value={opt.drawbacks}
                              placeholder={t().requestDetail.editModalDrawbacksPlaceholder}
                              onInput={e =>
                                setEditOptions(prev =>
                                  prev.map((x, idx) =>
                                    idx === i() ? { ...x, drawbacks: e.currentTarget.value } : x
                                  )
                                )
                              }
                              class="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                            />
                            <div class="grid grid-cols-2 gap-2">
                              <input
                                type="url"
                                value={opt.productUrl}
                                placeholder={t().requestDetail.editModalUrlPlaceholder}
                                onInput={e =>
                                  setEditOptions(prev =>
                                    prev.map((x, idx) =>
                                      idx === i() ? { ...x, productUrl: e.currentTarget.value } : x
                                    )
                                  )
                                }
                                class="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                              />
                              <input
                                type="text"
                                value={opt.notes}
                                placeholder={t().requestDetail.editModalNotesPlaceholder}
                                onInput={e =>
                                  setEditOptions(prev =>
                                    prev.map((x, idx) =>
                                      idx === i() ? { ...x, notes: e.currentTarget.value } : x
                                    )
                                  )
                                }
                                class="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                              />
                            </div>
                          </div>
                        )}
                      </For>
                    </div>

                    <Show when={d().attachments.length > 0}>
                      <div class="space-y-1">
                        <span class="text-xs font-semibold text-slate-600 dark:text-slate-400">
                          {t().requestDetail.editModalAttachments}
                        </span>
                        <div class="space-y-1">
                          <For each={d().attachments}>
                            {att => (
                              <label class="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
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
                                  [{getAttachmentKindLabel(locale(), att.kind)}] {att.originalName}
                                </span>
                              </label>
                            )}
                          </For>
                        </div>
                      </div>
                    </Show>

                    <div class="grid sm:grid-cols-2 gap-3 text-xs">
                      <label class="block rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-3 text-slate-700 dark:text-slate-300 cursor-pointer">
                        <span class="font-semibold block mb-1">
                          {t().requestDetail.editModalAddPhotos}
                        </span>
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
                      <label class="block rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-3 text-slate-700 dark:text-slate-300 cursor-pointer">
                        <span class="font-semibold block mb-1">
                          {t().requestDetail.editModalAddDocs}
                        </span>
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
                      <p class="text-xs text-red-600 dark:text-red-400">{editErr()}</p>
                    </Show>

                    <div class="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setEditOpen(false)}
                        class="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        {t().common.cancel}
                      </button>
                      <button
                        type="submit"
                        disabled={editBusy()}
                        class="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer"
                      >
                        {editBusy() ? t().common.saving : t().common.saveChanges}
                      </button>
                    </div>
                  </form>
                </div>
              </Show>

              <MasterEditRequestModal
                open={masterEditOpen()}
                request={d()}
                seasons={app.seasons()}
                users={masterUsers() ?? []}
                onClose={() => setMasterEditOpen(false)}
                onSuccess={async nextCode => {
                  await refreshAll();
                  if (nextCode && params.id && nextCode !== d().requestCode && params.id !== d().id) {
                    navigate(`/requests/${nextCode}`, { replace: true });
                  }
                }}
              />

              <MasterDeleteConfirmModal
                target={deleteTarget()}
                onClose={() => setDeleteTarget(null)}
                onDeleted={async () => {
                  await revalidate(["requests-list", "budget-snapshot", "audit-logs"]);
                  navigate("/requests", { replace: true });
                }}
              />
            </div>
          );
        }}
      </Show>
    </div>
  );
}
