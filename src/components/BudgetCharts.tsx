import { For, Show, createMemo, createSignal } from "solid-js";
import {
  getBudgetUtilizationStatus,
  type CategoryEntryRow,
  type DepartmentBudgetRow,
  type TimeBucketRow
} from "~/lib/budget-analytics";
import type { DepartmentId } from "~/lib/constants";
import { formatEur } from "~/lib/format";

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
  const maxTotal = createMemo(() => {
    const vals = props.rows.flatMap(r => [r.totalProjectedCents, r.allocatedCents ?? 0]);
    const max = Math.max(...vals, 0);
    return max > 0 ? max : 100;
  });

  return (
    <div class="space-y-3">
      <div class="flex flex-wrap items-center gap-4 text-xs text-slate-500">
        <span class="inline-flex items-center gap-1.5">
          <span class="h-2.5 w-2.5 rounded-sm bg-slate-900" />
          Final Spendings (Invoiced)
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="h-2.5 w-2.5 rounded-sm bg-orange-400" />
          Provisional Orders
        </span>
        <Show when={props.rows.some(r => r.allocatedCents !== null)}>
          <span class="inline-flex items-center gap-1.5">
            <span class="h-3 w-0.5 bg-sky-600 inline-block" />
            Allocated Envelope
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
                  props.onSelectDepartment ? "hover:bg-slate-50 p-1.5 -mx-1.5 cursor-pointer" : ""
                }`}
              >
                <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div class="flex items-center gap-2 font-medium text-slate-800">
                    <span
                      class="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ "background-color": row.color }}
                    />
                    <span>{row.label}</span>
                    <span class="text-[11px] font-mono text-slate-400">({row.code})</span>
                    <Show when={row.utilizationProjectedPct !== null}>
                      <span
                        class={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                          utilStatus() === "over"
                            ? "bg-rose-100 text-rose-700"
                            : utilStatus() === "warning"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-emerald-100 text-emerald-800"
                        }`}
                      >
                        {row.utilizationProjectedPct}% of {formatEur(row.allocatedCents!)}
                      </span>
                    </Show>
                  </div>
                  <div class="tabular-nums font-medium text-slate-700">
                    {formatEur(row.finalSpendingsCents)}
                    <Show when={row.provisionalSpendingsCents > 0}>
                      <span class="text-orange-600">
                        {" "}+ {formatEur(row.provisionalSpendingsCents)} prov.
                      </span>
                    </Show>
                  </div>
                </div>
                <div class="relative flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    class="bg-slate-900 transition-all duration-300"
                    style={{ width: `${finalWidth()}%` }}
                    title={`Final: ${formatEur(row.finalSpendingsCents)}`}
                  />
                  <div
                    class="bg-orange-400 transition-all duration-300"
                    style={{ width: `${provWidth()}%` }}
                    title={`Provisional: ${formatEur(row.provisionalSpendingsCents)}`}
                  />
                  <Show when={allocPos() !== null}>
                    <div
                      class="absolute top-0 bottom-0 w-0.5 bg-sky-600 z-10"
                      style={{ left: `${allocPos()}%` }}
                      title={`Allocated budget: ${formatEur(row.allocatedCents!)}`}
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
  const maxVal = createMemo(() => {
    const max = Math.max(...props.rows.map(r => r.totalProjectedCents), 0);
    return max > 0 ? max : 100;
  });

  return (
    <div class="space-y-3">
      <div class="flex items-center gap-4 text-xs text-slate-500">
        <span class="inline-flex items-center gap-1.5">
          <span class="h-2.5 w-2.5 rounded-sm bg-emerald-600" />
          Confirmed Entries
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="h-2.5 w-2.5 rounded-sm bg-amber-400" />
          Provisional Entries
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
                  <div class="flex items-center gap-2 font-medium text-slate-800">
                    <span
                      class="h-2.5 w-2.5 rounded-full"
                      style={{ "background-color": row.color }}
                    />
                    <span>{row.label}</span>
                  </div>
                  <div class="tabular-nums font-medium text-slate-700">
                    {formatEur(row.confirmedCents)}
                    <Show when={row.provisionalCents > 0}>
                      <span class="text-amber-600">
                        {" "}+ {formatEur(row.provisionalCents)} prov.
                      </span>
                    </Show>
                  </div>
                </div>
                <div class="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
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
}) {
  const [showAll, setShowAll] = createSignal(false);
  const [hoveredIdx, setHoveredIdx] = createSignal<number | null>(null);

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
        <div class="flex h-48 items-center justify-center rounded-lg border border-dashed border-slate-200 text-sm text-slate-400">
          No financial activity recorded in the selected timeframe.
        </div>
      }
    >
      <div class="space-y-2.5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap items-center gap-4 text-xs text-slate-500">
            <Show
              when={props.mode === "spendings"}
              fallback={
                <>
                  <span class="inline-flex items-center gap-1.5">
                    <span class="h-2.5 w-2.5 rounded-sm bg-emerald-600" />
                    Input (Confirmed + Prov.)
                  </span>
                  <span class="inline-flex items-center gap-1.5">
                    <span class="h-2.5 w-2.5 rounded-sm bg-red-600" />
                    Output (Final + Prov.)
                  </span>
                </>
              }
            >
              <span class="inline-flex items-center gap-1.5">
                <span class="h-2.5 w-2.5 rounded-sm bg-slate-900" />
                Final Spendings
              </span>
              <span class="inline-flex items-center gap-1.5">
                <span class="h-2.5 w-2.5 rounded-sm bg-orange-400" />
                Provisional Spendings
              </span>
            </Show>
          </div>

          <Show when={props.buckets.length > 18}>
            <button
              type="button"
              onClick={() => setShowAll(prev => !prev)}
              class="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
            >
              {showAll() ? "Show Last 18 Periods" : `Show All ${props.buckets.length} Periods`}
            </button>
          </Show>
        </div>

        {/* Interactive tooltip readout bar */}
        <div class="min-h-6 rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-slate-600 flex flex-wrap items-center justify-between gap-2 border border-slate-100">
          <Show
            when={hoveredBucket()}
            fallback={<span class="text-slate-400">Hover any period bar to inspect exact EUR breakdown.</span>}
          >
            {b => (
              <Show
                when={props.mode === "spendings"}
                fallback={
                  <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span class="font-bold text-slate-900">{b().label}</span>
                    <span class="text-emerald-700 font-semibold tabular-nums">
                      Input: +{formatEur(b().confirmedEntriesCents + b().provisionalEntriesCents)}
                    </span>
                    <span class="text-red-600 font-semibold tabular-nums">
                      Output: -{formatEur(b().finalSpendingsCents + b().provisionalSpendingsCents)}
                    </span>
                    <span class="font-semibold text-slate-800 tabular-nums">
                      Net Actual: {formatEur(b().netActualCents)}
                    </span>
                  </div>
                }
              >
                <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span class="font-bold text-slate-900">{b().label}</span>
                  <span class="text-slate-800 font-semibold tabular-nums">
                    Final: {formatEur(b().finalSpendingsCents)}
                  </span>
                  <span class="text-orange-600 font-semibold tabular-nums">
                    Provisional: {formatEur(b().provisionalSpendingsCents)}
                  </span>
                  <span class="font-bold text-slate-900 tabular-nums">
                    Combined: {formatEur(b().finalSpendingsCents + b().provisionalSpendingsCents)}
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
                      stroke={ratio === 0 ? "#cbd5e1" : "#f1f5f9"}
                      stroke-dasharray={ratio === 0 ? undefined : "4 4"}
                      stroke-width="1"
                    />
                    <text
                      x={padLeft - 8}
                      y={y + 3}
                      text-anchor="end"
                      class="fill-slate-400 text-[10px] tabular-nums"
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
                        fill={isHovered() ? "#f8fafc" : "transparent"}
                      />
                      <Show when={finalH > 0}>
                        <rect
                          x={xCenter - barW / 2}
                          y={finalY}
                          width={barW}
                          height={finalH}
                          rx="2"
                          fill="#0f172a"
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
                        class={`text-[10px] ${isHovered() ? "fill-slate-900 font-bold" : "fill-slate-500"}`}
                      >
                        {bucket.label.slice(0, 10)}
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
                      fill={isHovered() ? "#f8fafc" : "transparent"}
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
                      class={`text-[10px] ${isHovered() ? "fill-slate-900 font-bold" : "fill-slate-500"}`}
                    >
                      {bucket.label.slice(0, 10)}
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
}) {
  const [hoveredIdx, setHoveredIdx] = createSignal<number | null>(null);

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
        <div class="flex h-44 items-center justify-center rounded-lg border border-dashed border-slate-200 text-sm text-slate-400">
          No cumulative balance points recorded in the selected timeframe.
        </div>
      }
    >
      <div class="space-y-2.5">
        <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <div class="flex flex-wrap items-center gap-4">
            <span class="inline-flex items-center gap-1.5">
              <span class="h-0.5 w-4 bg-emerald-600 inline-block" />
              Actual Cash Balance
            </span>
            <span class="inline-flex items-center gap-1.5">
              <span class="h-0.5 w-4 border-t-2 border-dashed border-sky-600 inline-block" />
              Projected Balance
            </span>
            <span class="inline-flex items-center gap-1.5">
              <span class="h-0.5 w-4 border-t border-dashed border-rose-400 inline-block" />
              0 € Solvency Floor
            </span>
          </div>
          <span class="text-[11px] tabular-nums">Opening: {formatEur(props.openingBalanceCents)}</span>
        </div>

        <div class="min-h-6 rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-slate-600 flex flex-wrap items-center gap-x-4 gap-y-1 border border-slate-100">
          <Show
            when={hoveredBucket()}
            fallback={<span class="text-slate-400">Hover any point to inspect cumulative balance trajectory.</span>}
          >
            {b => (
              <>
                <span class="font-bold text-slate-900">{b().label}</span>
                <span class="font-semibold text-emerald-700 tabular-nums">
                  Actual Left: {formatEur(b().cumulativeActualBalanceCents)}
                </span>
                <span
                  class={`font-semibold tabular-nums ${
                    b().cumulativeProjectedBalanceCents < 0 ? "text-rose-700" : "text-sky-700"
                  }`}
                >
                  Projected Left: {formatEur(b().cumulativeProjectedBalanceCents)}
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
                      stroke="#f1f5f9"
                      stroke-dasharray="4 4"
                    />
                    <text
                      x={padLeft - 8}
                      y={y + 3}
                      text-anchor="end"
                      class="fill-slate-400 text-[10px] tabular-nums"
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
              stroke="#fda4af"
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
                        stroke="#cbd5e1"
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
                      stroke="#ffffff"
                      stroke-width="1.5"
                    />
                    <Show when={showLabel || isHov()}>
                      <text
                        x={x}
                        y={height - 14}
                        text-anchor="middle"
                        class={`text-[10px] ${isHov() ? "fill-slate-900 font-bold" : "fill-slate-500"}`}
                      >
                        {b.label.slice(0, 10)}
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
