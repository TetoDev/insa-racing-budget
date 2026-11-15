import { FileText, Upload, X } from "lucide-solid";
import { For, Show, createEffect, createSignal } from "solid-js";
import { DEPARTMENTS, ENTRY_CATEGORIES, type DepartmentId, type EntryCategory } from "~/lib/constants";
import { formatCentsPlain, formatEur, toIsoDateInput } from "~/lib/format";

export function LogMoneyEntryModal(props: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
  const [title, setTitle] = createSignal("");
  const [category, setCategory] = createSignal<EntryCategory>("sponsorship");
  const [amountEur, setAmountEur] = createSignal("");
  const [entryDate, setEntryDate] = createSignal(toIsoDateInput(new Date()));
  const [comment, setComment] = createSignal("");
  const [docs, setDocs] = createSignal<File[]>([]);
  const [invoice, setInvoice] = createSignal<File | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal("");

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const fd = new FormData();
      fd.set("title", title());
      fd.set("category", category());
      fd.set("amountEur", amountEur());
      fd.set("entryDate", entryDate());
      fd.set("comment", comment());
      for (const f of docs()) fd.append("supportingFiles", f);
      if (invoice()) fd.set("invoiceFile", invoice()!);

      const res = await fetch("/api/entries", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to log money entry.");

      setTitle("");
      setAmountEur("");
      setComment("");
      setDocs([]);
      setInvoice(null);
      props.onClose();
      await props.onSuccess();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed to save money entry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 overflow-y-auto">
        <form onSubmit={submit} class="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-bold text-slate-900">Log Money Entry (EUR)</h3>
            <button
              type="button"
              onClick={props.onClose}
              class="text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              <X class="h-5 w-5" />
            </button>
          </div>

          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Entry Title / Entity</label>
            <input
              type="text"
              required
              value={title()}
              onInput={e => setTitle(e.currentTarget.value)}
              placeholder="e.g. FSDIE Grant Allocation 2026"
              class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>

          <div class="grid grid-cols-3 gap-3">
            <div>
              <label class="block text-xs font-semibold text-slate-600 mb-1">Category</label>
              <select
                value={category()}
                onChange={e => setCategory(e.currentTarget.value as EntryCategory)}
                class="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm"
              >
                <For each={ENTRY_CATEGORIES}>
                  {c => <option value={c.id}>{c.label}</option>}
                </For>
              </select>
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-600 mb-1">Amount (EUR)</label>
              <input
                type="text"
                required
                value={amountEur()}
                onInput={e => setAmountEur(e.currentTarget.value)}
                placeholder="2500.00"
                class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
              />
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-600 mb-1">Entry Date</label>
              <input
                type="date"
                required
                value={entryDate()}
                onInput={e => setEntryDate(e.currentTarget.value)}
                class="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Comment</label>
            <textarea
              required
              rows={2}
              value={comment()}
              onInput={e => setComment(e.currentTarget.value)}
              placeholder="Agreement reference, expected payment terms, or sponsor contact..."
              class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>

          <label class="block rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-xs cursor-pointer">
            <span class="font-semibold block mb-1">
              Supporting Documents (Optional — contracts, award letters)
            </span>
            <input
              type="file"
              multiple
              onChange={e => setDocs(e.currentTarget.files ? Array.from(e.currentTarget.files) : [])}
            />
          </label>

          <label class="block rounded-lg border border-dashed border-emerald-300 bg-emerald-50/50 p-3 text-xs cursor-pointer">
            <span class="font-semibold text-emerald-900 block mb-1">
              Invoice / Payment Proof (Leave empty for Provisional; attach to mark Confirmed immediately)
            </span>
            <input
              type="file"
              onChange={e => setInvoice(e.currentTarget.files?.[0] ?? null)}
            />
          </label>

          <Show when={err()}>
            <p class="text-xs text-red-600">{err()}</p>
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
              class="rounded-lg bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
            >
              {busy() ? "Saving..." : "Save Money Entry"}
            </button>
          </div>
        </form>
      </div>
    </Show>
  );
}

export interface ConfirmEntryTarget {
  id: string;
  entryCode: string;
  title: string;
  initialAmountCents: number;
}

