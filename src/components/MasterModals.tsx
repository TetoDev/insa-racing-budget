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
import {
  CAR_SYSTEM_SUGGESTIONS,
  DEPARTMENTS,
  ENTRY_CATEGORIES,
  ENTRY_STATUSES,
  ENTRY_STATUS_LABELS,
  REQUEST_STATUSES,
  REQUEST_STATUS_LABELS,
  type DepartmentId,
  type EntryCategory,
  type EntryStatus,
  type RequestStatus,
  type UserRole
} from "~/lib/constants";
import {
  formatCentsPlain,
  formatDateTime,
  fromDateTimeLocalInput,
  toDateTimeLocalInput,
  toIsoDateInput
} from "~/lib/format";
import { queryEntryItemLog } from "~/server/rpc";
import { EntryStatusBadge, RoleBadge, UserAvatar } from "./Badges";

export interface MasterOptionItem {
  id: string;
  label: string;
  productUrl: string | null;
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
  const [requestCode, setRequestCode] = createSignal("");
  const [seasonId, setSeasonId] = createSignal("");
  const [department, setDepartment] = createSignal<DepartmentId>("powertrain");
  const [carSystem, setCarSystem] = createSignal("");
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

  const [options, setOptions] = createSignal<
    Array<{
      id: string | null;
      clientKey: string;
      label: string;
      productUrl: string;
      priceEur: string;
      drawbacks: string;
      notes: string;
    }>
  >([]);
  const [attUpdates, setAttUpdates] = createSignal<
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

