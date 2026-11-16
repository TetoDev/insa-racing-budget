import { Title } from "@solidjs/meta";
import { useSearchParams } from "@solidjs/router";
import { Archive, Download, FileSpreadsheet, FolderArchive } from "lucide-solid";
import { For, Show, createSignal } from "solid-js";
import { useApp, useI18n } from "~/components/AppContext";
import {
  BUDGET_SECTIONS,
  RATE_PERIODS,
  type BudgetSectionId,
  type RatePeriod
} from "~/lib/constants";
import { getBudgetSectionLabel, getRatePeriodLabel, getSeasonStatusLabel } from "~/lib/i18n";
import { canExportBudget } from "~/lib/permissions";

export default function ExportsPage() {
  const app = useApp();
  const { locale, t } = useI18n();
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
      setError(t().exports.selectOneError);
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
          ratePeriod: ratePeriod(),
          locale: locale()
        })
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || t().exports.failedError);
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
      setExportedMessage(t().exports.downloadedMsg(filename));
    } catch (err) {
      setError(err instanceof Error ? err.message : t().exports.failedError);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div class="max-w-4xl space-y-6">
      <Title>{t().exports.pageTitle} — {t().appName}</Title>

      <div>
        <h1 class="text-2xl font-bold text-slate-900 dark:text-slate-100">{t().exports.heading}</h1>
        <p class="text-sm text-slate-500 dark:text-slate-400">
          {t().exports.subtitlePre} <strong>.xlsx</strong>, <strong>.csv</strong>, / <strong>.pdf</strong>{" "}
          {t().exports.subtitleMid} <strong>.zip</strong> {t().exports.subtitlePost}
        </p>
      </div>

      <Show
        when={canExportBudget(app.user()?.role)}
        fallback={
          <div class="rounded-2xl border border-rose-200 dark:border-rose-900/70 bg-rose-50 dark:bg-rose-950/60 p-6 text-sm text-rose-800 dark:text-rose-200">
            {t().exports.restrictedMsg}
          </div>
        }
      >
        <form onSubmit={handleExport} class="space-y-6">
          {/* Season & Format */}
          <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs space-y-4">
            <h2 class="text-base font-bold text-slate-900 dark:text-slate-100">{t().exports.step1Heading}</h2>

            <div class="grid sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5">
                  {t().exports.seasonBudgetLabel}
                </label>
                <select
                  value={effectiveSeasonId()}
                  onChange={e => setSeasonId(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-red-500 focus:outline-none"
                >
                  <For each={app.seasons()}>
                    {s => (
                      <option value={s.id}>
                        {s.name} ({getSeasonStatusLabel(locale(), s.status)})
                      </option>
                    )}
                  </For>
                </select>
              </div>

              <div>
                <label class="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5">
                  {t().exports.granularityLabel}
                </label>
                <select
                  value={ratePeriod()}
                  onChange={e => setRatePeriod(e.currentTarget.value as RatePeriod)}
                  class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-red-500 focus:outline-none"
                >
                  <For each={RATE_PERIODS}>
                    {p => <option value={p}>{getRatePeriodLabel(locale(), p, "adj")}</option>}
                  </For>
                </select>
              </div>

              <div>
                <label class="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5">
                  {t().exports.fromDateOpt}
                </label>
                <input
                  type="date"
                  value={fromDate()}
                  onInput={e => setFromDate(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-red-500 focus:outline-none"
                />
              </div>

              <div>
                <label class="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5">
                  {t().exports.toDateOpt}
                </label>
                <input
                  type="date"
                  value={toDate()}
                  onInput={e => setToDate(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-red-500 focus:outline-none"
                />
              </div>
            </div>

            <div class="grid sm:grid-cols-3 gap-3 pt-2">
              <button
                type="button"
                onClick={() => setFormat("xlsx")}
                class={`rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
                  format() === "xlsx"
                    ? "border-slate-900 bg-slate-900 text-white dark:border-red-500 dark:bg-red-950/50 dark:text-white"
                    : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                <div class="flex items-center gap-2 font-bold text-sm">
                  <FileSpreadsheet class="h-4 w-4" />
                  {t().exports.xlsxTitle}
                </div>
                <div class="text-[11px] opacity-80 mt-1">
                  {t().exports.xlsxDesc}
                </div>
              </button>

              <button
                type="button"
                onClick={() => setFormat("pdf")}
                class={`rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
                  format() === "pdf"
                    ? "border-slate-900 bg-slate-900 text-white dark:border-red-500 dark:bg-red-950/50 dark:text-white"
                    : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                <div class="flex items-center gap-2 font-bold text-sm">
                  <Download class="h-4 w-4" />
                  {t().exports.pdfTitle}
                </div>
                <div class="text-[11px] opacity-80 mt-1">
                  {t().exports.pdfDesc}
                </div>
              </button>

              <button
                type="button"
                onClick={() => setFormat("csv")}
                class={`rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
                  format() === "csv"
                    ? "border-slate-900 bg-slate-900 text-white dark:border-red-500 dark:bg-red-950/50 dark:text-white"
                    : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                <div class="flex items-center gap-2 font-bold text-sm">
                  <Archive class="h-4 w-4" />
                  {t().exports.csvTitle}
                </div>
                <div class="text-[11px] opacity-80 mt-1">
                  {t().exports.csvDesc}
                </div>
              </button>
            </div>

            <Show when={format() === "csv"}>
              <div class="flex items-center gap-4 text-xs text-slate-700 dark:text-slate-300 pt-1">
                <span class="font-semibold">{t().exports.csvDelimiterLabel}</span>
                <label class="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    checked={csvDelimiter() === ";"}
                    onChange={() => setCsvDelimiter(";")}
                  />
                  {t().exports.csvSemicolonName} (<code>;</code> {t().exports.csvSemicolonLabel})
                </label>
                <label class="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    checked={csvDelimiter() === ","}
                    onChange={() => setCsvDelimiter(",")}
                  />
                  {t().exports.csvCommaName} (<code>,</code> {t().exports.csvCommaLabel})
                </label>
              </div>
            </Show>
          </div>

          {/* Section Checkboxes */}
          <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs space-y-4">
            <div class="flex items-center justify-between">
              <h2 class="text-base font-bold text-slate-900 dark:text-slate-100">{t().exports.step2Heading}</h2>
              <div class="flex gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setSelectedSections(BUDGET_SECTIONS.map(s => s.id))}
                  class="font-semibold text-red-600 dark:text-red-400 hover:underline cursor-pointer"
                >
                  {t().common.selectAll}
                </button>
                <span class="text-slate-300 dark:text-slate-600">|</span>
                <button
                  type="button"
                  onClick={() => setSelectedSections([])}
                  class="font-semibold text-slate-500 dark:text-slate-400 hover:underline cursor-pointer"
                >
                  {t().common.clear}
                </button>
              </div>
            </div>

            <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              <For each={BUDGET_SECTIONS}>
                {sec => (
                  <label
                    class={`flex items-center gap-2.5 rounded-xl border p-3 text-xs font-medium cursor-pointer transition-colors ${
                      selectedSections().includes(sec.id)
                        ? "border-red-500 bg-red-50/50 dark:bg-red-950/40 text-slate-900 dark:text-slate-100"
                        : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSections().includes(sec.id)}
                      onChange={() => toggleSection(sec.id)}
                      class="h-4 w-4 accent-red-600"
                    />
                    <span>{getBudgetSectionLabel(locale(), sec.id)}</span>
                  </label>
                )}
              </For>
            </div>
          </div>

          {/* Structured ZIP Bundle Option */}
          <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs">
            <label class="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={includeZip()}
                onChange={e => setIncludeZip(e.currentTarget.checked)}
                class="mt-1 h-4 w-4 accent-red-600"
              />
              <div>
                <div class="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-slate-100">
                  <FolderArchive class="h-4 w-4 text-red-600 dark:text-red-400" />
                  {t().exports.zipTitle}
                </div>
                <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {t().exports.zipDescPrefix}
                  <code>documents/spendings/&lt;DEPT&gt;/&lt;ID&gt;/</code>,{" "}
                  <code>documents/provisional_spendings/...</code>,{" "}
                  <code>documents/entries/&lt;CATEGORY&gt;/&lt;ID&gt;/</code>
                  {t().exports.zipDescSuffix}
                </p>
              </div>
            </label>
          </div>

          <Show when={error()}>
            <div class="rounded-xl border border-red-200 dark:border-red-900/70 bg-red-50 dark:bg-red-950/60 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {error()}
            </div>
          </Show>

          <Show when={exportedMessage()}>
            <div class="rounded-xl border border-emerald-200 dark:border-emerald-900/70 bg-emerald-50 dark:bg-emerald-950/60 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300">
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
                ? t().exports.generatingBtn
                : t().exports.downloadBtn(
                    includeZip() ? t().exports.downloadZipLabel : format().toUpperCase()
                  )}
            </button>
          </div>
        </form>
      </Show>
    </div>
  );
}
