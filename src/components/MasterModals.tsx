import { createAsync } from "@solidjs/router";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  History,
  Plus,
  ShieldAlert,
  Trash2,
  X
} from "lucide-solid";
import { For, Show, createEffect, createSignal } from "solid-js";
import { createStore, produce, reconcile, unwrap } from "solid-js/store";
import { syncControlValue } from "~/lib/input-sync";
import {
  CAR_SYSTEM_SUGGESTIONS,
  DEPARTMENTS,
  ENTRY_CATEGORIES,
  ENTRY_STATUSES,
  REQUEST_STATUSES,
  type DepartmentId,
  type EntryCategory,
  type EntryStatus,
  type RequestStatus,
  type UserRole
} from "~/lib/constants";
import {
  formatCentsPlain,
  formatDateTime,
  formatEur,
  fromDateTimeLocalInput,
  parseEurToCents,
  toDateTimeLocalInput,
  toIsoDateInput
} from "~/lib/format";
import { computeOptionTotalCents, parseRequestQuantity } from "~/lib/workflow";
import {
  getAttachmentKindLabel,
  getAuditActionLabel,
  getDepartmentLabel,
  getEntryCategoryLabel,
  getEntryStatusLabel,
  getRequestStatusLabel,
  getRoleLabel,
  getTimelineEventLabel
} from "~/lib/i18n";
import { queryEntryItemLog } from "~/server/rpc";
import { useI18n } from "./AppContext";
import { EntryStatusBadge, RoleBadge, UserAvatar } from "./Badges";

export interface MasterOptionItem {
  id: string;
  label: string;
  productUrl: string | null;
  unitPriceCents: number;
  priceCents: number;
  drawbacks: string;
  notes: string | null;
}

export interface MasterRequestEditTarget {
  id: string;
  requestCode: string;
  seasonId: string;
  department: DepartmentId;
  carSystem: string;
  quantity: number;
  title: string;
  explanation: string;
  status: RequestStatus;
  hasApproverResponse: boolean;
  selectedOptionId: string | null;
  selectedOptionPriceCents: number | null;
  shippingCents: number;
  importFeeCents: number;
  finalAmountCents: number | null;
  orderedById: string | null;
  orderedAt: string | null;
  invoicedById: string | null;
  invoicedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  creator: { id: string; fullName: string };
  options: MasterOptionItem[];
  attachments: Array<{
    id: string;
    kind: "photo" | "document" | "invoice" | "fee_proof" | "supporting_doc" | "avatar";
    originalName: string;
  }>;
}

export interface MasterEntryEditTarget {
  id: string;
  seasonId: string;
  entryCode: string;
  title: string;
  category: EntryCategory;
  status: EntryStatus;
  initialAmountCents: number;
  confirmedAmountCents: number | null;
  entryDate: string;
  comment: string;
  createdById: string;
  confirmedById: string | null;
  confirmedAt: string | null;
  createdAt: string;
  attachments: Array<{ id: string; kind: string; originalName: string }>;
}

export interface MasterDeleteTarget {
  kind: "request" | "entry";
  id: string;
  code: string;
  title: string;
  statusLabel?: string;
  attachmentCount?: number;
}

type RequestAttKind = "photo" | "document" | "invoice" | "fee_proof";
type EntryAttKind = "supporting_doc" | "invoice";

