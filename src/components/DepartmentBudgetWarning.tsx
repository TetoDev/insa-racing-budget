import { AlertTriangle } from "lucide-solid";
import { Show } from "solid-js";
import { getBudgetUtilizationStatus } from "~/lib/budget-analytics";
import { DEPARTMENT_MAP, type DepartmentId } from "~/lib/constants";
import { formatEur } from "~/lib/format";

/**
 * Purely informational warning shown to approvers during Stage 1 / Stage 2 review
 * when a department has a configured budget envelope and reaches >= 75% utilization.
 */
export function DepartmentBudgetWarning(props: {
  department: DepartmentId;
  allocatedCents: number | null;
  spentAndCommittedCents: number;
  additionalEstimateCents?: number;
}) {
  const deptLabel = () => DEPARTMENT_MAP[props.department]?.label ?? props.department;
  const projectedWithAdditional = () =>
    props.spentAndCommittedCents + (props.additionalEstimateCents ?? 0);
  const pct = () =>
    props.allocatedCents && props.allocatedCents > 0
      ? Math.round((projectedWithAdditional() / props.allocatedCents) * 1000) / 10
      : null;
  const level = () => getBudgetUtilizationStatus(pct());

  return (
    <Show when={props.allocatedCents !== null && (level() === "warning" || level() === "over")}>
      <div
        class={`rounded-xl border px-3.5 py-2.5 text-xs flex items-start gap-2.5 ${
          level() === "over"
            ? "border-rose-300 bg-rose-50 text-rose-900"
            : "border-amber-300 bg-amber-50 text-amber-900"
        }`}
      >
        <AlertTriangle class="h-4 w-4 shrink-0 mt-0.5" />
        <div class="space-y-0.5">
          <div class="font-bold">
            Department Budget Warning (Advisory Only) — {deptLabel()} at {pct()}%
          </div>
          <div>
            Allocated envelope: <strong>{formatEur(props.allocatedCents!)}</strong> · Current
            committed + invoiced: <strong>{formatEur(props.spentAndCommittedCents)}</strong>
            <Show when={(props.additionalEstimateCents ?? 0) > 0}>
              {" "}· Adding selected/estimated option (<strong>+{formatEur(props.additionalEstimateCents!)}</strong>)
              brings total to <strong>{formatEur(projectedWithAdditional())}</strong>.
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
