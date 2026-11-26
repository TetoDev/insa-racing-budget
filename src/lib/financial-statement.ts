import type { DepartmentId, EntryCategory, EntryStatus } from "./constants";
import { getDictionary, type Locale } from "./i18n";

export type ChargeGroupId = "administratives" | "financieres" | "techniques";
export type ChargeLineId =
  | "local"
  | "secretariat"
  | "communication"
  | "dettes"
  | "powertrain"
  | "structure"
  | "suspensions"
  | "mecatronique"
  | "carrosserie"
  | "outillage";

export type IncomeGroupId = "aides" | "concours" | "sponsoring" | "propre";

export interface StatementCellItem {
  groupId: string;
  groupLabel: string;
  label: string;
  confirmedCents: number;
  provisionalCents: number;
  totalCents: number;
  highlight?: boolean;
  isBlankPadding?: boolean;
}

export interface PairedStatementRow {
  left: StatementCellItem | null;
  leftGroupSpan: number;
  right: StatementCellItem | null;
  rightGroupSpan: number;
}

export interface FinancialStatementReport {
  bannerTitle: string;
  chargesHeader: string;
  produitsHeader: string;
  totalLabel: string;
  leftRows: StatementCellItem[];
  rightRows: StatementCellItem[];
  pairedRows: PairedStatementRow[];
  totalChargesCents: number;
  totalChargesConfirmedCents: number;
  totalChargesProvisionalCents: number;
  totalProduitsCents: number;
  totalProduitsConfirmedCents: number;
  totalProduitsProvisionalCents: number;
  netProjectedResultCents: number;
  netConfirmedResultCents: number;
  openingBalanceCents: number;
  actualCashBalanceCents: number;
  projectedCashBalanceCents: number;
}

interface ChargeBucketDef {
  groupId: ChargeGroupId;
  lineId: ChargeLineId;
}

const CHARGE_SKELETON: ChargeBucketDef[] = [
  { groupId: "administratives", lineId: "local" },
  { groupId: "administratives", lineId: "secretariat" },
  { groupId: "administratives", lineId: "communication" },
  { groupId: "financieres", lineId: "dettes" },
  { groupId: "techniques", lineId: "powertrain" },
  { groupId: "techniques", lineId: "structure" },
  { groupId: "techniques", lineId: "suspensions" },
  { groupId: "techniques", lineId: "mecatronique" },
  { groupId: "techniques", lineId: "carrosserie" },
  { groupId: "techniques", lineId: "outillage" }
];

const INCOME_GROUP_ORDER: IncomeGroupId[] = ["aides", "concours", "sponsoring", "propre"];

const DEBT_RE = /\b(dette|dettes|emprunt|remboursement prêt|loan|debt|overdraft|découvert)\b/i;
const LOCAL_RE =
  /\b(local|loyer|rent|atelier.*vacuum|vacuum|aspirateur|trash\s*bin|poubelle|acoustic\s*foam|mousse\s*acoustique|assurance\s*local|electricity|électricité|chauffage|cleaning|nettoyage|power\s*strips)\b/i;
const COMM_RE =
  /\b(communication|events?|poster|affiche|autocollant|sticker|vistaprint|goodies|hoodie|pull|merch|flyer|stand|salon|imprimerie)\b/i;
const TOOLING_RE =
  /\b(tool(?:ing|s)?|outillage|workshop|atelier|3d\s*printing|filament|welder|solder(?:ing)?|crimping|pipe\s*bender|dremel|saw|magigoo|glue|cutting\s*mat|lumber|polystyrene|sandpaper|respirator|power\s*supply|label\s*printer)\b/i;

const CONTEST_RE = /\b(concours|cr[eé]actifs|creactifs|prize|award|troph[eé]e)\b/i;
const SPONSOR_TITLE_RE =
  /\b(fondation\s*insa|lev[eé]e\s*de(?:s)?\s*fonds|m[eé]c[eé]nat|sponsor(?:ing)?)\b/i;