export function MasterEditRequestModal(props: {
  open: boolean;
  request: MasterRequestEditTarget | null;
  seasons: Array<{ id: string; name: string; yearCode: string; status: string }>;
  users: Array<{ id: string; fullName: string; title: string; role: string }>;
  onClose: () => void;
  onSuccess: (nextRequestCode: string) => Promise<void>;
}) {
  const { locale, t } = useI18n();
  const [requestCode, setRequestCode] = createSignal("");
  const [seasonId, setSeasonId] = createSignal("");
  const [department, setDepartment] = createSignal<DepartmentId>("powertrain");
  const [carSystem, setCarSystem] = createSignal("");
  const [quantityStr, setQuantityStr] = createSignal("1");
  const [status, setStatus] = createSignal<RequestStatus>("pending_review");
  const [hasApproverResponse, setHasApproverResponse] = createSignal(false);
  const [title, setTitle] = createSignal("");
  const [explanation, setExplanation] = createSignal("");
  const [creatorId, setCreatorId] = createSignal("");
  const [selectedOptionClientKey, setSelectedOptionClientKey] = createSignal("");
  const [selectedOptionPriceEur, setSelectedOptionPriceEur] = createSignal("");
  const [shippingEur, setShippingEur] = createSignal("0.00");
  const [importFeeEur, setImportFeeEur] = createSignal("0.00");
  const [finalAmountEur, setFinalAmountEur] = createSignal("");
  const [orderedById, setOrderedById] = createSignal("");
  const [orderedAt, setOrderedAt] = createSignal("");
  const [invoicedById, setInvoicedById] = createSignal("");
  const [invoicedAt, setInvoicedAt] = createSignal("");
  const [archivedAt, setArchivedAt] = createSignal("");
  const [createdAt, setCreatedAt] = createSignal("");

  const [options, setOptions] = createStore<
    Array<{
      id: string | null;
      clientKey: string;
      label: string;
      productUrl: string;
      unitPriceEur: string;
      drawbacks: string;
      notes: string;
    }>
  >([]);
  const [attUpdates, setAttUpdates] = createStore<
    Array<{ id: string; originalName: string; kind: RequestAttKind }>
  >([]);
  const [removeAttIds, setRemoveAttIds] = createSignal<string[]>([]);
  const [newPhotos, setNewPhotos] = createSignal<File[]>([]);
  const [newDocs, setNewDocs] = createSignal<File[]>([]);
  const [newFeeProofs, setNewFeeProofs] = createSignal<File[]>([]);
  const [newInvoices, setNewInvoices] = createSignal<File[]>([]);
  const [editReason, setEditReason] = createSignal("");

  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal("");
  let newOptCounter = 0;

  const computeMasterOptionTotalCents = (rawUnitEur: string): number | null => {
    const qty = parseRequestQuantity(quantityStr());
    const unitCents = parseEurToCents(rawUnitEur, { allowZero: true });
    if (qty === null || unitCents === null) return null;
    return computeOptionTotalCents(unitCents, qty);
  };

  createEffect(() => {
    const r = props.open ? props.request : null;
    if (!r) return;
    setRequestCode(r.requestCode);
    setSeasonId(r.seasonId);
    setDepartment(r.department);
    setCarSystem(r.carSystem);
    setQuantityStr(String(r.quantity ?? 1));
    setStatus(r.status);
    setHasApproverResponse(r.hasApproverResponse);
    setTitle(r.title);
    setExplanation(r.explanation);
    setCreatorId(r.creator.id);
    setSelectedOptionClientKey(r.selectedOptionId ?? "");
    setSelectedOptionPriceEur(
      r.selectedOptionPriceCents !== null ? formatCentsPlain(r.selectedOptionPriceCents) : ""
    );
    setShippingEur(formatCentsPlain(r.shippingCents));
    setImportFeeEur(formatCentsPlain(r.importFeeCents));
    setFinalAmountEur(r.finalAmountCents !== null ? formatCentsPlain(r.finalAmountCents) : "");
    setOrderedById(r.orderedById ?? "");
    setOrderedAt(toDateTimeLocalInput(r.orderedAt));
    setInvoicedById(r.invoicedById ?? "");
    setInvoicedAt(toDateTimeLocalInput(r.invoicedAt));
    setArchivedAt(toDateTimeLocalInput(r.archivedAt));
    setCreatedAt(toDateTimeLocalInput(r.createdAt));

    setOptions(
      reconcile(
        r.options.map(o => ({
          id: o.id,
          clientKey: o.id,
          label: o.label,
          productUrl: o.productUrl ?? "",
          unitPriceEur: formatCentsPlain(o.unitPriceCents ?? o.priceCents),
          drawbacks: o.drawbacks,
          notes: o.notes ?? ""
        }))
      )
    );
    setAttUpdates(
      reconcile(
        r.attachments.map(a => ({
          id: a.id,
          originalName: a.originalName,
          kind: (["photo", "document", "invoice", "fee_proof"].includes(a.kind)
            ? a.kind
            : "document") as RequestAttKind
        }))
      )
    );
    setRemoveAttIds([]);
    setNewPhotos([]);
    setNewDocs([]);
    setNewFeeProofs([]);
    setNewInvoices([]);
    setEditReason("");
    setErr("");
  });

  function moveOption(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= options.length) return;
    setOptions(
      produce(draft => {
        const [item] = draft.splice(index, 1);
        draft.splice(target, 0, item);
      })
    );
  }

  function removeOption(clientKey: string) {
    setOptions(
      produce(draft => {
        const idx = draft.findIndex(o => o.clientKey === clientKey);
        if (idx !== -1) draft.splice(idx, 1);
      })
    );
    if (selectedOptionClientKey() === clientKey) {
      setSelectedOptionClientKey("");
    }
  }

  function syncPriceFromSelectedOption() {
    const chosen = options.find(o => o.clientKey === selectedOptionClientKey());
    if (!chosen) return;
    const totalCents = computeMasterOptionTotalCents(chosen.unitPriceEur);
    if (totalCents !== null) {
      setSelectedOptionPriceEur(formatCentsPlain(totalCents));
    }
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const req = props.request;
    if (!req) return;
    const qty = parseRequestQuantity(quantityStr());
    if (qty === null) {
      setErr(t().requests.invalidQuantityPreview);
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const fd = new FormData();
      fd.set(
        "payload",
        JSON.stringify({
          requestCode: requestCode(),
          seasonId: seasonId(),
          department: department(),
          carSystem: carSystem(),
          quantity: qty,
          title: title(),
          explanation: explanation(),
          status: status(),
          creatorId: creatorId(),
          hasApproverResponse: hasApproverResponse(),
          selectedOptionClientKey: selectedOptionClientKey() || null,
          selectedOptionPriceEur: selectedOptionPriceEur().trim() || null,
          shippingEur: shippingEur(),
          importFeeEur: importFeeEur(),
          finalAmountEur: finalAmountEur().trim() || null,
          orderedById: orderedById() || null,
          orderedAt: fromDateTimeLocalInput(orderedAt()),
          invoicedById: invoicedById() || null,
          invoicedAt: fromDateTimeLocalInput(invoicedAt()),
          archivedAt: fromDateTimeLocalInput(archivedAt()),
          createdAt: fromDateTimeLocalInput(createdAt()) ?? req.createdAt,
          options: unwrap(options).map(o => ({
            id: o.id,
            clientKey: o.clientKey,
            label: o.label,
            productUrl: o.productUrl.trim() || null,
            unitPriceEur: o.unitPriceEur,
            drawbacks: o.drawbacks,
            notes: o.notes.trim() || null
          })),
          attachmentUpdates: unwrap(attUpdates),
          removeAttachmentIds: removeAttIds(),
          editReason: editReason()
        })
      );
      for (const f of newPhotos()) fd.append("photos", f);
      for (const f of newDocs()) fd.append("documents", f);
      for (const f of newFeeProofs()) fd.append("feeProofs", f);
      for (const f of newInvoices()) fd.append("invoices", f);

      const res = await fetch(`/api/requests/${req.id}/master-edit`, {
        method: "POST",
        body: fd
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || t().masterModals.failedMasterRequestErr);
      const nextCode = typeof json.requestCode === "string" ? json.requestCode : requestCode();
      props.onClose();
      await props.onSuccess(nextCode);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : t().masterModals.failedMasterRequestErr);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Show when={props.open && props.request}>
      {req => (
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 dark:bg-black/80 p-4 overflow-y-auto">
          <form
            onSubmit={submit}
            class="w-full max-w-4xl rounded-2xl bg-white dark:bg-slate-900 dark:border dark:border-slate-800 p-6 shadow-2xl space-y-5 my-6 max-h-[92vh] overflow-y-auto"
          >
            <div class="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <div class="inline-flex items-center gap-1.5 rounded-full bg-red-50 dark:bg-red-950/60 dark:border dark:border-red-900/60 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-red-700 dark:text-red-300 mb-1">
                  <ShieldAlert class="h-3.5 w-3.5" />
                  {t().masterModals.badgeUnrestricted}
                </div>
                <h3 class="text-lg font-extrabold text-slate-900 dark:text-slate-100">
                  {t().masterModals.editRequestTitle(req().requestCode)}
                </h3>
                <p class="text-xs text-slate-500 dark:text-slate-400">
                  {t().masterModals.editRequestSubtitle}
                </p>
              </div>
              <button
                type="button"
                onClick={props.onClose}
                class="text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200 cursor-pointer"
              >
                <X class="h-5 w-5" />
              </button>
            </div>

            {/* A. Identity, Season, Department, Status */}
            <div class="grid sm:grid-cols-3 gap-3">
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  {t().masterModals.requestIdCode}
                </label>
                <input
                  type="text"
                  required
                  value={requestCode()}
                  onInput={e => setRequestCode(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm font-mono uppercase"
                />
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  {t().common.season}
                </label>
                <select
                  value={seasonId()}
                  onChange={e => setSeasonId(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm"
                >
                  <For each={props.seasons}>
                    {s => (
                      <option value={s.id}>
                        {s.name} ({s.yearCode}){s.status === "archived" ? t().masterModals.archivedSuffix : ""}
                      </option>
                    )}
                  </For>
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  {t().common.department}
                </label>
                <select
                  value={department()}
                  onChange={e => setDepartment(e.currentTarget.value as DepartmentId)}
                  class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm"
                >
                  <For each={DEPARTMENTS}>
                    {d => (
                      <option value={d.id}>
                        {getDepartmentLabel(locale(), d.id)} ({d.code})
                      </option>
                    )}
                  </For>
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  {t().common.status}
                </label>
                <select
                  value={status()}
                  onChange={e => setStatus(e.currentTarget.value as RequestStatus)}
                  class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm"
                >
                  <For each={REQUEST_STATUSES}>
                    {st => <option value={st}>{getRequestStatusLabel(locale(), st)}</option>}
                  </For>
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  {t().masterModals.carSystemOptLabel}
                </label>
                <input
                  type="text"
                  maxLength={120}
                  list="master-car-system-list"
                  value={carSystem()}
                  onInput={e => setCarSystem(e.currentTarget.value)}
                  placeholder={t().masterModals.carSystemOptPlaceholder}
                  class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 px-3 py-2 text-sm"
                />
                <datalist id="master-car-system-list">
                  <For each={CAR_SYSTEM_SUGGESTIONS}>
                    {item => <option value={item} />}
                  </For>
                </datalist>
              </div>
              <div class="flex items-end pb-2">
                <label class="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasApproverResponse()}
                    onChange={e => setHasApproverResponse(e.currentTarget.checked)}
                    class="h-4 w-4 accent-red-600"
                  />
                  <span>{t().masterModals.hasApproverResponse}</span>
                </label>
              </div>
            </div>

            {/* B. Title & Explanation */}
            <div class="space-y-3">
              <div class="grid sm:grid-cols-4 gap-3">
                <div class="sm:col-span-3">
                  <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    {t().common.title}
                  </label>
                  <input
                    type="text"
                    required
                    value={title()}
                    onInput={e => setTitle(e.currentTarget.value)}
                    class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    {t().masterModals.quantityLabel}
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    max={100000}
                    step={1}
                    value={quantityStr()}
                    onInput={e => setQuantityStr(e.currentTarget.value)}
                    class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm tabular-nums"
                  />
                </div>
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  {t().common.explanation}
                </label>
                <textarea
                  rows={3}
                  value={explanation()}
                  onInput={e => setExplanation(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm"
                />
              </div>
            </div>

            {/* C. Ownership & Lifecycle Timestamps */}
            <div class="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 p-4 space-y-3">
              <h4 class="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {t().masterModals.ownershipTimestampsHeading}
              </h4>
              <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    {t().common.creator}
                  </label>
                  <select
                    value={creatorId()}
                    onChange={e => setCreatorId(e.currentTarget.value)}
                    class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-2 text-xs"
                  >
                    <For each={props.users}>
                      {u => (
                        <option value={u.id}>
                          {u.fullName} ({getRoleLabel(locale(), u.role as UserRole)})
                        </option>
                      )}
                    </For>
                  </select>
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    {t().common.createdAt}
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={createdAt()}
                    onInput={e => setCreatedAt(e.currentTarget.value)}
                    class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    {t().masterModals.orderedBy}
                  </label>
                  <select
                    value={orderedById()}
                    onChange={e => setOrderedById(e.currentTarget.value)}
                    class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-2 text-xs"
                  >
                    <option value="">{t().common.none}</option>
                    <For each={props.users}>
                      {u => <option value={u.id}>{u.fullName}</option>}
                    </For>
                  </select>
                </div>
                <div>
                  <div class="flex items-center justify-between mb-1">
                    <label class="text-xs font-semibold text-slate-600 dark:text-slate-300">
                      {t().masterModals.orderedAt}
                    </label>
                    <Show when={orderedAt()}>
                      <button
                        type="button"
                        onClick={() => setOrderedAt("")}
                        class="text-[11px] text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                      >
                        {t().common.clear}
                      </button>
                    </Show>
                  </div>
                  <input
                    type="datetime-local"
                    value={orderedAt()}
                    onInput={e => setOrderedAt(e.currentTarget.value)}
                    class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    {t().masterModals.invoicedBy}
                  </label>
                  <select
                    value={invoicedById()}
                    onChange={e => setInvoicedById(e.currentTarget.value)}
                    class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-2 text-xs"
                  >
                    <option value="">{t().common.none}</option>
                    <For each={props.users}>
                      {u => <option value={u.id}>{u.fullName}</option>}
                    </For>
                  </select>
                </div>
                <div>
                  <div class="flex items-center justify-between mb-1">
                    <label class="text-xs font-semibold text-slate-600 dark:text-slate-300">
                      {t().masterModals.invoicedAt}
                    </label>
                    <Show when={invoicedAt()}>
                      <button
                        type="button"
                        onClick={() => setInvoicedAt("")}
                        class="text-[11px] text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                      >
                        {t().common.clear}
                      </button>
                    </Show>
                  </div>
                  <input
                    type="datetime-local"
                    value={invoicedAt()}
                    onInput={e => setInvoicedAt(e.currentTarget.value)}
                    class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <div class="flex items-center justify-between mb-1">
                    <label class="text-xs font-semibold text-slate-600 dark:text-slate-300">
                      {t().masterModals.archivedAt}
                    </label>
                    <Show when={archivedAt()}>
                      <button
                        type="button"
                        onClick={() => setArchivedAt("")}
                        class="text-[11px] text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                      >
                        {t().common.clear}
                      </button>
                    </Show>
                  </div>
                  <input
                    type="datetime-local"
                    value={archivedAt()}
                    onInput={e => setArchivedAt(e.currentTarget.value)}
                    class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 text-xs"
                  />
                </div>
              </div>
            </div>

            {/* D. Amounts & Selected Option */}
            <div class="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 p-4 space-y-3">
              <h4 class="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {t().masterModals.selectedOptionFinancialsHeading}
              </h4>
              <div class="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <div class="lg:col-span-2">
                  <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    {t().masterModals.selectedBuyingOption}
                  </label>
                  <select
                    value={selectedOptionClientKey()}
                    onChange={e => setSelectedOptionClientKey(e.currentTarget.value)}
                    class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-2 text-xs"
                  >
                    <option value="">{t().common.noneSelected}</option>
                    <For each={options}>
                      {(opt, idx) => {
                        const totCents = () => computeMasterOptionTotalCents(opt.unitPriceEur);
                        return (
                          <option value={opt.clientKey}>
                            {t().masterModals.optionNumber(idx() + 1)}: {opt.label || t().common.untitled} (
                            {totCents() !== null ? formatCentsPlain(totCents()!) : (opt.unitPriceEur || "0")} €)
                          </option>
                        );
                      }}
                    </For>
                  </select>
                </div>
                <div>
                  <div class="flex items-center justify-between mb-1">
                    <label class="text-xs font-semibold text-slate-600 dark:text-slate-300">
                      {t().masterModals.basePriceOverride}
                    </label>
                    <Show when={selectedOptionClientKey()}>
                      <button
                        type="button"
                        onClick={syncPriceFromSelectedOption}
                        class="text-[10px] font-semibold text-red-600 dark:text-red-400 hover:underline cursor-pointer"
                      >
                        {t().common.sync}
                      </button>
                    </Show>
                  </div>
                  <input
                    type="text"
                    value={selectedOptionPriceEur()}
                    onInput={e => setSelectedOptionPriceEur(e.currentTarget.value)}
                    placeholder={t().common.blankEqualsNone}
                    class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 px-2.5 py-1.5 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    {t().masterModals.shippingEur}
                  </label>
                  <input
                    type="text"
                    required
                    value={shippingEur()}
                    onInput={e => setShippingEur(e.currentTarget.value)}
                    class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    {t().masterModals.importFeeEur}
                  </label>
                  <input
                    type="text"
                    required
                    value={importFeeEur()}
                    onInput={e => setImportFeeEur(e.currentTarget.value)}
                    class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 text-sm tabular-nums"
                  />
                </div>
              </div>
              <div class="max-w-xs">
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  {t().masterModals.finalInvoicedAmountBlank}
                </label>
                <input
                  type="text"
                  value={finalAmountEur()}
                  onInput={e => setFinalAmountEur(e.currentTarget.value)}
                  placeholder={t().common.blankEqualsNone}
                  class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 px-3 py-1.5 text-sm tabular-nums font-semibold"
                />
              </div>
            </div>

            {/* E. Buying Options */}
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <h4 class="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {t().masterModals.buyingOptionsCount(options.length)}
                </h4>
                <button
                  type="button"
                  onClick={() => {
                    newOptCounter += 1;
                    setOptions(options.length, {
                      id: null,
                      clientKey: `new-${Date.now()}-${newOptCounter}`,
                      label: "",
                      productUrl: "",
                      unitPriceEur: "0.00",
                      drawbacks: "",
                      notes: ""
                    });
                  }}
                  class="inline-flex items-center gap-1 rounded-lg bg-slate-900 dark:bg-slate-100 px-2.5 py-1 text-xs font-semibold text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-white cursor-pointer"
                >
                  <Plus class="h-3.5 w-3.5" />
                  {t().masterModals.addOption}
                </button>
              </div>
              <div class="space-y-2">
                <For each={options}>
                  {(opt, i) => (
                    <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-3 space-y-2">
                      <div class="flex items-center justify-between text-xs">
                        <span class="font-bold text-slate-700 dark:text-slate-200">
                          {t().masterModals.optionNumber(i() + 1)}
                          <Show when={selectedOptionClientKey() === opt.clientKey}>
                            <span class="ml-2 rounded bg-emerald-100 dark:bg-emerald-950/60 dark:border dark:border-emerald-800/70 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800 dark:text-emerald-300">
                              {t().masterModals.selectedTag}
                            </span>
                          </Show>
                        </span>
                        <div class="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={i() === 0}
                            onClick={() => moveOption(i(), -1)}
                            class="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 disabled:opacity-30 cursor-pointer"
                            title={t().common.moveUp}
                          >
                            <ArrowUp class="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            disabled={i() === options.length - 1}
                            onClick={() => moveOption(i(), 1)}
                            class="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 disabled:opacity-30 cursor-pointer"
                            title={t().common.moveDown}
                          >
                            <ArrowDown class="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeOption(opt.clientKey)}
                            class="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-semibold cursor-pointer"
                          >
                            <Trash2 class="h-3 w-3" />
                            {t().common.remove}
                          </button>
                        </div>
                      </div>
                      <div class="grid sm:grid-cols-4 gap-2">
                        <input
                          ref={syncControlValue(() => opt.label)}
                          type="text"
                          required
                          placeholder={t().masterModals.supplierPlaceholder}
                          onInput={e => setOptions(i(), "label", e.currentTarget.value)}
                          class="sm:col-span-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 px-2.5 py-1.5 text-xs"
                        />
                        <input
                          ref={syncControlValue(() => opt.unitPriceEur)}
                          type="text"
                          required
                          placeholder={t().masterModals.unitPricePlaceholder}
                          onInput={e => setOptions(i(), "unitPriceEur", e.currentTarget.value)}
                          class="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 px-2.5 py-1.5 text-xs tabular-nums"
                        />
                        <div class="rounded border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 px-2.5 py-1.5 text-xs font-bold tabular-nums text-slate-800 dark:text-slate-200 flex items-center justify-end">
                          {(() => {
                            const tot = computeMasterOptionTotalCents(opt.unitPriceEur);
                            return tot !== null
                              ? t().masterModals.computedTotalLabel(formatEur(tot, locale()))
                              : "—";
                          })()}
                        </div>
                      </div>
                      <input
                        ref={syncControlValue(() => opt.drawbacks)}
                        type="text"
                        placeholder={t().masterModals.drawbacksOptionalPlaceholder}
                        onInput={e => setOptions(i(), "drawbacks", e.currentTarget.value)}
                        class="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 px-2.5 py-1.5 text-xs"
                      />
                      <div class="grid sm:grid-cols-2 gap-2">
                        <input
                          ref={syncControlValue(() => opt.productUrl)}
                          type="url"
                          placeholder={t().masterModals.urlOptionalPlaceholder}
                          onInput={e => setOptions(i(), "productUrl", e.currentTarget.value)}
                          class="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 px-2.5 py-1.5 text-xs"
                        />
                        <input
                          ref={syncControlValue(() => opt.notes)}
                          type="text"
                          placeholder={t().masterModals.notesOptionalPlaceholder}
                          onInput={e => setOptions(i(), "notes", e.currentTarget.value)}
                          class="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 px-2.5 py-1.5 text-xs"
                        />
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>

            {/* F. Attachments */}
            <div class="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
              <h4 class="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {t().masterModals.attachmentsExistingCount(attUpdates.length)}
              </h4>
              <Show when={attUpdates.length > 0}>
                <div class="space-y-2">
                  <For each={attUpdates}>
                    {(att, idx) => (
                      <div class="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 p-2 text-xs">
                        <select
                          value={att.kind}
                          onChange={e =>
                            setAttUpdates(idx(), "kind", e.currentTarget.value as RequestAttKind)
                          }
                          class="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2 py-1 text-xs"
                        >
                          <option value="photo">{getAttachmentKindLabel(locale(), "photo")}</option>
                          <option value="document">{getAttachmentKindLabel(locale(), "document")}</option>
                          <option value="fee_proof">{getAttachmentKindLabel(locale(), "fee_proof")}</option>
                          <option value="invoice">{getAttachmentKindLabel(locale(), "invoice")}</option>
                        </select>
                        <input
                          ref={syncControlValue(() => att.originalName)}
                          type="text"
                          required
                          onInput={e =>
                            setAttUpdates(idx(), "originalName", e.currentTarget.value)
                          }
                          class="flex-1 min-w-[160px] rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2 py-1 text-xs"
                        />
                        <label class="inline-flex items-center gap-1.5 text-rose-700 dark:text-rose-400 font-semibold cursor-pointer">
                          <input
                            type="checkbox"
                            checked={removeAttIds().includes(att.id)}
                            onChange={e => {
                              const checked = e.currentTarget.checked;
                              setRemoveAttIds(prev =>
                                checked ? [...prev, att.id] : prev.filter(id => id !== att.id)
                              );
                            }}
                          />
                          {t().common.remove}
                        </label>
                      </div>
                    )}
                  </For>
                </div>
              </Show>

              <div class="grid sm:grid-cols-4 gap-2 text-xs">
                <label class="block rounded-lg border border-dashed border-slate-300 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-300 dark:hover:border-slate-500 p-2.5 cursor-pointer">
                  <span class="font-semibold block mb-1">{t().masterModals.addPhotos}</span>
                  <input
                    type="file"
                    multiple
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={e =>
                      setNewPhotos(e.currentTarget.files ? Array.from(e.currentTarget.files) : [])
                    }
                    class="w-full text-[11px] dark:text-slate-400 file:mr-2 file:rounded file:border-0 file:bg-slate-100 dark:file:bg-slate-800 file:px-2 file:py-1 file:text-[11px] file:font-semibold file:text-slate-700 dark:file:text-slate-200"
                  />
                </label>
                <label class="block rounded-lg border border-dashed border-slate-300 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-300 dark:hover:border-slate-500 p-2.5 cursor-pointer">
                  <span class="font-semibold block mb-1">{t().masterModals.addDocuments}</span>
                  <input
                    type="file"
                    multiple
                    onChange={e =>
                      setNewDocs(e.currentTarget.files ? Array.from(e.currentTarget.files) : [])
                    }
                    class="w-full text-[11px] dark:text-slate-400 file:mr-2 file:rounded file:border-0 file:bg-slate-100 dark:file:bg-slate-800 file:px-2 file:py-1 file:text-[11px] file:font-semibold file:text-slate-700 dark:file:text-slate-200"
                  />
                </label>
                <label class="block rounded-lg border border-dashed border-slate-300 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-300 dark:hover:border-slate-500 p-2.5 cursor-pointer">
                  <span class="font-semibold block mb-1">{t().masterModals.addFeeProofs}</span>
                  <input
                    type="file"
                    multiple
                    onChange={e =>
                      setNewFeeProofs(
                        e.currentTarget.files ? Array.from(e.currentTarget.files) : []
                      )
                    }
                    class="w-full text-[11px] dark:text-slate-400 file:mr-2 file:rounded file:border-0 file:bg-slate-100 dark:file:bg-slate-800 file:px-2 file:py-1 file:text-[11px] file:font-semibold file:text-slate-700 dark:file:text-slate-200"
                  />
                </label>
                <label class="block rounded-lg border border-dashed border-slate-300 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-300 dark:hover:border-slate-500 p-2.5 cursor-pointer">
                  <span class="font-semibold block mb-1">{t().masterModals.addInvoices}</span>
                  <input
                    type="file"
                    multiple
                    onChange={e =>
                      setNewInvoices(
                        e.currentTarget.files ? Array.from(e.currentTarget.files) : []
                      )
                    }
                    class="w-full text-[11px] dark:text-slate-400 file:mr-2 file:rounded file:border-0 file:bg-slate-100 dark:file:bg-slate-800 file:px-2 file:py-1 file:text-[11px] file:font-semibold file:text-slate-700 dark:file:text-slate-200"
                  />
                </label>
              </div>
            </div>

            {/* G. Edit Reason */}
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                {t().masterModals.editReasonLabel}
              </label>
              <input
                type="text"
                value={editReason()}
                onInput={e => setEditReason(e.currentTarget.value)}
                placeholder={t().masterModals.editReasonRequestPlaceholder}
                class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 px-3 py-2 text-sm"
              />
            </div>

            <Show when={err()}>
              <p class="text-xs font-medium text-red-600 dark:text-red-400">{err()}</p>
            </Show>

            <div class="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={props.onClose}
                class="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                {t().common.cancel}
              </button>
              <button
                type="submit"
                disabled={busy()}
                class="rounded-lg bg-red-600 px-5 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer"
              >
                {busy() ? t().masterModals.savingLoggingBtn : t().masterModals.saveMasterChangesBtn}
              </button>
            </div>
          </form>
        </div>
      )}
    </Show>
  );
}

export function MasterEditEntryModal(props: {
  target: MasterEntryEditTarget | null;
  seasons: Array<{ id: string; name: string; yearCode: string; status: string }>;
  users: Array<{ id: string; fullName: string; title: string; role: string }>;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
  const { locale, t } = useI18n();
  const [entryCode, setEntryCode] = createSignal("");
  const [seasonId, setSeasonId] = createSignal("");
  const [title, setTitle] = createSignal("");
  const [category, setCategory] = createSignal<EntryCategory>("sponsorship");
  const [status, setStatus] = createSignal<EntryStatus>("provisional");
  const [initialAmountEur, setInitialAmountEur] = createSignal("");
  const [confirmedAmountEur, setConfirmedAmountEur] = createSignal("");
  const [entryDate, setEntryDate] = createSignal("");
  const [comment, setComment] = createSignal("");
  const [createdById, setCreatedById] = createSignal("");
  const [confirmedById, setConfirmedById] = createSignal("");
  const [confirmedAt, setConfirmedAt] = createSignal("");
  const [createdAt, setCreatedAt] = createSignal("");

  const [attUpdates, setAttUpdates] = createStore<
    Array<{ id: string; originalName: string; kind: EntryAttKind }>
  >([]);
  const [removeAttIds, setRemoveAttIds] = createSignal<string[]>([]);
  const [newSupporting, setNewSupporting] = createSignal<File[]>([]);
  const [newInvoices, setNewInvoices] = createSignal<File[]>([]);
  const [editReason, setEditReason] = createSignal("");

  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal("");

  createEffect(() => {
    const target = props.target;
    if (!target) return;
    setEntryCode(target.entryCode);
    setSeasonId(target.seasonId);
    setTitle(target.title);
    setCategory(target.category);
    setStatus(target.status);
    setInitialAmountEur(formatCentsPlain(target.initialAmountCents));
    setConfirmedAmountEur(
      target.confirmedAmountCents !== null ? formatCentsPlain(target.confirmedAmountCents) : ""
    );
    setEntryDate(toIsoDateInput(target.entryDate));
    setComment(target.comment);
    setCreatedById(target.createdById);
    setConfirmedById(target.confirmedById ?? "");
    setConfirmedAt(toDateTimeLocalInput(target.confirmedAt));
    setCreatedAt(toDateTimeLocalInput(target.createdAt));

    setAttUpdates(
      reconcile(
        target.attachments.map(a => ({
          id: a.id,
          originalName: a.originalName,
          kind: (a.kind === "invoice" ? "invoice" : "supporting_doc") as EntryAttKind
        }))
      )
    );
    setRemoveAttIds([]);
    setNewSupporting([]);
    setNewInvoices([]);
    setEditReason("");
    setErr("");
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const target = props.target;
    if (!target) return;
    setBusy(true);
    setErr("");
    try {
      const fd = new FormData();
      fd.set(
        "payload",
        JSON.stringify({
          entryCode: entryCode(),
          seasonId: seasonId(),
          title: title(),
          category: category(),
          status: status(),
          initialAmountEur: initialAmountEur(),
          confirmedAmountEur: confirmedAmountEur().trim() || null,
          entryDate: entryDate(),
          comment: comment(),
          createdById: createdById(),
          confirmedById: confirmedById() || null,
          confirmedAt: fromDateTimeLocalInput(confirmedAt()),
          createdAt: fromDateTimeLocalInput(createdAt()) ?? target.createdAt,
          attachmentUpdates: unwrap(attUpdates),
          removeAttachmentIds: removeAttIds(),
          editReason: editReason()
        })
      );
      for (const f of newSupporting()) fd.append("supportingFiles", f);
      for (const f of newInvoices()) fd.append("invoiceFiles", f);

      const res = await fetch(`/api/entries/${target.id}/master-edit`, {
        method: "POST",
        body: fd
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || t().masterModals.failedMasterEntryErr);

      props.onClose();
      await props.onSuccess();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : t().masterModals.failedMasterEntryErr);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Show when={props.target}>
      {target => (
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 dark:bg-black/80 p-4 overflow-y-auto">
          <form
            onSubmit={submit}
            class="w-full max-w-3xl rounded-2xl bg-white dark:bg-slate-900 dark:border dark:border-slate-800 p-6 shadow-2xl space-y-5 my-6 max-h-[92vh] overflow-y-auto"
          >
            <div class="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <div class="inline-flex items-center gap-1.5 rounded-full bg-red-50 dark:bg-red-950/60 dark:border dark:border-red-900/60 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-red-700 dark:text-red-300 mb-1">
                  <ShieldAlert class="h-3.5 w-3.5" />
                  {t().masterModals.badgeUnrestricted}
                </div>
                <h3 class="text-lg font-extrabold text-slate-900 dark:text-slate-100">
                  {t().masterModals.editEntryTitle(target().entryCode)}
                </h3>
                <p class="text-xs text-slate-500 dark:text-slate-400">
                  {t().masterModals.editEntrySubtitle}
                </p>
              </div>
              <button
                type="button"
                onClick={props.onClose}
                class="text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200 cursor-pointer"
              >
                <X class="h-5 w-5" />
              </button>
            </div>

            <div class="grid sm:grid-cols-3 gap-3">
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  {t().masterModals.entryIdCode}
                </label>
                <input
                  type="text"
                  required
                  value={entryCode()}
                  onInput={e => setEntryCode(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm font-mono uppercase"
                />
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  {t().common.season}
                </label>
                <select
                  value={seasonId()}
                  onChange={e => setSeasonId(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm"
                >
                  <For each={props.seasons}>
                    {s => (
                      <option value={s.id}>
                        {s.name} ({s.yearCode}){s.status === "archived" ? t().masterModals.archivedSuffix : ""}
                      </option>
                    )}
                  </For>
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  {t().budgetModals.entryDate}
                </label>
                <input
                  type="date"
                  required
                  value={entryDate()}
                  onInput={e => setEntryDate(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  {t().common.category}
                </label>
                <select
                  value={category()}
                  onChange={e => setCategory(e.currentTarget.value as EntryCategory)}
                  class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm"
                >
                  <For each={ENTRY_CATEGORIES}>
                    {c => <option value={c.id}>{getEntryCategoryLabel(locale(), c.id)}</option>}
                  </For>
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  {t().common.status}
                </label>
                <select
                  value={status()}
                  onChange={e => setStatus(e.currentTarget.value as EntryStatus)}
                  class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm"
                >
                  <For each={ENTRY_STATUSES}>
                    {st => <option value={st}>{getEntryStatusLabel(locale(), st)}</option>}
                  </For>
                </select>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    {t().masterModals.initialEur}
                  </label>
                  <input
                    type="text"
                    required
                    value={initialAmountEur()}
                    onInput={e => setInitialAmountEur(e.currentTarget.value)}
                    class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-2 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    {t().masterModals.confirmedEur}
                  </label>
                  <input
                    type="text"
                    value={confirmedAmountEur()}
                    onInput={e => setConfirmedAmountEur(e.currentTarget.value)}
                    placeholder={t().common.blankEqualsNone}
                    class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 px-2.5 py-2 text-sm tabular-nums"
                  />
                </div>
              </div>
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                {t().budgetModals.titleEntityLabel}
              </label>
              <input
                type="text"
                required
                value={title()}
                onInput={e => setTitle(e.currentTarget.value)}
                class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                {t().masterModals.commentNotes}
              </label>
              <textarea
                rows={3}
                value={comment()}
                onInput={e => setComment(e.currentTarget.value)}
                class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm"
              />
            </div>

            <div class="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 p-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  {t().common.creator}
                </label>
                <select
                  value={createdById()}
                  onChange={e => setCreatedById(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-2 text-xs"
                >
                  <For each={props.users}>
                    {u => <option value={u.id}>{u.fullName}</option>}
                  </For>
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  {t().common.createdAt}
                </label>
                <input
                  type="datetime-local"
                  required
                  value={createdAt()}
                  onInput={e => setCreatedAt(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 text-xs"
                />
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  {t().masterModals.confirmedBy}
                </label>
                <select
                  value={confirmedById()}
                  onChange={e => setConfirmedById(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-2 text-xs"
                >
                  <option value="">{t().common.none}</option>
                  <For each={props.users}>
                    {u => <option value={u.id}>{u.fullName}</option>}
                  </For>
                </select>
              </div>
              <div>
                <div class="flex items-center justify-between mb-1">
                  <label class="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    {t().masterModals.confirmedAt}
                  </label>
                  <Show when={confirmedAt()}>
                    <button
                      type="button"
                      onClick={() => setConfirmedAt("")}
                      class="text-[11px] text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                    >
                      {t().common.clear}
                    </button>
                  </Show>
                </div>
                <input
                  type="datetime-local"
                  value={confirmedAt()}
                  onInput={e => setConfirmedAt(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 text-xs"
                />
              </div>
            </div>

            <div class="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
              <h4 class="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {t().masterModals.attachmentsExistingCount(attUpdates.length)}
              </h4>
              <Show when={attUpdates.length > 0}>
                <div class="space-y-2">
                  <For each={attUpdates}>
                    {(att, idx) => (
                      <div class="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 p-2 text-xs">
                        <select
                          value={att.kind}
                          onChange={e =>
                            setAttUpdates(idx(), "kind", e.currentTarget.value as EntryAttKind)
                          }
                          class="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2 py-1 text-xs"
                        >
                          <option value="supporting_doc">
                            {getAttachmentKindLabel(locale(), "supporting_doc")}
                          </option>
                          <option value="invoice">
                            {getAttachmentKindLabel(locale(), "invoice")}
                          </option>
                        </select>
                        <input
                          ref={syncControlValue(() => att.originalName)}
                          type="text"
                          required
                          onInput={e =>
                            setAttUpdates(idx(), "originalName", e.currentTarget.value)
                          }
                          class="flex-1 min-w-[160px] rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2 py-1 text-xs"
                        />
                        <label class="inline-flex items-center gap-1.5 text-rose-700 dark:text-rose-400 font-semibold cursor-pointer">
                          <input
                            type="checkbox"
                            checked={removeAttIds().includes(att.id)}
                            onChange={e => {
                              const checked = e.currentTarget.checked;
                              setRemoveAttIds(prev =>
                                checked ? [...prev, att.id] : prev.filter(id => id !== att.id)
                              );
                            }}
                          />
                          {t().common.remove}
                        </label>
                      </div>
                    )}
                  </For>
                </div>
              </Show>

              <div class="grid sm:grid-cols-2 gap-2 text-xs">
                <label class="block rounded-lg border border-dashed border-slate-300 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-300 dark:hover:border-slate-500 p-2.5 cursor-pointer">
                  <span class="font-semibold block mb-1">
                    {t().masterModals.addSupportingDocuments}
                  </span>
                  <input
                    type="file"
                    multiple
                    onChange={e =>
                      setNewSupporting(
                        e.currentTarget.files ? Array.from(e.currentTarget.files) : []
                      )
                    }
                    class="w-full text-[11px] dark:text-slate-400 file:mr-2 file:rounded file:border-0 file:bg-slate-100 dark:file:bg-slate-800 file:px-2 file:py-1 file:text-[11px] file:font-semibold file:text-slate-700 dark:file:text-slate-200"
                  />
                </label>
                <label class="block rounded-lg border border-dashed border-slate-300 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-300 dark:hover:border-slate-500 p-2.5 cursor-pointer">
                  <span class="font-semibold block mb-1">
                    {t().masterModals.addInvoiceBankProof}
                  </span>
                  <input
                    type="file"
                    multiple
                    onChange={e =>
                      setNewInvoices(
                        e.currentTarget.files ? Array.from(e.currentTarget.files) : []
                      )
                    }
                    class="w-full text-[11px] dark:text-slate-400 file:mr-2 file:rounded file:border-0 file:bg-slate-100 dark:file:bg-slate-800 file:px-2 file:py-1 file:text-[11px] file:font-semibold file:text-slate-700 dark:file:text-slate-200"
                  />
                </label>
              </div>
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                {t().masterModals.editReasonLabel}
              </label>
              <input
                type="text"
                value={editReason()}
                onInput={e => setEditReason(e.currentTarget.value)}
                placeholder={t().masterModals.editReasonEntryPlaceholder}
                class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 px-3 py-2 text-sm"
              />
            </div>

            <Show when={err()}>
              <p class="text-xs font-medium text-red-600 dark:text-red-400">{err()}</p>
            </Show>

            <div class="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={props.onClose}
                class="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                {t().common.cancel}
              </button>
              <button
                type="submit"
                disabled={busy()}
                class="rounded-lg bg-red-600 px-5 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer"
              >
                {busy() ? t().masterModals.savingLoggingBtn : t().masterModals.saveMasterChangesBtn}
              </button>
            </div>
          </form>
        </div>
      )}
    </Show>
  );
}

export function EntryItemLogModal(props: {
  entry: { id: string; entryCode: string; title: string } | null;
  onClose: () => void;
}) {
  const { locale, t } = useI18n();
  const logData = createAsync(() =>
    props.entry ? queryEntryItemLog(props.entry.id) : Promise.resolve(null)
  );

  return (
    <Show when={props.entry}>
      {target => (
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 dark:bg-black/80 p-4 overflow-y-auto">
          <div class="w-full max-w-2xl rounded-2xl bg-white dark:bg-slate-900 dark:border dark:border-slate-800 p-6 shadow-2xl space-y-4 my-6 max-h-[85vh] overflow-y-auto">
            <div class="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <div class="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <History class="h-4 w-4" />
                  <span>{t().masterModals.itemLogHeader}</span>
                  <span class="font-mono font-bold text-slate-800 dark:text-slate-200">{target().entryCode}</span>
                  <Show when={logData()?.entry.status}>
                    {st => <EntryStatusBadge status={st()} />}
                  </Show>
                </div>
                <h3 class="text-base font-bold text-slate-900 dark:text-slate-100 mt-1">{target().title}</h3>
              </div>
              <button
                type="button"
                onClick={props.onClose}
                class="text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200 cursor-pointer"
              >
                <X class="h-5 w-5" />
              </button>
            </div>

            <Show
              when={logData()}
              fallback={
                <div class="py-8 text-center text-sm text-slate-400 dark:text-slate-500">
                  {t().masterModals.loadingItemLog}
                </div>
              }
            >
              {data => (
                <Show
                  when={data().events.length > 0}
                  fallback={
                    <div class="py-8 text-center text-sm text-slate-400 dark:text-slate-500">
                      {t().masterModals.noItemLogEvents}
                    </div>
                  }
                >
                  <div class="space-y-4">
                    <For each={data().events}>
                      {ev => (
                        <div class="flex gap-3 border-l-2 border-slate-200 dark:border-slate-700 pl-4 py-1">
                          <UserAvatar
                            name={ev.actorName}
                            avatarId={ev.actorAvatarId}
                            size="sm"
                          />
                          <div class="flex-1 min-w-0 space-y-1">
                            <div class="flex flex-wrap items-center gap-2 text-xs">
                              <span class="font-bold text-slate-900 dark:text-slate-100">{ev.actorName}</span>
                              <span class="text-slate-400 dark:text-slate-500">{ev.actorTitle}</span>
                              <RoleBadge
                                role={
                                  (["master", "approver", "requestor", "viewer"].includes(
                                    ev.actorRole
                                  )
                                    ? ev.actorRole
                                    : "approver") as UserRole
                                }
                              />
                              <span
                                title={ev.eventType}
                                class={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                                  ev.eventType === "master_edited"
                                    ? "bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900/60"
                                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                                }`}
                              >
                                {getTimelineEventLabel(locale(), ev.eventType)}
                              </span>
                              <span class="text-slate-400 dark:text-slate-500 ml-auto">
                                {formatDateTime(ev.createdAt, locale())}
                              </span>
                            </div>
                            <p class="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{ev.comment}</p>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              )}
            </Show>
          </div>
        </div>
      )}
    </Show>
  );
}

export function MasterDeleteConfirmModal(props: {
  target: MasterDeleteTarget | null;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [reason, setReason] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal("");

  createEffect(() => {
    if (props.target) {
      setReason("");
      setErr("");
    }
  });

  async function confirmDelete(e: SubmitEvent) {
    e.preventDefault();
    const target = props.target;
    if (!target) return;
    setBusy(true);
    setErr("");
    try {
      const url = target.kind === "request" ? `/api/requests/${target.id}` : `/api/entries/${target.id}`;
      const res = await fetch(url, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason() })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || t().masterModals.failedDeleteErr);

      props.onClose();
      await props.onDeleted();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : t().masterModals.failedDeleteErr);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Show when={props.target}>
      {target => (
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 dark:bg-black/80 p-4">
          <form
            onSubmit={confirmDelete}
            class="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 dark:border dark:border-slate-800 p-6 shadow-2xl space-y-4"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="flex items-center gap-2 text-rose-700 dark:text-rose-400">
                <AlertTriangle class="h-5 w-5 shrink-0" />
                <h3 class="text-base font-extrabold">
                  {target().kind === "request"
                    ? t().masterModals.deleteRequestTitle
                    : t().masterModals.deleteEntryTitle}
                </h3>
              </div>
              <button
                type="button"
                onClick={props.onClose}
                class="text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200 cursor-pointer"
              >
                <X class="h-5 w-5" />
              </button>
            </div>

            <div class="rounded-xl border border-rose-200 dark:border-rose-900/70 bg-rose-50 dark:bg-rose-950/50 p-3.5 text-xs text-rose-900 dark:text-rose-200 space-y-1">
              <div class="font-mono font-bold">{target().code}</div>
              <div class="font-semibold text-sm">{target().title}</div>
              <Show when={target().statusLabel}>
                <div>
                  {t().masterModals.statusPrefix} {target().statusLabel}
                </div>
              </Show>
              <p class="pt-1 text-rose-700 dark:text-rose-300">
                {t().masterModals.deleteWarningPrefix}
                {target().kind === "request"
                  ? t().masterModals.deleteWarningRequestMid
                  : t().masterModals.deleteWarningEntryMid}
                {t().masterModals.deleteWarningSuffix(target().attachmentCount ?? 0)}
              </p>
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                {t().masterModals.deletionReasonLabel}
              </label>
              <input
                type="text"
                value={reason()}
                onInput={e => setReason(e.currentTarget.value)}
                placeholder={t().masterModals.deletionReasonPlaceholder}
                class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 px-3 py-2 text-sm"
              />
            </div>

            <Show when={err()}>
              <p class="text-xs font-medium text-red-600 dark:text-red-400">{err()}</p>
            </Show>

            <div class="flex justify-end gap-2">
              <button
                type="button"
                onClick={props.onClose}
                class="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                {t().common.cancel}
              </button>
              <button
                type="submit"
                disabled={busy()}
                class="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
              >
                <Trash2 class="h-3.5 w-3.5" />
                {busy() ? t().masterModals.deletingBtn : t().masterModals.permanentlyDeleteBtn}
              </button>
            </div>
          </form>
        </div>
      )}
    </Show>
  );
}