export function ConfirmProvisionalEntryModal(props: {
  target: ConfirmEntryTarget | null;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
  const [invoiceFile, setInvoiceFile] = createSignal<File | null>(null);
  const [amountEur, setAmountEur] = createSignal("");
  const [comment, setComment] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal("");

  createEffect(() => {
    const t = props.target;
    if (t) {
      setAmountEur(formatCentsPlain(t.initialAmountCents));
      setComment("");
      setInvoiceFile(null);
      setErr("");
    }
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const t = props.target;
    const inv = invoiceFile();
    if (!t || !inv) {
      setErr("Invoice file is required to confirm a provisional entry.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const fd = new FormData();
      fd.set("invoiceFile", inv);
      fd.set("confirmedAmountEur", amountEur());
      fd.set("comment", comment());

      const res = await fetch(`/api/entries/${t.id}/confirm`, { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to confirm entry.");

      props.onClose();
      await props.onSuccess();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed to confirm entry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Show when={props.target}>
      {target => (
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
          <form onSubmit={submit} class="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div class="flex items-center justify-between">
              <h3 class="text-base font-bold text-slate-900">Confirm Entry {target().entryCode}</h3>
              <button
                type="button"
                onClick={props.onClose}
                class="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X class="h-5 w-5" />
              </button>
            </div>
            <p class="text-xs text-slate-500">{target().title}</p>

            <label class="flex items-center gap-2 rounded-lg border border-dashed border-emerald-400 bg-emerald-50 p-3 text-xs font-medium text-emerald-900 cursor-pointer">
              <Upload class="h-4 w-4 text-emerald-600" />
              <span class="truncate">
                {invoiceFile() ? invoiceFile()!.name : "Select invoice / proof file..."}
              </span>
              <input
                type="file"
                required
                class="hidden"
                onChange={e => setInvoiceFile(e.currentTarget.files?.[0] ?? null)}
              />
            </label>

            <div>
              <label class="block text-xs font-semibold text-slate-600 mb-1">Confirmed Amount (EUR)</label>
              <input
                type="text"
                required
                value={amountEur()}
                onInput={e => setAmountEur(e.currentTarget.value)}
                class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
              />
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-600 mb-1">Confirmation Note (optional)</label>
              <input
                type="text"
                value={comment()}
                onInput={e => setComment(e.currentTarget.value)}
                placeholder="Received via bank transfer..."
                class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>

            <Show when={err()}>
              <p class="text-xs text-red-600">{err()}</p>
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
                class="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
              >
                {busy() ? "Confirming..." : "Confirm Entry"}
              </button>
            </div>
          </form>
        </div>
      )}
    </Show>
  );
}

export interface EditEntryTarget {
  id: string;
  entryCode: string;
  title: string;
  category: EntryCategory;
  initialAmountCents: number;
  entryDate: string;
  comment: string;
  attachments: Array<{ id: string; kind: string; originalName: string }>;
}

export function EditProvisionalEntryModal(props: {
  target: EditEntryTarget | null;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
  const [title, setTitle] = createSignal("");
  const [category, setCategory] = createSignal<EntryCategory>("sponsorship");
  const [amountEur, setAmountEur] = createSignal("");
  const [entryDate, setEntryDate] = createSignal("");
  const [comment, setComment] = createSignal("");
  const [removeIds, setRemoveIds] = createSignal<string[]>([]);
  const [newDocs, setNewDocs] = createSignal<File[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal("");

  createEffect(() => {
    const t = props.target;
    if (t) {
      setTitle(t.title);
      setCategory(t.category);
      setAmountEur(formatCentsPlain(t.initialAmountCents));
      setEntryDate(toIsoDateInput(t.entryDate));
      setComment(t.comment);
      setRemoveIds([]);
      setNewDocs([]);
      setErr("");
    }
  });

  const toggleRemove = (id: string) => {
    setRemoveIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

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
          title: title(),
          category: category(),
          amountEur: amountEur(),
          entryDate: entryDate(),
          comment: comment(),
          removeAttachmentIds: removeIds()
        })
      );
      for (const f of newDocs()) fd.append("supportingFiles", f);

      const res = await fetch(`/api/entries/${t.id}/edit`, { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update provisional entry.");

      props.onClose();
      await props.onSuccess();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed to save changes.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Show when={props.target}>
      {target => (
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 overflow-y-auto">
          <form onSubmit={submit} class="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div class="flex items-center justify-between">
              <h3 class="text-base font-bold text-slate-900">
                Edit Provisional Entry {target().entryCode}
              </h3>
              <button
                type="button"
                onClick={props.onClose}
                class="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X class="h-5 w-5" />
              </button>
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-600 mb-1">Title / Entity</label>
              <input
                type="text"
                required
                minLength={2}
                value={title()}
                onInput={e => setTitle(e.currentTarget.value)}
                class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>

            <div class="grid grid-cols-3 gap-3">
              <div>
                <label class="block text-xs font-semibold text-slate-600 mb-1">Category</label>
                <select
                  value={category()}
                  onChange={e => setCategory(e.currentTarget.value as EntryCategory)}
                  class="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm"
                >
                  <For each={ENTRY_CATEGORIES}>
                    {c => <option value={c.id}>{c.label}</option>}
                  </For>
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 mb-1">Expected EUR</label>
                <input
                  type="text"
                  required
                  value={amountEur()}
                  onInput={e => setAmountEur(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
                />
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 mb-1">Expected Date</label>
                <input
                  type="date"
                  required
                  value={entryDate()}
                  onInput={e => setEntryDate(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm"
                />
              </div>
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-600 mb-1">Comment</label>
              <textarea
                required
                rows={2}
                value={comment()}
                onInput={e => setComment(e.currentTarget.value)}
                class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>

            <Show when={target().attachments.length > 0}>
              <div class="space-y-1.5">
                <div class="text-xs font-semibold text-slate-600">
                  Existing Documents (check to remove)
                </div>
                <For each={target().attachments}>
                  {att => (
                    <label class="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={removeIds().includes(att.id)}
                        onChange={() => toggleRemove(att.id)}
                      />
                      <FileText class="h-3.5 w-3.5 text-slate-400" />
                      <span>{att.originalName}</span>
                    </label>
                  )}
                </For>
              </div>
            </Show>

            <label class="block rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-xs cursor-pointer">
              <span class="font-semibold block mb-1">Add Supporting Documents (Optional)</span>
              <input
                type="file"
                multiple
                onChange={e =>
                  setNewDocs(e.currentTarget.files ? Array.from(e.currentTarget.files) : [])
                }
              />
            </label>

            <Show when={err()}>
              <p class="text-xs text-red-600">{err()}</p>
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
                class="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                {busy() ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      )}
    </Show>
  );
}

export function DepartmentBudgetsModal(props: {
  open: boolean;
  seasonId: string;
  seasonName: string;
  currentAllocations: Partial<Record<DepartmentId, number>>;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
  const [values, setValues] = createSignal<Record<DepartmentId, string>>({
    powertrain: "0",
    chassis: "0",
    aero: "0",
    suspension: "0",
    electronics: "0",
    ergonomics: "0",
    team_logistics: "0"
  });
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal("");

  createEffect(() => {
    if (props.open) {
      const next = {} as Record<DepartmentId, string>;
      for (const d of DEPARTMENTS) {
        const cents = props.currentAllocations[d.id] ?? 0;
        next[d.id] = cents > 0 ? formatCentsPlain(cents) : "0";
      }
      setValues(next);
      setErr("");
    }
  });

  const totalEnteredEur = () => {
    let total = 0;
    for (const d of DEPARTMENTS) {
      const parsed = Number((values()[d.id] ?? "0").replace(",", ".").replace(/\s/g, ""));
      if (Number.isFinite(parsed) && parsed > 0) total += Math.round(parsed * 100);
    }
    return total;
  };

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const allocations = DEPARTMENTS.map(d => ({
        department: d.id,
        allocatedEur: values()[d.id] || "0"
      }));
      const res = await fetch("/api/budget/allocations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seasonId: props.seasonId, allocations })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update department budgets.");

      props.onClose();
      await props.onSuccess();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed to save allocations.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 overflow-y-auto">
        <form onSubmit={submit} class="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-base font-bold text-slate-900">Department Budget Envelopes</h3>
              <p class="text-xs text-slate-500">
                Set advisory target caps (EUR TTC) for {props.seasonName}. Use 0 for no cap.
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

          <div class="space-y-2.5">
            <For each={DEPARTMENTS}>
              {dept => (
                <div class="grid grid-cols-3 items-center gap-3">
                  <div class="col-span-2 flex items-center gap-2 text-sm font-medium text-slate-800">
                    <span
                      class="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ "background-color": dept.color }}
                    />
                    <span>{dept.label}</span>
                    <span class="text-xs font-mono text-slate-400">({dept.code})</span>
                  </div>
                  <input
                    type="text"
                    value={values()[dept.id]}
                    onInput={e =>
                      setValues(prev => ({ ...prev, [dept.id]: e.currentTarget.value }))
                    }
                    placeholder="0.00"
                    class="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-right tabular-nums focus:border-red-500 focus:outline-none"
                  />
                </div>
              )}
            </For>
          </div>

          <div class="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 flex items-center justify-between text-xs">
            <span class="font-semibold text-slate-600">Total Allocated Envelopes</span>
            <span class="font-extrabold tabular-nums text-slate-900">
              {formatEur(totalEnteredEur())}
            </span>
          </div>

          <Show when={err()}>
            <p class="text-xs text-red-600">{err()}</p>
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
              class="rounded-lg bg-slate-900 px-5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
            >
              {busy() ? "Saving..." : "Save Envelopes"}
            </button>
          </div>
        </form>
      </div>
    </Show>
  );
}