const GRANT_TITLE_RE = /\b(bde|fsdie|crous|subvention|grant|cvec|r[eé]gion|m[eé]tropole)\b/i;

/** Classifies a purchase spending/order into the Charges side of the association statement. */
export function classifyChargeBucket(input: {
  department: DepartmentId;
  carSystem?: string | null;
  title: string;
}): ChargeLineId {
  switch (input.department) {
    case "powertrain":
      return "powertrain";
    case "chassis":
    case "ergonomics":
      // Both monocoque/frame and cockpit/ergonomics roll up under Technical -> Structure.
      return "structure";
    case "suspension":
      return "suspensions";
    case "electronics":
      return "mecatronique";
    case "aero":
      return "carrosserie";
    case "team_logistics": {
      const hay = `${input.carSystem ?? ""} ${input.title}`;
      if (DEBT_RE.test(hay)) return "dettes";
      if (LOCAL_RE.test(hay)) return "local";
      if (COMM_RE.test(hay)) return "communication";
      if (TOOLING_RE.test(hay)) return "outillage";
      return "secretariat";
    }
  }
}

/** Classifies a money entry into one of the four Produits groups. */
export function classifyIncomeGroup(input: {
  category: EntryCategory;
  title: string;
  comment?: string | null;
}): IncomeGroupId {
  const hay = `${input.title} ${input.comment ?? ""}`;
  if (CONTEST_RE.test(hay)) return "concours";
  if (SPONSOR_TITLE_RE.test(hay)) return "sponsoring";
  if (input.category === "sponsorship" || input.category === "partnership") return "sponsoring";
  if (input.category === "fsdie" || input.category === "insa" || GRANT_TITLE_RE.test(hay)) {
    return "aides";
  }
  return "propre";
}

/**
 * Extracts a concise external-facing source label so multi-tranche grants/sales
 * (e.g. multiple CROUS or Apport Pulls deposits) roll up cleanly onto single lines.
 */
