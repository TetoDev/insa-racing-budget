import { For, Show, createMemo, createSignal } from "solid-js";
import {
  getBudgetUtilizationStatus,
  type CategoryEntryRow,
  type DepartmentBudgetRow,
  type TimeBucketRow
} from "~/lib/budget-analytics";
import type { DepartmentId, RatePeriod } from "~/lib/constants";
import { formatEur } from "~/lib/format";
import {
  formatTimeBucketLabel,
  getDepartmentLabel,
  getEntryCategoryLabel
} from "~/lib/i18n";
import { useI18n } from "./AppContext";

function formatAxisEur(cents: number): string {
  const eur = cents / 100;
  if (Math.abs(eur) >= 1000) {
    return `${(eur / 1000).toFixed(Math.abs(eur) % 1000 === 0 ? 0 : 1)}k €`;
  }
  return `${Math.round(eur)} €`;
}

export function DepartmentSpendChart(props: {
  rows: DepartmentBudgetRow[];
  onSelectDepartment?: (dept: DepartmentId) => void;
}) {
  const { locale, t } = useI18n();
  const maxTotal = createMemo(() => {
    const vals = props.rows.flatMap(r => [r.totalProjectedCents, r.allocatedCents ?? 0]);
    const max = Math.max(...vals, 0);
    return max > 0 ? max : 100;
  });

  return (
    <div class="space-y-3">
      <div class="flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
        <span class="inline-flex items-center gap-1.5">
          <span class="h-2.5 w-2.5 rounded-sm bg-slate-900 dark:bg-slate-200" />
          {t().budgetCharts.legendFinalInvoiced}
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="h-2.5 w-2.5 rounded-sm bg-orange-400" />
          {t().budgetCharts.legendProvOrders}
        </span>
        <Show when={props.rows.some(r => r.allocatedCents !== null)}>
          <span class="inline-flex items-center gap-1.5">
            <span class="h-3 w-0.5 bg-sky-600 dark:bg-sky-400 inline-block" />
            {t().budgetCharts.legendAllocatedEnv}
          </span>
        </Show>
      </div>

      <div class="space-y-2.5">
        <For each={props.rows}>
          {row => {
            const finalWidth = () =>
              Math.round((row.finalSpendingsCents / maxTotal()) * 1000) / 10;
            const provWidth = () =>
              Math.round((row.provisionalSpendingsCents / maxTotal()) * 1000) / 10;
            const allocPos = () =>
              row.allocatedCents ? Math.min(100, Math.round((row.allocatedCents / maxTotal()) * 1000) / 10) : null;
            const utilStatus = () => getBudgetUtilizationStatus(row.utilizationProjectedPct);

            return (
              <div
                onClick={() => props.onSelectDepartment?.(row.department)}
                class={`space-y-1 rounded-lg transition-colors ${
                  props.onSelectDepartment ? "hover:bg-slate-50 dark:hover:bg-slate-800/60 p-1.5 -mx-1.5 cursor-pointer" : ""
                }`}
              >
                <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div class="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-200">
                    <span
                      class="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ "background-color": row.color }}
                    />
                    <span>{getDepartmentLabel(locale(), row.department)}</span>
                    <span class="text-[11px] font-mono text-slate-400 dark:text-slate-500">({row.code})</span>
                    <Show when={row.utilizationProjectedPct !== null}>
                      <span
                        class={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                          utilStatus() === "over"
                            ? "bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300"
                            : utilStatus() === "warning"
                              ? "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300"
                              : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                        }`}
                      >
                        {t().budgetCharts.pctOfEnvelope(
                          row.utilizationProjectedPct!,
                          formatEur(row.allocatedCents!, locale())
                        )}
                      </span>
                    </Show>
                  </div>
                  <div class="tabular-nums font-medium text-slate-700 dark:text-slate-300">
                    {formatEur(row.finalSpendingsCents, locale())}
                    <Show when={row.provisionalSpendingsCents > 0}>
                      <span class="text-orange-600 dark:text-orange-400">
                        {" "}+ {formatEur(row.provisionalSpendingsCents, locale())}{" "}
                        {t().budgetCharts.provShort}
                      </span>
                    </Show>
                  </div>
                </div>
                <div class="relative flex h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    class="bg-slate-900 dark:bg-slate-200 transition-all duration-300"
                    style={{ width: `${finalWidth()}%` }}
                    title={t().budgetCharts.tooltipFinal(formatEur(row.finalSpendingsCents, locale()))}
                  />
                  <div
                    class="bg-orange-400 transition-all duration-300"
                    style={{ width: `${provWidth()}%` }}
                    title={t().budgetCharts.tooltipProvisional(formatEur(row.provisionalSpendingsCents, locale()))}
                  />
                  <Show when={allocPos() !== null}>
                    <div
                      class="absolute top-0 bottom-0 w-0.5 bg-sky-600 dark:bg-sky-400 z-10"
                      style={{ left: `${allocPos()}%` }}
                      title={t().budgetCharts.tooltipAllocated(formatEur(row.allocatedCents!, locale()))}
                    />
                  </Show>
                </div>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}

export function CategoryEntryChart(props: { rows: CategoryEntryRow[] }) {
  const { locale, t } = useI18n();
  const maxVal = createMemo(() => {
    const max = Math.max(...props.rows.map(r => r.totalProjectedCents), 0);
    return max > 0 ? max : 100;
  });

  return (
    <div class="space-y-3">
      <div class="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
        <span class="inline-flex items-center gap-1.5">
          <span class="h-2.5 w-2.5 rounded-sm bg-emerald-600" />
          {t().budgetCharts.legendConfirmedEntries}
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="h-2.5 w-2.5 rounded-sm bg-amber-400" />
          {t().budgetCharts.legendProvEntries}
        </span>
      </div>

      <div class="space-y-2.5">
        <For each={props.rows}>
          {row => {
            const confW = () => Math.round((row.confirmedCents / maxVal()) * 1000) / 10;
            const provW = () => Math.round((row.provisionalCents / maxVal()) * 1000) / 10;

            return (
              <div class="space-y-1">
                <div class="flex items-center justify-between text-xs">
                  <div class="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-200">
                    <span
                      class="h-2.5 w-2.5 rounded-full"
                      style={{ "background-color": row.color }}
                    />
                    <span>{getEntryCategoryLabel(locale(), row.category)}</span>
                  </div>
                  <div class="tabular-nums font-medium text-slate-700 dark:text-slate-300">
                    {formatEur(row.confirmedCents, locale())}
                    <Show when={row.provisionalCents > 0}>
                      <span class="text-amber-600 dark:text-amber-400">
                        {" "}+ {formatEur(row.provisionalCents, locale())} {t().budgetCharts.provShort}
                      </span>
                    </Show>
                  </div>
                </div>
                <div class="flex h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    class="bg-emerald-600 transition-all duration-300"
                    style={{ width: `${confW()}%` }}
                  />
                  <div
                    class="bg-amber-400 transition-all duration-300"
                    style={{ width: `${provW()}%` }}
                  />
                </div>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}

export function CashflowBarsChart(props: {
  buckets: TimeBucketRow[];
  mode: "spendings" | "in_out";
  periodUnit?: RatePeriod;
}) {
  const { locale, t } = useI18n();
  const [showAll, setShowAll] = createSignal(false);
  const [hoveredIdx, setHoveredIdx] = createSignal<number | null>(null);
  const period = () => props.periodUnit ?? "month";
  const labelFor = (b: TimeBucketRow) =>
    formatTimeBucketLabel(b.bucketKey, b.label, period(), locale());

  const visible = createMemo(() => (showAll() ? props.buckets : props.buckets.slice(-18)));
  const maxCents = createMemo(() => {
    const vals: number[] = [];
    for (const b of visible()) {
      if (props.mode === "spendings") {
        vals.push(b.finalSpendingsCents + b.provisionalSpendingsCents);
      } else {
        vals.push(
          b.confirmedEntriesCents + b.provisionalEntriesCents,
          b.finalSpendingsCents + b.provisionalSpendingsCents
        );
      }
    }
    return Math.max(...vals, 100);
  });

  const hoveredBucket = () => {
    const i = hoveredIdx();
    return i !== null ? visible()[i] ?? null : null;
  };

  const width = 760;
  const height = 240;
  const padLeft = 56;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 38;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  return (
    <Show
      when={visible().length > 0}
      fallback={
        <div class="flex h-48 items-center justify-center rounded-lg border border-dashed border-slate-200 dark:border-slate-700 text-sm text-slate-400 dark:text-slate-500">
          {t().budgetCharts.emptyTimeframe}
        </div>
      }
    >
      <div class="space-y-2.5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
            <Show
              when={props.mode === "spendings"}
              fallback={
                <>
                  <span class="inline-flex items-center gap-1.5">
                    <span class="h-2.5 w-2.5 rounded-sm bg-emerald-600" />
                    {t().budgetCharts.legendInputCombined}
                  </span>
                  <span class="inline-flex items-center gap-1.5">
                    <span class="h-2.5 w-2.5 rounded-sm bg-red-600" />
                    {t().budgetCharts.legendOutputCombined}
                  </span>
                </>
              }
            >
              <span class="inline-flex items-center gap-1.5">
                <span class="h-2.5 w-2.5 rounded-sm bg-slate-900 dark:bg-slate-200" />
                {t().budgetCharts.legendFinalSpendings}
              </span>
              <span class="inline-flex items-center gap-1.5">
                <span class="h-2.5 w-2.5 rounded-sm bg-orange-400" />
                {t().budgetCharts.legendProvSpendings}
              </span>
            </Show>
          </div>

          <Show when={props.buckets.length > 18}>
            <button
              type="button"
              onClick={() => setShowAll(prev => !prev)}
              class="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
            >
              {showAll()
                ? t().budgetCharts.showLast18
                : t().budgetCharts.showAllPeriods(props.buckets.length)}
            </button>
          </Show>
        </div>

        {/* Interactive tooltip readout bar */}
        <div class="min-h-6 rounded-lg bg-slate-50 dark:bg-slate-800/70 px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 flex flex-wrap items-center justify-between gap-2 border border-slate-100 dark:border-slate-800">
          <Show
            when={hoveredBucket()}
            fallback={<span class="text-slate-400 dark:text-slate-500">{t().budgetCharts.hoverBarHint}</span>}
          >
            {b => (
              <Show
                when={props.mode === "spendings"}
                fallback={
                  <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span class="font-bold text-slate-900 dark:text-slate-100">{labelFor(b())}</span>
                    <span class="text-emerald-700 dark:text-emerald-400 font-semibold tabular-nums">
                      {t().budgetCharts.inputLabel}{" "}
                      +{formatEur(b().confirmedEntriesCents + b().provisionalEntriesCents, locale())}
                    </span>
                    <span class="text-red-600 dark:text-red-400 font-semibold tabular-nums">
                      {t().budgetCharts.outputLabel}{" "}
                      -{formatEur(b().finalSpendingsCents + b().provisionalSpendingsCents, locale())}
                    </span>
                    <span class="font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                      {t().budgetCharts.netActualLabel} {formatEur(b().netActualCents, locale())}
                    </span>
                  </div>
                }
              >
                <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span class="font-bold text-slate-900 dark:text-slate-100">{labelFor(b())}</span>
                  <span class="text-slate-800 dark:text-slate-200 font-semibold tabular-nums">
                    {t().budgetCharts.finalLabel} {formatEur(b().finalSpendingsCents, locale())}
                  </span>
                  <span class="text-orange-600 dark:text-orange-400 font-semibold tabular-nums">
                    {t().budgetCharts.provisionalLabel}{" "}
                    {formatEur(b().provisionalSpendingsCents, locale())}
                  </span>
                  <span class="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                    {t().budgetCharts.combinedLabel}{" "}
                    {formatEur(b().finalSpendingsCents + b().provisionalSpendingsCents, locale())}
                  </span>
                </div>
              </Show>
            )}
          </Show>
        </div>

        <div class="w-full overflow-x-auto">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            onMouseLeave={() => setHoveredIdx(null)}
            class="min-w-[540px] w-full h-58 select-none"
          >
            {/* Horizontal gridlines + Y-axis labels */}
            <For each={[0, 0.5, 1]}>
              {ratio => {
                const y = padTop + plotH * (1 - ratio);
                const val = Math.round(maxCents() * ratio);
                return (
                  <g>
                    <line
                      x1={padLeft}
                      y1={y}
                      x2={width - padRight}
                      y2={y}
                      class={ratio === 0 ? "stroke-slate-300 dark:stroke-slate-700" : "stroke-slate-100 dark:stroke-slate-800"}
                      stroke-dasharray={ratio === 0 ? undefined : "4 4"}
                      stroke-width="1"
                    />
                    <text
                      x={padLeft - 8}
                      y={y + 3}
                      text-anchor="end"
                      class="fill-slate-400 dark:fill-slate-500 text-[10px] tabular-nums"
                    >
                      {formatAxisEur(val)}
                    </text>
                  </g>
                );
              }}
            </For>

            <For each={visible()}>
              {(bucket, idx) => {
                const count = visible().length;
                const slotW = plotW / count;
                const xCenter = padLeft + idx() * slotW + slotW / 2;
                const isHovered = () => hoveredIdx() === idx();

                if (props.mode === "spendings") {
                  const barW = Math.min(28, slotW * 0.55);
                  const finalH = (bucket.finalSpendingsCents / maxCents()) * plotH;
                  const provH = (bucket.provisionalSpendingsCents / maxCents()) * plotH;
                  const finalY = padTop + plotH - finalH;
                  const provY = finalY - provH;

                  return (
                    <g
                      onMouseEnter={() => setHoveredIdx(idx())}
                      class="cursor-pointer"
                    >
                      <rect
                        x={padLeft + idx() * slotW}
                        y={padTop}
                        width={slotW}
                        height={plotH}
                        class={isHovered() ? "fill-slate-50 dark:fill-slate-800/70" : "fill-transparent"}
                      />
                      <Show when={finalH > 0}>
                        <rect
                          x={xCenter - barW / 2}
                          y={finalY}
                          width={barW}
                          height={finalH}
                          rx="2"
                          class="fill-slate-900 dark:fill-slate-200"
                        />
                      </Show>
                      <Show when={provH > 0}>
                        <rect
                          x={xCenter - barW / 2}
                          y={provY}
                          width={barW}
                          height={provH}
                          rx="2"
                          fill="#fb923c"
                        />
                      </Show>
                      <text
                        x={xCenter}
                        y={height - 14}
                        text-anchor="middle"
                        class={`text-[10px] ${isHovered() ? "fill-slate-900 dark:fill-slate-100 font-bold" : "fill-slate-500 dark:fill-slate-400"}`}
                      >
                        {labelFor(bucket).slice(0, 10)}
                      </text>
                    </g>
                  );
                }

                const barW = Math.min(18, slotW * 0.34);
                const inTotal = bucket.confirmedEntriesCents + bucket.provisionalEntriesCents;
                const outTotal = bucket.finalSpendingsCents + bucket.provisionalSpendingsCents;
                const inH = (inTotal / maxCents()) * plotH;
                const outH = (outTotal / maxCents()) * plotH;

                return (
                  <g
                    onMouseEnter={() => setHoveredIdx(idx())}
                    class="cursor-pointer"
                  >
                    <rect
                      x={padLeft + idx() * slotW}
                      y={padTop}
                      width={slotW}
                      height={plotH}
                      class={isHovered() ? "fill-slate-50 dark:fill-slate-800/70" : "fill-transparent"}
                    />
                    <Show when={inH > 0}>
                      <rect
                        x={xCenter - barW - 1.5}
                        y={padTop + plotH - inH}
                        width={barW}
                        height={inH}
                        rx="2"
                        fill="#059669"
                      />
                    </Show>
                    <Show when={outH > 0}>
                      <rect
                        x={xCenter + 1.5}
                        y={padTop + plotH - outH}
                        width={barW}
                        height={outH}
                        rx="2"
                        fill="#dc2626"
                      />
                    </Show>
                    <text
                      x={xCenter}
                      y={height - 14}
                      text-anchor="middle"
                      class={`text-[10px] ${isHovered() ? "fill-slate-900 dark:fill-slate-100 font-bold" : "fill-slate-500 dark:fill-slate-400"}`}
                    >
                      {labelFor(bucket).slice(0, 10)}
                    </text>
                  </g>
                );
              }}
            </For>
          </svg>
        </div>
      </div>
    </Show>
  );
}

export function BalanceCurveChart(props: {
  buckets: TimeBucketRow[];
  openingBalanceCents: number;
  periodUnit?: RatePeriod;
}) {
  const { locale, t } = useI18n();
  const [hoveredIdx, setHoveredIdx] = createSignal<number | null>(null);
  const period = () => props.periodUnit ?? "month";
  const labelFor = (b: TimeBucketRow) =>
    formatTimeBucketLabel(b.bucketKey, b.label, period(), locale());

  const range = createMemo(() => {
    const vals = [props.openingBalanceCents];
    for (const b of props.buckets) {
      vals.push(b.cumulativeActualBalanceCents, b.cumulativeProjectedBalanceCents);
    }
    const min = Math.min(0, ...vals);
    const max = Math.max(0, ...vals);
    const span = Math.max(100, max - min);
    return { min, max, span };
  });

  const width = 760;
  const height = 230;
  const padLeft = 58;
  const padRight = 24;
  const padTop = 20;
  const padBottom = 38;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const yFor = (cents: number) => {
    const r = range();
    return padTop + plotH - ((cents - r.min) / r.span) * plotH;
  };

  const xFor = (idx: number, total: number) => {
    if (total <= 1) return padLeft + plotW / 2;
    return padLeft + (idx / (total - 1)) * plotW;
  };

  const actualPoints = createMemo(() =>
    props.buckets.map((b, i) => `${xFor(i, props.buckets.length)},${yFor(b.cumulativeActualBalanceCents)}`).join(" ")
  );

  const projectedPoints = createMemo(() =>
    props.buckets.map((b, i) => `${xFor(i, props.buckets.length)},${yFor(b.cumulativeProjectedBalanceCents)}`).join(" ")
  );

  const hoveredBucket = () => {
    const i = hoveredIdx();
    return i !== null ? props.buckets[i] ?? null : null;
  };

  return (
    <Show
      when={props.buckets.length > 0}
      fallback={
        <div class="flex h-44 items-center justify-center rounded-lg border border-dashed border-slate-200 dark:border-slate-700 text-sm text-slate-400 dark:text-slate-500">
          {t().budgetCharts.emptyBalance}
        </div>
      }
    >
      <div class="space-y-2.5">
        <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <div class="flex flex-wrap items-center gap-4">
            <span class="inline-flex items-center gap-1.5">
              <span class="h-0.5 w-4 bg-emerald-600 inline-block" />
              {t().budgetCharts.legendActualBalance}
            </span>
            <span class="inline-flex items-center gap-1.5">
              <span class="h-0.5 w-4 border-t-2 border-dashed border-sky-600 dark:border-sky-400 inline-block" />
              {t().budgetCharts.legendProjectedBalance}
            </span>
            <span class="inline-flex items-center gap-1.5">
              <span class="h-0.5 w-4 border-t border-dashed border-rose-400 inline-block" />
              {t().budgetCharts.legendSolvencyFloor}
            </span>
          </div>
          <span class="text-[11px] tabular-nums">
            {t().budgetCharts.openingLabel} {formatEur(props.openingBalanceCents, locale())}
          </span>
        </div>

        <div class="min-h-6 rounded-lg bg-slate-50 dark:bg-slate-800/70 px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 flex flex-wrap items-center gap-x-4 gap-y-1 border border-slate-100 dark:border-slate-800">
          <Show
            when={hoveredBucket()}
            fallback={<span class="text-slate-400 dark:text-slate-500">{t().budgetCharts.hoverPointHint}</span>}
          >
            {b => (
              <>
                <span class="font-bold text-slate-900 dark:text-slate-100">{labelFor(b())}</span>
                <span class="font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                  {t().budgetCharts.actualLeftLabel}{" "}
                  {formatEur(b().cumulativeActualBalanceCents, locale())}
                </span>
                <span
                  class={`font-semibold tabular-nums ${
                    b().cumulativeProjectedBalanceCents < 0 ? "text-rose-700 dark:text-rose-400" : "text-sky-700 dark:text-sky-400"
                  }`}
                >
                  {t().budgetCharts.projectedLeftLabel}{" "}
                  {formatEur(b().cumulativeProjectedBalanceCents, locale())}
                </span>
              </>
            )}
          </Show>
        </div>

        <div class="w-full overflow-x-auto">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            onMouseLeave={() => setHoveredIdx(null)}
            class="min-w-[540px] w-full h-56 select-none"
          >
            <For each={[range().min, Math.round((range().min + range().max) / 2), range().max]}>
              {val => {
                const y = yFor(val);
                return (
                  <g>
                    <line
                      x1={padLeft}
                      y1={y}
                      x2={width - padRight}
                      y2={y}
                      class="stroke-slate-100 dark:stroke-slate-800"
                      stroke-dasharray="4 4"
                    />
                    <text
                      x={padLeft - 8}
                      y={y + 3}
                      text-anchor="end"
                      class="fill-slate-400 dark:fill-slate-500 text-[10px] tabular-nums"
                    >
                      {formatAxisEur(val)}
                    </text>
                  </g>
                );
              }}
            </For>

            {/* 0 EUR solvency line */}
            <line
              x1={padLeft}
              y1={yFor(0)}
              x2={width - padRight}
              y2={yFor(0)}
              class="stroke-rose-300 dark:stroke-rose-800"
              stroke-dasharray="4 4"
              stroke-width="1.2"
            />

            <Show when={props.buckets.length > 1}>
              <polyline
                fill="none"
                stroke="#0284c7"
                stroke-width="2"
                stroke-dasharray="6 4"
                points={projectedPoints()}
              />
              <polyline
                fill="none"
                stroke="#059669"
                stroke-width="2.5"
                points={actualPoints()}
              />
            </Show>

            <For each={props.buckets}>
              {(b, idx) => {
                const x = xFor(idx(), props.buckets.length);
                const ya = yFor(b.cumulativeActualBalanceCents);
                const yp = yFor(b.cumulativeProjectedBalanceCents);
                const isHov = () => hoveredIdx() === idx();
                const hitW = Math.max(16, plotW / Math.max(1, props.buckets.length));
                const showLabel =
                  props.buckets.length <= 12 ||
                  idx() === 0 ||
                  idx() === props.buckets.length - 1 ||
                  idx() % Math.ceil(props.buckets.length / 8) === 0;

                return (
                  <g onMouseEnter={() => setHoveredIdx(idx())} class="cursor-pointer">
                    <rect
                      x={x - hitW / 2}
                      y={padTop}
                      width={hitW}
                      height={plotH}
                      fill="transparent"
                    />
                    <Show when={isHov()}>
                      <line
                        x1={x}
                        y1={padTop}
                        x2={x}
                        y2={padTop + plotH}
                        class="stroke-slate-300 dark:stroke-slate-600"
                        stroke-width="1"
                      />
                    </Show>
                    <circle
                      cx={x}
                      cy={yp}
                      r={isHov() ? 5 : 3}
                      fill={b.cumulativeProjectedBalanceCents < 0 ? "#e11d48" : "#0284c7"}
                    />
                    <circle
                      cx={x}
                      cy={ya}
                      r={isHov() ? 5.5 : 3.5}
                      fill="#059669"
                      class="stroke-white dark:stroke-slate-900"
                      stroke-width="1.5"
                    />
                    <Show when={showLabel || isHov()}>
                      <text
                        x={x}
                        y={height - 14}
                        text-anchor="middle"
                        class={`text-[10px] ${isHov() ? "fill-slate-900 dark:fill-slate-100 font-bold" : "fill-slate-500 dark:fill-slate-400"}`}
                      >
                        {labelFor(b).slice(0, 10)}
                      </text>
                    </Show>
                  </g>
                );
              }}
            </For>
          </svg>
        </div>
      </div>
    </Show>
  );
}
