import { Title } from "@solidjs/meta";
import { useSearchParams } from "@solidjs/router";
import { Archive, Download, FileSpreadsheet, FolderArchive } from "lucide-solid";
import { For, Show, createSignal } from "solid-js";
import { useApp } from "~/components/AppContext";
import {
  BUDGET_SECTIONS,
  RATE_PERIODS,
  type BudgetSectionId,
  type RatePeriod
} from "~/lib/constants";
import { canExportBudget } from "~/lib/permissions";

export default function ExportsPage() {
  const app = useApp();
  const [searchParams] = useSearchParams();

  const initialPeriod = (): RatePeriod => {
    const p = searchParams.period;
    return typeof p === "string" && RATE_PERIODS.includes(p as RatePeriod)
      ? (p as RatePeriod)
      : "month";
  };

  const initialSections = (): BudgetSectionId[] => {
    const s = searchParams.sections;
    if (typeof s === "string" && s.trim()) {
      const requested = s
        .split(",")
        .filter((x): x is BudgetSectionId => BUDGET_SECTIONS.some(b => b.id === x));
      if (requested.length > 0) return requested;
    }
    return BUDGET_SECTIONS.map(sec => sec.id);
  };

  const [seasonId, setSeasonId] = createSignal(
    typeof searchParams.season === "string" ? searchParams.season : ""
  );
  const [format, setFormat] = createSignal<"xlsx" | "csv" | "pdf">("xlsx");
  const [csvDelimiter, setCsvDelimiter] = createSignal<";" | ",">(";");
  const [includeZip, setIncludeZip] = createSignal(true);
  const [ratePeriod, setRatePeriod] = createSignal<RatePeriod>(initialPeriod());
  const [fromDate, setFromDate] = createSignal(
    typeof searchParams.from === "string" ? searchParams.from : ""
  );
  const [toDate, setToDate] = createSignal(
    typeof searchParams.to === "string" ? searchParams.to : ""
  );
  const [selectedSections, setSelectedSections] = createSignal<BudgetSectionId[]>(
    initialSections()
  );
  const [downloading, setDownloading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [exportedMessage, setExportedMessage] = createSignal("");

  const effectiveSeasonId = () => seasonId() || app.selectedSeasonId();

  const toggleSection = (id: BudgetSectionId) => {
    setSelectedSections(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  async function handleExport(e: SubmitEvent) {
    e.preventDefault();
    setError("");
    setExportedMessage("");
    if (selectedSections().length === 0) {
      setError("Select at least one budget section to export.");
      return;
    }
    setDownloading(true);
    try {
      const res = await fetch("/api/exports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seasonId: effectiveSeasonId(),
          format: format(),
          includeZip: includeZip(),
          csvDelimiter: csvDelimiter(),
          sections: selectedSections(),
          fromDate: fromDate() || undefined,
          toDate: toDate() || undefined,
          ratePeriod: ratePeriod()
        })
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to generate export.");
      }

      const disposition = res.headers.get("content-disposition") || "";
      const match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      const filename = match ? decodeURIComponent(match[1]) : `insa_budget_export.${includeZip() ? "zip" : format()}`;

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setExportedMessage(`Downloaded ${filename}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div class="max-w-4xl space-y-6">
      <Title>Export Budget Declarations — INSA Racing Achats</Title>

      <div>
        <h1 class="text-2xl font-bold text-slate-900">Export Budget for Financing Entities</h1>
        <p class="text-sm text-slate-500">
          Generate custom <strong>.xlsx</strong>, <strong>.csv</strong>, or <strong>.pdf</strong> declarations selecting whichever budget sections you need, optionally packaged into a structured <strong>.zip</strong> with all linked invoices and supporting documents.
        </p>
      </div>

      <Show
        when={canExportBudget(app.user()?.role)}
        fallback={
          <div class="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
            Access restricted: only Approvers and the Master account can export budget reports.
          </div>
        }
      >
        <form onSubmit={handleExport} class="space-y-6">
          {/* Season & Format */}
          <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
            <h2 class="text-base font-bold text-slate-900">1. Scope &amp; File Format</h2>

            <div class="grid sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  Season Budget
                </label>
                <select
                  value={effectiveSeasonId()}
                  onChange={e => setSeasonId(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <For each={app.seasons()}>
                    {s => (
                      <option value={s.id}>
                        {s.name} ({s.status})
                      </option>
                    )}
                  </For>
                </select>
              </div>

              <div>
                <label class="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  Timeframe Rate Granularity
                </label>
                <select
                  value={ratePeriod()}
                  onChange={e => setRatePeriod(e.currentTarget.value as RatePeriod)}
                  class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <For each={RATE_PERIODS}>
                    {p => <option value={p}>{p.toUpperCase()}</option>}
                  </For>
                </select>
              </div>

              <div>
                <label class="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  From Date (optional)
                </label>
                <input
                  type="date"
                  value={fromDate()}
                  onInput={e => setFromDate(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label class="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  To Date (optional)
                </label>
                <input
                  type="date"
                  value={toDate()}
                  onInput={e => setToDate(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div class="grid sm:grid-cols-3 gap-3 pt-2">
              <button
                type="button"
                onClick={() => setFormat("xlsx")}
                class={`rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
                  format() === "xlsx"
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100"
                }`}
              >
                <div class="flex items-center gap-2 font-bold text-sm">
                  <FileSpreadsheet class="h-4 w-4" />
                  Excel (.xlsx)
                </div>
                <div class="text-[11px] opacity-80 mt-1">
                  Recommended: multi-sheet workbook with EUR formatting
                </div>
              </button>

              <button
                type="button"
                onClick={() => setFormat("pdf")}
                class={`rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
                  format() === "pdf"
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100"
                }`}
              >
                <div class="flex items-center gap-2 font-bold text-sm">
                  <Download class="h-4 w-4" />
                  PDF Declaration
                </div>
                <div class="text-[11px] opacity-80 mt-1">
                  Print-ready formal financial summary tables
                </div>
              </button>

              <button
                type="button"
                onClick={() => setFormat("csv")}
                class={`rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
                  format() === "csv"
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100"
                }`}
              >
                <div class="flex items-center gap-2 font-bold text-sm">
                  <Archive class="h-4 w-4" />
                  CSV (UTF-8 BOM)
                </div>
                <div class="text-[11px] opacity-80 mt-1">
                  Raw tabular export compatible with French Excel
                </div>
              </button>
            </div>

            <Show when={format() === "csv"}>
              <div class="flex items-center gap-4 text-xs text-slate-700 pt-1">
                <span class="font-semibold">CSV Delimiter:</span>
                <label class="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    checked={csvDelimiter() === ";"}
                    onChange={() => setCsvDelimiter(";")}
                  />
                  Semicolon (<code>;</code> — French Excel)
                </label>
                <label class="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    checked={csvDelimiter() === ","}
                    onChange={() => setCsvDelimiter(",")}
                  />
                  Comma (<code>,</code> — Standard)
                </label>
              </div>
            </Show>
          </div>

          {/* Section Checkboxes */}
          <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
            <div class="flex items-center justify-between">
              <h2 class="text-base font-bold text-slate-900">2. Select Budget Sections to Include</h2>
              <div class="flex gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setSelectedSections(BUDGET_SECTIONS.map(s => s.id))}
                  class="font-semibold text-red-600 hover:underline cursor-pointer"
                >
                  Select All
                </button>
                <span class="text-slate-300">|</span>
                <button
                  type="button"
                  onClick={() => setSelectedSections([])}
                  class="font-semibold text-slate-500 hover:underline cursor-pointer"
                >
                  Clear
                </button>
              </div>
            </div>

            <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              <For each={BUDGET_SECTIONS}>
                {sec => (
                  <label
                    class={`flex items-center gap-2.5 rounded-xl border p-3 text-xs font-medium cursor-pointer transition-colors ${
                      selectedSections().includes(sec.id)
                        ? "border-red-500 bg-red-50/50 text-slate-900"
                        : "border-slate-200 bg-slate-50 text-slate-600"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSections().includes(sec.id)}
                      onChange={() => toggleSection(sec.id)}
                      class="h-4 w-4 accent-red-600"
                    />
                    <span>{sec.label}</span>
                  </label>
                )}
              </For>
            </div>
          </div>

          {/* Structured ZIP Bundle Option */}
          <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
            <label class="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={includeZip()}
                onChange={e => setIncludeZip(e.currentTarget.checked)}
                class="mt-1 h-4 w-4 accent-red-600"
              />
              <div>
                <div class="flex items-center gap-2 font-bold text-sm text-slate-900">
                  <FolderArchive class="h-4 w-4 text-red-600" />
                  Create a Structured .ZIP Bundle with Invoices &amp; Supporting Documents
                </div>
                <p class="text-xs text-slate-500 mt-1">
                  Packages your exported report alongside organized folders (
                  <code>documents/spendings/&lt;DEPT&gt;/&lt;ID&gt;/</code>,{" "}
                  <code>documents/provisional_spendings/...</code>,{" "}
                  <code>documents/entries/&lt;CATEGORY&gt;/&lt;ID&gt;/</code>) containing every linked invoice, fee receipt, and supporting document.
                </p>
              </div>
            </label>
          </div>

          <Show when={error()}>
            <div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error()}
            </div>
          </Show>

          <Show when={exportedMessage()}>
            <div class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {exportedMessage()}
            </div>
          </Show>

          <div class="flex justify-end">
            <button
              type="submit"
              disabled={downloading()}
              class="inline-flex items-center gap-2 rounded-xl bg-red-600 px-6 py-3 text-sm font-bold text-white shadow-sm hover:bg-red-700 disabled:opacity-50 cursor-pointer"
            >
              <Download class="h-4 w-4" />
              {downloading()
                ? "Generating Export..."
                : `Download ${includeZip() ? "Structured ZIP Bundle" : format().toUpperCase()}`}
            </button>
          </div>
        </form>
      </Show>
    </div>
  );
}