export function normalizeIncomeSourceLabel(rawTitle: string): string {
  const cleaned = rawTitle
    .replace(/\s*\(Prévisionnel[^)]*\)/gi, "")
    .replace(/\s*\(Provisional[^)]*\)/gi, "")
    .replace(/\s*\(Nov\s+\d{4}\)/gi, "")
    .trim();

  if (/^crous\b/i.test(cleaned)) return "CROUS";
  if (/^fsdie\s*insa\b/i.test(cleaned)) return "FSDIE INSA";
  if (/^bde\s+insa\b/i.test(cleaned)) return "BDE";
  if (/^apport\s*pulls\b/i.test(cleaned)) return "Apport Pulls";
  if (/^cotisations?\b/i.test(cleaned)) return "Cotisations";
  if (/^fondation\s*insa\b/i.test(cleaned)) return "Levée des fonds Fondation INSA";
  if (/^red\s*bull\b/i.test(cleaned)) return "Red Bull";
  if (/^matmut\b/i.test(cleaned)) return "Matmut";
  if (/^norelem\b/i.test(cleaned)) return "Norelem";
  if (/^circuit\s+de\s+l['’]europe\b/i.test(cleaned)) return "Circuit de l'Europe";
  if (/^concours\s+cr[eé]actifs\b/i.test(cleaned)) return "Concours Créactifs";

  const strippedSuffix = cleaned
    .replace(/\s*[—–-]\s*(M[eé]c[eé]nat\s*\/\s*Sponsoring|M[eé]c[eé]nat\s*\/\s*Subvention|Subvention[^—–]*)$/i, "")
    .trim();

  return strippedSuffix || cleaned || "Other";
}

function computeGroupSpans(rows: StatementCellItem[]): number[] {
  const spans = new Array<number>(rows.length).fill(0);
  let i = 0;
  while (i < rows.length) {
    const groupId = rows[i].groupId;
    let end = i + 1;
    while (end < rows.length && rows[end].groupId === groupId) {
      end++;
    }
    spans[i] = end - i;
    i = end;
  }
  return spans;
}

/**
 * Builds the side-by-side Charges / Produits association statement matching the team's
 * financial declaration table, directly computed from live season data.
 */
export function buildFinancialStatement(params: {
  seasonName: string;
  startDate: string;
  deadlineDate: string;
  openingBalanceCents: number;
  spendings: Array<{
    department: DepartmentId;
    carSystem?: string | null;
    title: string;
    finalAmountCents: number;
  }>;
  provisionalSpendings: Array<{
    department: DepartmentId;
    carSystem?: string | null;
    title: string;
    provisionalTotalCents: number;
  }>;
  entries: Array<{
    category: EntryCategory;
    status: EntryStatus;
    title: string;
    comment?: string | null;
    effectiveAmountCents: number;
  }>;
  locale: Locale;
  confirmedOnly?: boolean;
}): FinancialStatementReport {
  const {
    seasonName,
    startDate,
    deadlineDate,
    openingBalanceCents,
    spendings,
    provisionalSpendings,
    entries,
    locale,
    confirmedOnly = false
  } = params;
  const fs = getDictionary(locale).exportReport.financialStatement;

  const chargeAcc = new Map<ChargeLineId, { confirmed: number; provisional: number }>();
  for (const item of CHARGE_SKELETON) {
    chargeAcc.set(item.lineId, { confirmed: 0, provisional: 0 });
  }

  for (const sp of spendings) {
    const lineId = classifyChargeBucket({
      department: sp.department,
      carSystem: sp.carSystem,
      title: sp.title
    });
    chargeAcc.get(lineId)!.confirmed += sp.finalAmountCents;
  }

  for (const ord of provisionalSpendings) {
    const lineId = classifyChargeBucket({
      department: ord.department,
      carSystem: ord.carSystem,
      title: ord.title
    });
    chargeAcc.get(lineId)!.provisional += ord.provisionalTotalCents;
  }

  const leftRows: StatementCellItem[] = CHARGE_SKELETON.map(({ groupId, lineId }) => {
    const sums = chargeAcc.get(lineId)!;
    const prov = confirmedOnly ? 0 : sums.provisional;
    return {
      groupId,
      groupLabel: fs.groups[groupId],
      label: fs.chargeLines[lineId],
      confirmedCents: sums.confirmed,
      provisionalCents: sums.provisional,
      totalCents: sums.confirmed + prov
    };
  });

  const incomeBuckets = new Map<
    IncomeGroupId,
    Map<string, { label: string; confirmed: number; provisional: number }>
  >();
  for (const g of INCOME_GROUP_ORDER) {
    incomeBuckets.set(g, new Map());
  }

  for (const entry of entries) {
    if (entry.status === "cancelled") continue;
    if (confirmedOnly && entry.status !== "confirmed") continue;

    const groupId = classifyIncomeGroup({
      category: entry.category,
      title: entry.title,
      comment: entry.comment
    });
    const displayLabel = normalizeIncomeSourceLabel(entry.title);
    const key = displayLabel.toLowerCase();
    const bucket = incomeBuckets.get(groupId)!;
    const prev = bucket.get(key) ?? { label: displayLabel, confirmed: 0, provisional: 0 };
    if (entry.status === "confirmed") {
      prev.confirmed += entry.effectiveAmountCents;
    } else {
      prev.provisional += entry.effectiveAmountCents;
    }
    bucket.set(key, prev);
  }

  const rightRows: StatementCellItem[] = [];
  for (const groupId of INCOME_GROUP_ORDER) {
    const bucket = incomeBuckets.get(groupId)!;
    const items = Array.from(bucket.values());
    if (items.length === 0) {
      rightRows.push({
        groupId,
        groupLabel: fs.groups[groupId],
        label: fs.emptyGroupItem,
        confirmedCents: 0,
        provisionalCents: 0,
        totalCents: 0,
        highlight: groupId === "sponsoring"
      });
      continue;
    }

    for (const item of items) {
      const prov = confirmedOnly ? 0 : item.provisional;
      rightRows.push({
        groupId,
        groupLabel: fs.groups[groupId],
        label: item.label,
        confirmedCents: item.confirmed,
        provisionalCents: item.provisional,
        totalCents: item.confirmed + prov,
        highlight: groupId === "sponsoring"
      });
    }
  }

  // Pad the shorter column before its totals row so left & right "Total :" align horizontally,
  // inserting extra blank rows inside Administratives on the left (matching the reference sheet).
  if (leftRows.length < rightRows.length) {
    const padCount = rightRows.length - leftRows.length;
    const adminLastIdx = leftRows.reduce(
      (acc, row, idx) => (row.groupId === "administratives" ? idx : acc),
      0
    );
    const pads: StatementCellItem[] = Array.from({ length: padCount }, () => ({
      groupId: "administratives",
      groupLabel: fs.groups.administratives,
      label: "",
      confirmedCents: 0,
      provisionalCents: 0,
      totalCents: 0,
      isBlankPadding: true
    }));
    leftRows.splice(adminLastIdx + 1, 0, ...pads);
  } else if (rightRows.length < leftRows.length) {
    const padCount = leftRows.length - rightRows.length;
    const lastGroup = rightRows[rightRows.length - 1]?.groupId ?? "propre";
    const lastGroupLabel = rightRows[rightRows.length - 1]?.groupLabel ?? fs.groups.propre;
    for (let i = 0; i < padCount; i++) {
      rightRows.push({
        groupId: lastGroup,
        groupLabel: lastGroupLabel,
        label: "",
        confirmedCents: 0,
        provisionalCents: 0,
        totalCents: 0,
        isBlankPadding: true
      });
    }
  }

  const leftSpans = computeGroupSpans(leftRows);
  const rightSpans = computeGroupSpans(rightRows);
  const maxLen = Math.max(leftRows.length, rightRows.length);
  const pairedRows: PairedStatementRow[] = [];
  for (let i = 0; i < maxLen; i++) {
    pairedRows.push({
      left: leftRows[i] ?? null,
      leftGroupSpan: leftSpans[i] ?? 0,
      right: rightRows[i] ?? null,
      rightGroupSpan: rightSpans[i] ?? 0
    });
  }

  const totalChargesConfirmedCents = spendings.reduce((s, x) => s + x.finalAmountCents, 0);
  const totalChargesProvisionalCents = provisionalSpendings.reduce(
    (s, x) => s + x.provisionalTotalCents,
    0
  );
  const totalChargesCents =
    totalChargesConfirmedCents + (confirmedOnly ? 0 : totalChargesProvisionalCents);

  const activeEntries = entries.filter(e => e.status !== "cancelled");
  const totalProduitsConfirmedCents = activeEntries
    .filter(e => e.status === "confirmed")
    .reduce((s, e) => s + e.effectiveAmountCents, 0);
  const totalProduitsProvisionalCents = activeEntries
    .filter(e => e.status === "provisional")
    .reduce((s, e) => s + e.effectiveAmountCents, 0);
  const totalProduitsCents =
    totalProduitsConfirmedCents + (confirmedOnly ? 0 : totalProduitsProvisionalCents);

  const netConfirmedResultCents = totalProduitsConfirmedCents - totalChargesConfirmedCents;
  const netProjectedResultCents =
    totalProduitsConfirmedCents +
    totalProduitsProvisionalCents -
    (totalChargesConfirmedCents + totalChargesProvisionalCents);

  return {
    bannerTitle: fs.sheetBanner(seasonName, startDate, deadlineDate),
    chargesHeader: fs.chargesHeader,
    produitsHeader: fs.produitsHeader,
    totalLabel: fs.totalLabel,
    leftRows,
    rightRows,
    pairedRows,
    totalChargesCents,
    totalChargesConfirmedCents,
    totalChargesProvisionalCents,
    totalProduitsCents,
    totalProduitsConfirmedCents,
    totalProduitsProvisionalCents,
    netProjectedResultCents,
    netConfirmedResultCents,
    openingBalanceCents,
    actualCashBalanceCents: openingBalanceCents + netConfirmedResultCents,
    projectedCashBalanceCents: openingBalanceCents + netProjectedResultCents
  };
}
