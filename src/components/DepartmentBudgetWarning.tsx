import { AlertTriangle } from "lucide-solid";
import { Show } from "solid-js";
import { getBudgetUtilizationStatus } from "~/lib/budget-analytics";
import type { DepartmentId } from "~/lib/constants";
import { formatEur } from "~/lib/format";
import { getDepartmentLabel } from "~/lib/i18n";
import { useI18n } from "./AppContext";

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
  const { locale, t } = useI18n();
  const deptLabel = () => getDepartmentLabel(locale(), props.department);
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
            ? "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800/80 dark:bg-rose-950/60 dark:text-rose-200"
            : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800/80 dark:bg-amber-950/60 dark:text-amber-200"
        }`}
      >
        <AlertTriangle class="h-4 w-4 shrink-0 mt-0.5" />
        <div class="space-y-0.5">
          <div class="font-bold">
            {t().components.deptWarningTitle(deptLabel(), pct()!)}
          </div>
          <div>
            {t().components.deptWarningAllocated}{" "}
            <strong>{formatEur(props.allocatedCents!, locale())}</strong> ·{" "}
            {t().components.deptWarningCommitted}{" "}
            <strong>{formatEur(props.spentAndCommittedCents, locale())}</strong>
            <Show when={(props.additionalEstimateCents ?? 0) > 0}>
              {" "}
              ·{" "}
              {t().components.deptWarningAdding(
                formatEur(props.additionalEstimateCents!, locale()),
                formatEur(projectedWithAdditional(), locale())
              )}
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
