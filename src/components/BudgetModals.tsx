import { FileText, Upload, X } from "lucide-solid";
import { For, Show, createEffect, createSignal } from "solid-js";
import { DEPARTMENTS, ENTRY_CATEGORIES, type DepartmentId, type EntryCategory } from "~/lib/constants";
import { formatCentsPlain, formatEur, toIsoDateInput } from "~/lib/format";
import { getDepartmentLabel, getEntryCategoryLabel } from "~/lib/i18n";
import { useI18n } from "./AppContext";

export function LogMoneyEntryModal(props: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
  const { locale, t } = useI18n();
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
      if (!res.ok) throw new Error(json.error || t().budgetModals.failedLogErr);

      setTitle("");
      setAmountEur("");
      setComment("");
      setDocs([]);
      setInvoice(null);
      props.onClose();
      await props.onSuccess();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : t().budgetModals.failedSaveEntryErr);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 dark:bg-black/75 p-4 overflow-y-auto">
        <form onSubmit={submit} class="w-full max-w-lg rounded-2xl border border-transparent dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-bold text-slate-900 dark:text-slate-100">{t().budgetModals.logTitle}</h3>
            <button
              type="button"
              onClick={props.onClose}
              class="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
            >
              <X class="h-5 w-5" />
            </button>
          </div>

          <div>
            <label class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
              {t().budgetModals.entryTitleEntity}
            </label>
            <input
              type="text"
              required
              value={title()}
              onInput={e => setTitle(e.currentTarget.value)}
              placeholder={t().budgetModals.entryTitlePlaceholder}
              class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-red-500 focus:outline-none"
            />
          </div>

          <div class="grid grid-cols-3 gap-3">
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                {t().common.category}
              </label>
              <select
                value={category()}
                onChange={e => setCategory(e.currentTarget.value as EntryCategory)}
                class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-red-500 focus:outline-none"
              >
                <For each={ENTRY_CATEGORIES}>
                  {c => <option value={c.id}>{getEntryCategoryLabel(locale(), c.id)}</option>}
                </For>
              </select>
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                {t().budgetModals.amountEur}
              </label>
              <input
                type="text"
                required
                value={amountEur()}
                onInput={e => setAmountEur(e.currentTarget.value)}
                placeholder="2500.00"
                class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 tabular-nums placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-red-500 focus:outline-none"
              />
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                {t().budgetModals.entryDate}
              </label>
              <input
                type="date"
                required
                value={entryDate()}
                onInput={e => setEntryDate(e.currentTarget.value)}
                class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-red-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
              {t().common.comment}
            </label>
            <textarea
              required
              rows={2}
              value={comment()}
              onInput={e => setComment(e.currentTarget.value)}
              placeholder={t().budgetModals.commentPlaceholder}
              class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-red-500 focus:outline-none"
            />
          </div>

          <label class="block rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-3 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
            <span class="font-semibold block mb-1">
              {t().budgetModals.supportingDocsOpt}
            </span>
            <input
              type="file"
              multiple
              onChange={e => setDocs(e.currentTarget.files ? Array.from(e.currentTarget.files) : [])}
            />
          </label>

          <label class="block rounded-lg border border-dashed border-emerald-300 dark:border-emerald-800/80 bg-emerald-50/50 dark:bg-emerald-950/40 p-3 text-xs text-emerald-900 dark:text-emerald-200 cursor-pointer">
            <span class="font-semibold text-emerald-900 dark:text-emerald-200 block mb-1">
              {t().budgetModals.invoiceProofDesc}
            </span>
            <input
              type="file"
              onChange={e => setInvoice(e.currentTarget.files?.[0] ?? null)}
            />
          </label>

          <Show when={err()}>
            <p class="text-xs text-red-600 dark:text-red-400">{err()}</p>
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
              class="rounded-lg bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
            >
              {busy() ? t().common.saving : t().budgetModals.saveEntryBtn}
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
  const { t } = useI18n();
  const [invoiceFile, setInvoiceFile] = createSignal<File | null>(null);
  const [amountEur, setAmountEur] = createSignal("");
  const [comment, setComment] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal("");

  createEffect(() => {
    const t2 = props.target;
    if (t2) {
      setAmountEur(formatCentsPlain(t2.initialAmountCents));
      setComment("");
      setInvoiceFile(null);
      setErr("");
    }
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const target = props.target;
    const inv = invoiceFile();
    if (!target || !inv) {
      setErr(t().budgetModals.invoiceRequiredConfirmErr);
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const fd = new FormData();
      fd.set("invoiceFile", inv);
      fd.set("confirmedAmountEur", amountEur());
      fd.set("comment", comment());

      const res = await fetch(`/api/entries/${target.id}/confirm`, { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || t().budgetModals.failedConfirmErr);

      props.onClose();
      await props.onSuccess();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : t().budgetModals.failedConfirmErr);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Show when={props.target}>
      {target => (
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 dark:bg-black/75 p-4">
          <form onSubmit={submit} class="w-full max-w-md rounded-2xl border border-transparent dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4">
            <div class="flex items-center justify-between">
              <h3 class="text-base font-bold text-slate-900 dark:text-slate-100">
                {t().budgetModals.confirmTitle(target().entryCode)}
              </h3>
              <button
                type="button"
                onClick={props.onClose}
                class="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X class="h-5 w-5" />
              </button>
            </div>
            <p class="text-xs text-slate-500 dark:text-slate-400">{target().title}</p>

            <label class="flex items-center gap-2 rounded-lg border border-dashed border-emerald-400 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 p-3 text-xs font-medium text-emerald-900 dark:text-emerald-200 cursor-pointer">
              <Upload class="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span class="truncate">
                {invoiceFile() ? invoiceFile()!.name : t().budgetModals.selectInvoiceFilePrompt}
              </span>
              <input
                type="file"
                required
                class="hidden"
                onChange={e => setInvoiceFile(e.currentTarget.files?.[0] ?? null)}
              />
            </label>

            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                {t().budgetModals.confirmedAmountLabel}
              </label>
              <input
                type="text"
                required
                value={amountEur()}
                onInput={e => setAmountEur(e.currentTarget.value)}
                class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 tabular-nums focus:border-red-500 focus:outline-none"
              />
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                {t().budgetModals.confirmNoteOpt}
              </label>
              <input
                type="text"
                value={comment()}
                onInput={e => setComment(e.currentTarget.value)}
                placeholder={t().budgetModals.confirmNotePlaceholder}
                class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-red-500 focus:outline-none"
              />
            </div>

            <Show when={err()}>
              <p class="text-xs text-red-600 dark:text-red-400">{err()}</p>
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
                class="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
              >
                {busy() ? t().budgetModals.confirmingBtn : t().budgetModals.confirmBtn}
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
  const { locale, t } = useI18n();
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
    const t2 = props.target;
    if (t2) {
      setTitle(t2.title);
      setCategory(t2.category);
      setAmountEur(formatCentsPlain(t2.initialAmountCents));
      setEntryDate(toIsoDateInput(t2.entryDate));
      setComment(t2.comment);
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
    const target = props.target;
    if (!target) return;
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

      const res = await fetch(`/api/entries/${target.id}/edit`, { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || t().budgetModals.failedUpdateProvErr);

      props.onClose();
      await props.onSuccess();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : t().budgetModals.failedUpdateProvErr);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Show when={props.target}>
      {target => (
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 dark:bg-black/75 p-4 overflow-y-auto">
          <form onSubmit={submit} class="w-full max-w-lg rounded-2xl border border-transparent dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4">
            <div class="flex items-center justify-between">
              <h3 class="text-base font-bold text-slate-900 dark:text-slate-100">
                {t().budgetModals.editProvTitle(target().entryCode)}
              </h3>
              <button
                type="button"
                onClick={props.onClose}
                class="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X class="h-5 w-5" />
              </button>
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                {t().budgetModals.titleEntityLabel}
              </label>
              <input
                type="text"
                required
                minLength={2}
                value={title()}
                onInput={e => setTitle(e.currentTarget.value)}
                class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-red-500 focus:outline-none"
              />
            </div>

            <div class="grid grid-cols-3 gap-3">
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  {t().common.category}
                </label>
                <select
                  value={category()}
                  onChange={e => setCategory(e.currentTarget.value as EntryCategory)}
                  class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-red-500 focus:outline-none"
                >
                  <For each={ENTRY_CATEGORIES}>
                    {c => <option value={c.id}>{getEntryCategoryLabel(locale(), c.id)}</option>}
                  </For>
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  {t().budgetModals.expectedEurLabel}
                </label>
                <input
                  type="text"
                  required
                  value={amountEur()}
                  onInput={e => setAmountEur(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 tabular-nums focus:border-red-500 focus:outline-none"
                />
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  {t().budgetModals.expectedDateLabel}
                </label>
                <input
                  type="date"
                  required
                  value={entryDate()}
                  onInput={e => setEntryDate(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-red-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                {t().common.comment}
              </label>
              <textarea
                required
                rows={2}
                value={comment()}
                onInput={e => setComment(e.currentTarget.value)}
                class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-red-500 focus:outline-none"
              />
            </div>

            <Show when={target().attachments.length > 0}>
              <div class="space-y-1.5">
                <div class="text-xs font-semibold text-slate-600 dark:text-slate-400">
                  {t().budgetModals.existingDocsRemove}
                </div>
                <For each={target().attachments}>
                  {att => (
                    <label class="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
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

            <label class="block rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-3 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <span class="font-semibold block mb-1">{t().budgetModals.addSupportingDocsOpt}</span>
              <input
                type="file"
                multiple
                onChange={e =>
                  setNewDocs(e.currentTarget.files ? Array.from(e.currentTarget.files) : [])
                }
              />
            </label>

            <Show when={err()}>
              <p class="text-xs text-red-600 dark:text-red-400">{err()}</p>
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
                class="rounded-lg bg-slate-900 dark:bg-slate-100 px-4 py-2 text-xs font-semibold text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-white disabled:opacity-50 cursor-pointer"
              >
                {busy() ? t().common.saving : t().common.saveChanges}
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
  const { locale, t } = useI18n();
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
      if (!res.ok) throw new Error(json.error || t().budgetModals.failedEnvelopesErr);

      props.onClose();
      await props.onSuccess();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : t().budgetModals.failedEnvelopesErr);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 dark:bg-black/75 p-4 overflow-y-auto">
        <form onSubmit={submit} class="w-full max-w-lg rounded-2xl border border-transparent dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-base font-bold text-slate-900 dark:text-slate-100">
                {t().budgetModals.deptBudgetsTitle}
              </h3>
              <p class="text-xs text-slate-500 dark:text-slate-400">
                {t().budgetModals.deptBudgetsDesc(props.seasonName)}
              </p>
            </div>
            <button
              type="button"
              onClick={props.onClose}
              class="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
            >
              <X class="h-5 w-5" />
            </button>
          </div>

          <div class="space-y-2.5">
            <For each={DEPARTMENTS}>
              {dept => (
                <div class="grid grid-cols-3 items-center gap-3">
                  <div class="col-span-2 flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                    <span
                      class="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ "background-color": dept.color }}
                    />
                    <span>{getDepartmentLabel(locale(), dept.id)}</span>
                    <span class="text-xs font-mono text-slate-400 dark:text-slate-500">({dept.code})</span>
                  </div>
                  <input
                    type="text"
                    value={values()[dept.id]}
                    onInput={e =>
                      setValues(prev => ({ ...prev, [dept.id]: e.currentTarget.value }))
                    }
                    placeholder="0.00"
                    class="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 text-right tabular-nums focus:border-red-500 focus:outline-none"
                  />
                </div>
              )}
            </For>
          </div>

          <div class="rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 px-3 py-2 flex items-center justify-between text-xs">
            <span class="font-semibold text-slate-600 dark:text-slate-300">{t().budgetModals.totalAllocated}</span>
            <span class="font-extrabold tabular-nums text-slate-900 dark:text-slate-100">
              {formatEur(totalEnteredEur(), locale())}
            </span>
          </div>

          <Show when={err()}>
            <p class="text-xs text-red-600 dark:text-red-400">{err()}</p>
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
              class="rounded-lg bg-slate-900 dark:bg-slate-100 px-5 py-2 text-xs font-semibold text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-white disabled:opacity-50 cursor-pointer"
            >
              {busy() ? t().common.saving : t().budgetModals.saveEnvelopesBtn}
            </button>
          </div>
        </form>
      </div>
    </Show>
  );
}
