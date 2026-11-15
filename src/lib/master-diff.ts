export interface FieldChange {
  field: string;
  label: string;
  before: string;
  after: string;
}

export interface DiffFieldCandidate {
  field: string;
  label: string;
  before: string;
  after: string;
}

/**
 * Computes normalized before -> after differences across record fields.
 */
export function diffRecordFields(candidates: DiffFieldCandidate[]): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const item of candidates) {
    if (item.before !== item.after) {
      changes.push({
        field: item.field,
        label: item.label,
        before: item.before,
        after: item.after
      });
    }
  }
  return changes;
}

/**
 * Formats field-level changes, nested item notes, and attachment notes into a human-readable
 * audit/timeline entry body.
 */
export function formatDiffSummaryLines(params: {
  changes: FieldChange[];
  extraLines?: string[];
  reason?: string;
}): string {
  const lines: string[] = [];
  const cleanReason = params.reason?.trim();
  lines.push(cleanReason ? `Master edited record — Reason: ${cleanReason}` : "Master edited record:");

  for (const ch of params.changes) {
    const prev = ch.before.length > 0 ? ch.before : "—";
    const next = ch.after.length > 0 ? ch.after : "—";
    lines.push(`• ${ch.label}: ${prev} → ${next}`);
  }

  for (const line of params.extraLines ?? []) {
    if (line.trim()) {
      lines.push(`• ${line.trim()}`);
    }
  }

  return lines.join("\n");
}

/** Parses an optional ISO/datetime input string into a Date, throwing with field label on failure. */
export function parseOptionalTimestamp(
  raw: string | null | undefined,
  fieldLabel: string
): Date | null {
  if (!raw || !raw.trim()) return null;
  const parsed = new Date(raw.trim());
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldLabel} must be a valid date/time.`);
  }
  return parsed;
}

/** Parses a required ISO/datetime input string into a Date, throwing with field label on failure. */
export function parseRequiredTimestamp(raw: string, fieldLabel: string): Date {
  const parsed = parseOptionalTimestamp(raw, fieldLabel);
  if (!parsed) {
    throw new Error(`${fieldLabel} is required.`);
  }
  return parsed;
}