  createEffect(() => {
    const r = props.open ? props.request : null;
    if (!r) return;
    setRequestCode(r.requestCode);
    setSeasonId(r.seasonId);
    setDepartment(r.department);
    setCarSystem(r.carSystem);
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
      r.options.map(o => ({
        id: o.id,
        clientKey: o.id,
        label: o.label,
        productUrl: o.productUrl ?? "",
        priceEur: formatCentsPlain(o.priceCents),
        drawbacks: o.drawbacks,
        notes: o.notes ?? ""
      }))
    );
    setAttUpdates(
      r.attachments.map(a => ({
        id: a.id,
        originalName: a.originalName,
        kind: (["photo", "document", "invoice", "fee_proof"].includes(a.kind)
          ? a.kind
          : "document") as RequestAttKind
      }))
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
    setOptions(prev => {
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(index, 1);
      copy.splice(target, 0, item);
      return copy;
    });
  }

  function removeOption(clientKey: string) {
    setOptions(prev => prev.filter(o => o.clientKey !== clientKey));
    if (selectedOptionClientKey() === clientKey) {
      setSelectedOptionClientKey("");
    }
  }

  function syncPriceFromSelectedOption() {
    const chosen = options().find(o => o.clientKey === selectedOptionClientKey());
    if (chosen) {
      setSelectedOptionPriceEur(chosen.priceEur);
    }
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const req = props.request;
    if (!req) return;
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
          options: options().map(o => ({
            id: o.id,
            clientKey: o.clientKey,
            label: o.label,
            productUrl: o.productUrl.trim() || null,
            priceEur: o.priceEur,
            drawbacks: o.drawbacks,
            notes: o.notes.trim() || null
          })),
          attachmentUpdates: attUpdates(),
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
      if (!res.ok) throw new Error(json.error || "Failed to save Master edits.");
      const nextCode = typeof json.requestCode === "string" ? json.requestCode : requestCode();
      props.onClose();
      await props.onSuccess(nextCode);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed to apply Master edits.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Show when={props.open && props.request}>
      {req => (
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 overflow-y-auto">
          <form
            onSubmit={submit}
            class="w-full max-w-4xl rounded-2xl bg-white p-6 shadow-2xl space-y-5 my-6 max-h-[92vh] overflow-y-auto"
          >
            <div class="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <div class="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-red-700 mb-1">
                  <ShieldAlert class="h-3.5 w-3.5" />
                  Master Unrestricted Edit
                </div>
                <h3 class="text-lg font-extrabold text-slate-900">
                  Edit All Fields — {req().requestCode}
                </h3>
                <p class="text-xs text-slate-500">
                  Every modified field, option, or attachment will be recorded in the item timeline and audit log.
                </p>
              </div>
              <button
                type="button"
                onClick={props.onClose}
                class="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X class="h-5 w-5" />
              </button>
            </div>

            {/* A. Identity, Season, Department, Status */}
            <div class="grid sm:grid-cols-3 gap-3">
              <div>
                <label class="block text-xs font-semibold text-slate-600 mb-1">Request ID / Code</label>
                <input
                  type="text"
                  required
                  value={requestCode()}
                  onInput={e => setRequestCode(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono uppercase"
                />
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 mb-1">Season</label>
                <select
                  value={seasonId()}
                  onChange={e => setSeasonId(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <For each={props.seasons}>
                    {s => (
                      <option value={s.id}>
                        {s.name} ({s.yearCode}){s.status === "archived" ? " [Archived]" : ""}
                      </option>
                    )}
                  </For>
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 mb-1">Department</label>
                <select
                  value={department()}
                  onChange={e => setDepartment(e.currentTarget.value as DepartmentId)}
                  class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <For each={DEPARTMENTS}>
                    {d => (
                      <option value={d.id}>
                        {d.label} ({d.code})
                      </option>
                    )}
                  </For>
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 mb-1">Status</label>
                <select
                  value={status()}
                  onChange={e => setStatus(e.currentTarget.value as RequestStatus)}
                  class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <For each={REQUEST_STATUSES}>
                    {st => <option value={st}>{REQUEST_STATUS_LABELS[st]}</option>}
                  </For>
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 mb-1">Car System / Part</label>
                <input
                  type="text"
                  maxLength={120}
                  list="master-car-system-list"
                  value={carSystem()}
                  onInput={e => setCarSystem(e.currentTarget.value)}
                  placeholder="Optional or pick a system..."
                  class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
                <datalist id="master-car-system-list">
                  <For each={CAR_SYSTEM_SUGGESTIONS}>
                    {item => <option value={item} />}
                  </For>
                </datalist>
              </div>
              <div class="flex items-end pb-2">
                <label class="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasApproverResponse()}
                    onChange={e => setHasApproverResponse(e.currentTarget.checked)}
                    class="h-4 w-4 accent-red-600"
                  />
                  <span>Has Approver Response</span>
                </label>
              </div>
            </div>

            {/* B. Title & Explanation */}
            <div class="space-y-3">
              <div>
                <label class="block text-xs font-semibold text-slate-600 mb-1">Title</label>
                <input
                  type="text"
                  required
                  value={title()}
                  onInput={e => setTitle(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 mb-1">Explanation</label>
                <textarea
                  rows={3}
                  value={explanation()}
                  onInput={e => setExplanation(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            </div>

            {/* C. Ownership & Lifecycle Timestamps */}
            <div class="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
              <h4 class="text-xs font-bold uppercase tracking-wider text-slate-500">
                Ownership &amp; Lifecycle Timestamps
              </h4>
              <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label class="block text-xs font-semibold text-slate-600 mb-1">Creator</label>
                  <select
                    value={creatorId()}
                    onChange={e => setCreatorId(e.currentTarget.value)}
                    class="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs"
                  >
                    <For each={props.users}>
                      {u => (
                        <option value={u.id}>
                          {u.fullName} ({u.role})
                        </option>
                      )}
                    </For>
                  </select>
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-600 mb-1">Created At</label>
                  <input
                    type="datetime-local"
                    required
                    value={createdAt()}
                    onInput={e => setCreatedAt(e.currentTarget.value)}
                    class="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-600 mb-1">Ordered By</label>
                  <select
                    value={orderedById()}
                    onChange={e => setOrderedById(e.currentTarget.value)}
                    class="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs"
                  >
                    <option value="">(None)</option>
                    <For each={props.users}>
                      {u => <option value={u.id}>{u.fullName}</option>}
                    </For>
                  </select>
                </div>
                <div>
                  <div class="flex items-center justify-between mb-1">
                    <label class="text-xs font-semibold text-slate-600">Ordered At</label>
                    <Show when={orderedAt()}>
                      <button
                        type="button"
                        onClick={() => setOrderedAt("")}
                        class="text-[11px] text-rose-600 hover:underline cursor-pointer"
                      >
                        Clear
                      </button>
                    </Show>
                  </div>
                  <input
                    type="datetime-local"
                    value={orderedAt()}
                    onInput={e => setOrderedAt(e.currentTarget.value)}
                    class="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-600 mb-1">Invoiced By</label>
                  <select
                    value={invoicedById()}
                    onChange={e => setInvoicedById(e.currentTarget.value)}
                    class="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs"
                  >
                    <option value="">(None)</option>
                    <For each={props.users}>
                      {u => <option value={u.id}>{u.fullName}</option>}
                    </For>
                  </select>
                </div>
                <div>
                  <div class="flex items-center justify-between mb-1">
                    <label class="text-xs font-semibold text-slate-600">Invoiced At</label>
                    <Show when={invoicedAt()}>
                      <button
                        type="button"
                        onClick={() => setInvoicedAt("")}
                        class="text-[11px] text-rose-600 hover:underline cursor-pointer"
                      >
                        Clear
                      </button>
                    </Show>
                  </div>
                  <input
                    type="datetime-local"
                    value={invoicedAt()}
                    onInput={e => setInvoicedAt(e.currentTarget.value)}
                    class="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <div class="flex items-center justify-between mb-1">
                    <label class="text-xs font-semibold text-slate-600">Archived At</label>
                    <Show when={archivedAt()}>
                      <button
                        type="button"
                        onClick={() => setArchivedAt("")}
                        class="text-[11px] text-rose-600 hover:underline cursor-pointer"
                      >
                        Clear
                      </button>
                    </Show>
                  </div>
                  <input
                    type="datetime-local"
                    value={archivedAt()}
                    onInput={e => setArchivedAt(e.currentTarget.value)}
                    class="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                  />
                </div>
              </div>
            </div>

            {/* D. Amounts & Selected Option */}
            <div class="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
              <h4 class="text-xs font-bold uppercase tracking-wider text-slate-500">
                Selected Option &amp; Financials (EUR)
              </h4>
              <div class="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <div class="lg:col-span-2">
                  <label class="block text-xs font-semibold text-slate-600 mb-1">
                    Selected Buying Option
                  </label>
                  <select
                    value={selectedOptionClientKey()}
                    onChange={e => setSelectedOptionClientKey(e.currentTarget.value)}
                    class="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs"
                  >
                    <option value="">(None selected)</option>
                    <For each={options()}>
                      {(opt, idx) => (
                        <option value={opt.clientKey}>
                          Option #{idx() + 1}: {opt.label || "Untitled"} ({opt.priceEur || "0"} €)
                        </option>
                      )}
                    </For>
                  </select>
                </div>
                <div>
                  <div class="flex items-center justify-between mb-1">
                    <label class="text-xs font-semibold text-slate-600">Base Price Override</label>
                    <Show when={selectedOptionClientKey()}>
                      <button
                        type="button"
                        onClick={syncPriceFromSelectedOption}
                        class="text-[10px] font-semibold text-red-600 hover:underline cursor-pointer"
                      >
                        Sync
                      </button>
                    </Show>
                  </div>
                  <input
                    type="text"
                    value={selectedOptionPriceEur()}
                    onInput={e => setSelectedOptionPriceEur(e.currentTarget.value)}
                    placeholder="Blank = None"
                    class="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-600 mb-1">Shipping (EUR)</label>
                  <input
                    type="text"
                    required
                    value={shippingEur()}
                    onInput={e => setShippingEur(e.currentTarget.value)}
                    class="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-600 mb-1">Import Fee (EUR)</label>
                  <input
                    type="text"
                    required
                    value={importFeeEur()}
                    onInput={e => setImportFeeEur(e.currentTarget.value)}
                    class="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm tabular-nums"
                  />
                </div>
              </div>
              <div class="max-w-xs">
                <label class="block text-xs font-semibold text-slate-600 mb-1">
                  Final Invoiced Amount (EUR, blank = None)
                </label>
                <input
                  type="text"
                  value={finalAmountEur()}
                  onInput={e => setFinalAmountEur(e.currentTarget.value)}
                  placeholder="Blank = None"
                  class="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm tabular-nums font-semibold"
                />
              </div>
            </div>

            {/* E. Buying Options */}
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <h4 class="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Buying Options ({options().length})
                </h4>
                <button
                  type="button"
                  onClick={() => {
                    newOptCounter += 1;
                    setOptions(prev => [
                      ...prev,
                      {
                        id: null,
                        clientKey: `new-${Date.now()}-${newOptCounter}`,
                        label: "",
                        productUrl: "",
                        priceEur: "0.00",
                        drawbacks: "",
                        notes: ""
                      }
                    ]);
                  }}
                  class="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
                >
                  <Plus class="h-3.5 w-3.5" />
                  Add Option
                </button>
              </div>
              <div class="space-y-2">
                <For each={options()}>
                  {(opt, i) => (
                    <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                      <div class="flex items-center justify-between text-xs">
                        <span class="font-bold text-slate-700">
                          Option #{i() + 1}
                          <Show when={selectedOptionClientKey() === opt.clientKey}>
                            <span class="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                              Selected
                            </span>
                          </Show>
                        </span>
                        <div class="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={i() === 0}
                            onClick={() => moveOption(i(), -1)}
                            class="rounded border border-slate-200 bg-white p-1 text-slate-500 hover:text-slate-800 disabled:opacity-30 cursor-pointer"
                            title="Move Up"
                          >
                            <ArrowUp class="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            disabled={i() === options().length - 1}
                            onClick={() => moveOption(i(), 1)}
                            class="rounded border border-slate-200 bg-white p-1 text-slate-500 hover:text-slate-800 disabled:opacity-30 cursor-pointer"
                            title="Move Down"
                          >
                            <ArrowDown class="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeOption(opt.clientKey)}
                            class="inline-flex items-center gap-1 text-rose-600 font-semibold cursor-pointer"
                          >
                            <Trash2 class="h-3 w-3" />
                            Remove
                          </button>
                        </div>
                      </div>
                      <div class="grid sm:grid-cols-3 gap-2">
                        <input
                          type="text"
                          required
                          value={opt.label}
                          placeholder="Supplier / Label"
                          onInput={e =>
                            setOptions(prev =>
                              prev.map((x, idx) =>
                                idx === i() ? { ...x, label: e.currentTarget.value } : x
                              )
                            )
                          }
                          class="sm:col-span-2 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                        />
                        <input
                          type="text"
                          required
                          value={opt.priceEur}
                          placeholder="Price EUR"
                          onInput={e =>
                            setOptions(prev =>
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
                        value={opt.drawbacks}
                        placeholder="Drawbacks (optional)"
                        onInput={e =>
                          setOptions(prev =>
                            prev.map((x, idx) =>
                              idx === i() ? { ...x, drawbacks: e.currentTarget.value } : x
                            )
                          )
                        }
                        class="w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                      />
                      <div class="grid sm:grid-cols-2 gap-2">
                        <input
                          type="url"
                          value={opt.productUrl}
                          placeholder="https://... (optional)"
                          onInput={e =>
                            setOptions(prev =>
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
                            setOptions(prev =>
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
            </div>

            {/* F. Attachments */}
            <div class="rounded-xl border border-slate-200 p-4 space-y-3">
              <h4 class="text-xs font-bold uppercase tracking-wider text-slate-500">
                Attachments ({attUpdates().length} existing)
              </h4>
              <Show when={attUpdates().length > 0}>
                <div class="space-y-2">
                  <For each={attUpdates()}>
                    {(att, idx) => (
                      <div class="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 border border-slate-200 p-2 text-xs">
                        <select
                          value={att.kind}
                          onChange={e =>
                            setAttUpdates(prev =>
                              prev.map((x, i2) =>
                                i2 === idx()
                                  ? { ...x, kind: e.currentTarget.value as RequestAttKind }
                                  : x
                              )
                            )
                          }
                          class="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                        >
                          <option value="photo">Photo</option>
                          <option value="document">Document</option>
                          <option value="fee_proof">Fee Proof</option>
                          <option value="invoice">Invoice</option>
                        </select>
                        <input
                          type="text"
                          required
                          value={att.originalName}
                          onInput={e =>
                            setAttUpdates(prev =>
                              prev.map((x, i2) =>
                                i2 === idx() ? { ...x, originalName: e.currentTarget.value } : x
                              )
                            )
                          }
                          class="flex-1 min-w-[160px] rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                        />
                        <label class="inline-flex items-center gap-1.5 text-rose-700 font-semibold cursor-pointer">
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
                          Remove
                        </label>
                      </div>
                    )}
                  </For>
                </div>
              </Show>

              <div class="grid sm:grid-cols-4 gap-2 text-xs">
                <label class="block rounded-lg border border-dashed border-slate-300 p-2.5 cursor-pointer">
                  <span class="font-semibold block mb-1">Add Photos</span>
                  <input
                    type="file"
                    multiple
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={e =>
                      setNewPhotos(e.currentTarget.files ? Array.from(e.currentTarget.files) : [])
                    }
                    class="w-full text-[11px]"
                  />
                </label>
                <label class="block rounded-lg border border-dashed border-slate-300 p-2.5 cursor-pointer">
                  <span class="font-semibold block mb-1">Add Documents</span>
                  <input
                    type="file"
                    multiple
                    onChange={e =>
                      setNewDocs(e.currentTarget.files ? Array.from(e.currentTarget.files) : [])
                    }
                    class="w-full text-[11px]"
                  />
                </label>
                <label class="block rounded-lg border border-dashed border-slate-300 p-2.5 cursor-pointer">
                  <span class="font-semibold block mb-1">Add Fee Proofs</span>
                  <input
                    type="file"
                    multiple
                    onChange={e =>
                      setNewFeeProofs(
                        e.currentTarget.files ? Array.from(e.currentTarget.files) : []
                      )
                    }
                    class="w-full text-[11px]"
                  />
                </label>
                <label class="block rounded-lg border border-dashed border-slate-300 p-2.5 cursor-pointer">
                  <span class="font-semibold block mb-1">Add Invoices</span>
                  <input
                    type="file"
                    multiple
                    onChange={e =>
                      setNewInvoices(
                        e.currentTarget.files ? Array.from(e.currentTarget.files) : []
                      )
                    }
                    class="w-full text-[11px]"
                  />
                </label>
              </div>
            </div>

            {/* G. Edit Reason */}
            <div>
              <label class="block text-xs font-semibold text-slate-600 mb-1">
                Item Log Note / Reason for Edit (optional)
              </label>
              <input
                type="text"
                value={editReason()}
                onInput={e => setEditReason(e.currentTarget.value)}
                placeholder="e.g. Corrected supplier invoice amount and date..."
                class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>

            <Show when={err()}>
              <p class="text-xs font-medium text-red-600">{err()}</p>
            </Show>

            <div class="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={props.onClose}
                class="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy()}
                class="rounded-lg bg-red-600 px-5 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer"
              >
                {busy() ? "Saving & Logging..." : "Save Master Changes"}
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

  const [attUpdates, setAttUpdates] = createSignal<
    Array<{ id: string; originalName: string; kind: EntryAttKind }>
  >([]);
  const [removeAttIds, setRemoveAttIds] = createSignal<string[]>([]);
  const [newSupporting, setNewSupporting] = createSignal<File[]>([]);
  const [newInvoices, setNewInvoices] = createSignal<File[]>([]);
  const [editReason, setEditReason] = createSignal("");

  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal("");

  createEffect(() => {
    const t = props.target;
    if (!t) return;
    setEntryCode(t.entryCode);
    setSeasonId(t.seasonId);
    setTitle(t.title);
    setCategory(t.category);
    setStatus(t.status);
    setInitialAmountEur(formatCentsPlain(t.initialAmountCents));
    setConfirmedAmountEur(
      t.confirmedAmountCents !== null ? formatCentsPlain(t.confirmedAmountCents) : ""
    );
    setEntryDate(toIsoDateInput(t.entryDate));
    setComment(t.comment);
    setCreatedById(t.createdById);
    setConfirmedById(t.confirmedById ?? "");
    setConfirmedAt(toDateTimeLocalInput(t.confirmedAt));
    setCreatedAt(toDateTimeLocalInput(t.createdAt));

    setAttUpdates(
      t.attachments.map(a => ({
        id: a.id,
        originalName: a.originalName,
        kind: (a.kind === "invoice" ? "invoice" : "supporting_doc") as EntryAttKind
      }))
    );
    setRemoveAttIds([]);
    setNewSupporting([]);
    setNewInvoices([]);
    setEditReason("");
    setErr("");
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const t = props.target;
    if (!t) return;
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
          createdAt: fromDateTimeLocalInput(createdAt()) ?? t.createdAt,
          attachmentUpdates: attUpdates(),
          removeAttachmentIds: removeAttIds(),
          editReason: editReason()
        })
      );
      for (const f of newSupporting()) fd.append("supportingFiles", f);
      for (const f of newInvoices()) fd.append("invoiceFiles", f);

      const res = await fetch(`/api/entries/${t.id}/master-edit`, {
        method: "POST",
        body: fd
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update money entry.");

      props.onClose();
      await props.onSuccess();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed to save Master changes.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Show when={props.target}>
      {target => (
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 overflow-y-auto">
          <form
            onSubmit={submit}
            class="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-2xl space-y-5 my-6 max-h-[92vh] overflow-y-auto"
          >
            <div class="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <div class="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-red-700 mb-1">
                  <ShieldAlert class="h-3.5 w-3.5" />
                  Master Unrestricted Edit
                </div>
                <h3 class="text-lg font-extrabold text-slate-900">
                  Edit Money Entry — {target().entryCode}
                </h3>
                <p class="text-xs text-slate-500">
                  All changes will be logged in the entry item log and global audit log.
                </p>
              </div>
              <button
                type="button"
                onClick={props.onClose}
                class="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X class="h-5 w-5" />
              </button>
            </div>

            <div class="grid sm:grid-cols-3 gap-3">
              <div>
                <label class="block text-xs font-semibold text-slate-600 mb-1">Entry ID / Code</label>
                <input
                  type="text"
                  required
                  value={entryCode()}
                  onInput={e => setEntryCode(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono uppercase"
                />
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 mb-1">Season</label>
                <select
                  value={seasonId()}
                  onChange={e => setSeasonId(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <For each={props.seasons}>
                    {s => (
                      <option value={s.id}>
                        {s.name} ({s.yearCode}){s.status === "archived" ? " [Archived]" : ""}
                      </option>
                    )}
                  </For>
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 mb-1">Entry Date</label>
                <input
                  type="date"
                  required
                  value={entryDate()}
                  onInput={e => setEntryDate(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 mb-1">Category</label>
                <select
                  value={category()}
                  onChange={e => setCategory(e.currentTarget.value as EntryCategory)}
                  class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <For each={ENTRY_CATEGORIES}>
                    {c => <option value={c.id}>{c.label}</option>}
                  </For>
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 mb-1">Status</label>
                <select
                  value={status()}
                  onChange={e => setStatus(e.currentTarget.value as EntryStatus)}
                  class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <For each={ENTRY_STATUSES}>
                    {st => <option value={st}>{ENTRY_STATUS_LABELS[st]}</option>}
                  </For>
                </select>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="block text-xs font-semibold text-slate-600 mb-1">Initial EUR</label>
                  <input
                    type="text"
                    required
                    value={initialAmountEur()}
                    onInput={e => setInitialAmountEur(e.currentTarget.value)}
                    class="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-600 mb-1">Confirmed EUR</label>
                  <input
                    type="text"
                    value={confirmedAmountEur()}
                    onInput={e => setConfirmedAmountEur(e.currentTarget.value)}
                    placeholder="Blank = None"
                    class="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm tabular-nums"
                  />
                </div>
              </div>
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-600 mb-1">Title / Entity</label>
              <input
                type="text"
                required
                value={title()}
                onInput={e => setTitle(e.currentTarget.value)}
                class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-600 mb-1">Comment / Notes</label>
              <textarea
                rows={3}
                value={comment()}
                onInput={e => setComment(e.currentTarget.value)}
                class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>

            <div class="rounded-xl border border-slate-200 bg-slate-50/70 p-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label class="block text-xs font-semibold text-slate-600 mb-1">Creator</label>
                <select
                  value={createdById()}
                  onChange={e => setCreatedById(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs"
                >
                  <For each={props.users}>
                    {u => <option value={u.id}>{u.fullName}</option>}
                  </For>
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 mb-1">Created At</label>
                <input
                  type="datetime-local"
                  required
                  value={createdAt()}
                  onInput={e => setCreatedAt(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                />
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 mb-1">Confirmed By</label>
                <select
                  value={confirmedById()}
                  onChange={e => setConfirmedById(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs"
                >
                  <option value="">(None)</option>
                  <For each={props.users}>
                    {u => <option value={u.id}>{u.fullName}</option>}
                  </For>
                </select>
              </div>
              <div>
                <div class="flex items-center justify-between mb-1">
                  <label class="text-xs font-semibold text-slate-600">Confirmed At</label>
                  <Show when={confirmedAt()}>
                    <button
                      type="button"
                      onClick={() => setConfirmedAt("")}
                      class="text-[11px] text-rose-600 hover:underline cursor-pointer"
                    >
                      Clear
                    </button>
                  </Show>
                </div>
                <input
                  type="datetime-local"
                  value={confirmedAt()}
                  onInput={e => setConfirmedAt(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                />
              </div>
            </div>

            <div class="rounded-xl border border-slate-200 p-4 space-y-3">
              <h4 class="text-xs font-bold uppercase tracking-wider text-slate-500">
                Attachments ({attUpdates().length} existing)
              </h4>
              <Show when={attUpdates().length > 0}>
                <div class="space-y-2">
                  <For each={attUpdates()}>
                    {(att, idx) => (
                      <div class="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 border border-slate-200 p-2 text-xs">
                        <select
                          value={att.kind}
                          onChange={e =>
                            setAttUpdates(prev =>
                              prev.map((x, i2) =>
                                i2 === idx()
                                  ? { ...x, kind: e.currentTarget.value as EntryAttKind }
                                  : x
                              )
                            )
                          }
                          class="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                        >
                          <option value="supporting_doc">Supporting Doc</option>
                          <option value="invoice">Invoice / Proof</option>
                        </select>
                        <input
                          type="text"
                          required
                          value={att.originalName}
                          onInput={e =>
                            setAttUpdates(prev =>
                              prev.map((x, i2) =>
                                i2 === idx() ? { ...x, originalName: e.currentTarget.value } : x
                              )
                            )
                          }
                          class="flex-1 min-w-[160px] rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                        />
                        <label class="inline-flex items-center gap-1.5 text-rose-700 font-semibold cursor-pointer">
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
                          Remove
                        </label>
                      </div>
                    )}
                  </For>
                </div>
              </Show>

              <div class="grid sm:grid-cols-2 gap-2 text-xs">
                <label class="block rounded-lg border border-dashed border-slate-300 p-2.5 cursor-pointer">
                  <span class="font-semibold block mb-1">Add Supporting Documents</span>
                  <input
                    type="file"
                    multiple
                    onChange={e =>
                      setNewSupporting(
                        e.currentTarget.files ? Array.from(e.currentTarget.files) : []
                      )
                    }
                    class="w-full text-[11px]"
                  />
                </label>
                <label class="block rounded-lg border border-dashed border-slate-300 p-2.5 cursor-pointer">
                  <span class="font-semibold block mb-1">Add Invoice / Bank Proof</span>
                  <input
                    type="file"
                    multiple
                    onChange={e =>
                      setNewInvoices(
                        e.currentTarget.files ? Array.from(e.currentTarget.files) : []
                      )
                    }
                    class="w-full text-[11px]"
                  />
                </label>
              </div>
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-600 mb-1">
                Item Log Note / Reason for Edit (optional)
              </label>
              <input
                type="text"
                value={editReason()}
                onInput={e => setEditReason(e.currentTarget.value)}
                placeholder="e.g. Corrected bank confirmation amount and date..."
                class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>

            <Show when={err()}>
              <p class="text-xs font-medium text-red-600">{err()}</p>
            </Show>

            <div class="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={props.onClose}
                class="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy()}
                class="rounded-lg bg-red-600 px-5 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer"
              >
                {busy() ? "Saving & Logging..." : "Save Master Changes"}
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
  const logData = createAsync(() =>
    props.entry ? queryEntryItemLog(props.entry.id) : Promise.resolve(null)
  );

  return (
    <Show when={props.entry}>
      {target => (
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 overflow-y-auto">
          <div class="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl space-y-4 my-6 max-h-[85vh] overflow-y-auto">
            <div class="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <div class="flex items-center gap-2 text-xs text-slate-500">
                  <History class="h-4 w-4" />
                  <span>Money Entry Item Log</span>
                  <span class="font-mono font-bold text-slate-800">{target().entryCode}</span>
                  <Show when={logData()?.entry.status}>
                    {st => <EntryStatusBadge status={st()} />}
                  </Show>
                </div>
                <h3 class="text-base font-bold text-slate-900 mt-1">{target().title}</h3>
              </div>
              <button
                type="button"
                onClick={props.onClose}
                class="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X class="h-5 w-5" />
              </button>
            </div>

            <Show
              when={logData()}
              fallback={
                <div class="py-8 text-center text-sm text-slate-400">Loading item log...</div>
              }
            >
              {data => (
                <Show
                  when={data().events.length > 0}
                  fallback={
                    <div class="py-8 text-center text-sm text-slate-400">
                      No item log events recorded yet.
                    </div>
                  }
                >
                  <div class="space-y-4">
                    <For each={data().events}>
                      {ev => (
                        <div class="flex gap-3 border-l-2 border-slate-200 pl-4 py-1">
                          <UserAvatar
                            name={ev.actorName}
                            avatarId={ev.actorAvatarId}
                            size="sm"
                          />
                          <div class="flex-1 min-w-0 space-y-1">
                            <div class="flex flex-wrap items-center gap-2 text-xs">
                              <span class="font-bold text-slate-900">{ev.actorName}</span>
                              <span class="text-slate-400">{ev.actorTitle}</span>
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
                                class={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                                  ev.eventType === "master_edited"
                                    ? "bg-red-50 text-red-700 border border-red-200"
                                    : "bg-slate-100 text-slate-600"
                                }`}
                              >
                                {ev.eventType}
                              </span>
                              <span class="text-slate-400 ml-auto">
                                {formatDateTime(ev.createdAt)}
                              </span>
                            </div>
                            <p class="text-sm text-slate-800 whitespace-pre-wrap">{ev.comment}</p>
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
    const t = props.target;
    if (!t) return;
    setBusy(true);
    setErr("");
    try {
      const url = t.kind === "request" ? `/api/requests/${t.id}` : `/api/entries/${t.id}`;
      const res = await fetch(url, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason() })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to delete record.");

      props.onClose();
      await props.onDeleted();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed to delete record.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Show when={props.target}>
      {target => (
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4">
          <form
            onSubmit={confirmDelete}
            class="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="flex items-center gap-2 text-rose-700">
                <AlertTriangle class="h-5 w-5 shrink-0" />
                <h3 class="text-base font-extrabold">
                  Delete {target().kind === "request" ? "Purchase Request" : "Money Entry"}?
                </h3>
              </div>
              <button
                type="button"
                onClick={props.onClose}
                class="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X class="h-5 w-5" />
              </button>
            </div>

            <div class="rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-900 space-y-1">
              <div class="font-mono font-bold">{target().code}</div>
              <div class="font-semibold text-sm">{target().title}</div>
              <Show when={target().statusLabel}>
                <div>Status: {target().statusLabel}</div>
              </Show>
              <p class="pt-1 text-rose-700">
                This permanently removes the record
                {target().kind === "request" ? ", its buying options, item timeline," : ", its item log,"}
                {" "}and {target().attachmentCount ?? 0} uploaded attachment file(s) from the server. A deletion snapshot stays in the global audit log.
              </p>
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-600 mb-1">
                Deletion Reason (optional, saved to Global Audit Log)
              </label>
              <input
                type="text"
                value={reason()}
                onInput={e => setReason(e.currentTarget.value)}
                placeholder="e.g. Duplicate import entry or test item..."
                class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>

            <Show when={err()}>
              <p class="text-xs font-medium text-red-600">{err()}</p>
            </Show>

            <div class="flex justify-end gap-2">
              <button
                type="button"
                onClick={props.onClose}
                class="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy()}
                class="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
              >
                <Trash2 class="h-3.5 w-3.5" />
                {busy() ? "Deleting..." : "Permanently Delete"}
              </button>
            </div>
          </form>
        </div>
      )}
    </Show>
  );
}
