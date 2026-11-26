import { PassThrough } from "node:stream";
import archiver from "archiver";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import {
  BUDGET_SECTIONS,
  DEPARTMENT_MAP,
  ENTRY_CATEGORY_MAP,
  type BudgetSectionId,
  type RatePeriod
} from "~/lib/constants";
import {
  buildFinancialStatement,
  type FinancialStatementReport
} from "~/lib/financial-statement";
import {
  formatCentsPlain,
  formatDate,
  formatEur,
  slugifyFilename
} from "~/lib/format";
import {
  formatCarSystemDisplay,
  formatTimeBucketLabel,
  getDepartmentLabel,
  getDictionary,
  getEntryCategoryLabel,
  getEntryStatusLabel,
  getRatePeriodLabel,
  getSeasonStatusLabel,
  normalizeLocale,
  type Locale
} from "~/lib/i18n";
import { getSeasonBudgetSnapshot } from "./budget";
import { readStoredFile } from "./storage";

export interface ExportRequestParams {
  seasonId: string;
  format: "xlsx" | "csv" | "pdf";
  includeZip: boolean;
  csvDelimiter: "," | ";";
  sections: BudgetSectionId[];
  fromDate?: string;
  toDate?: string;
  ratePeriod: RatePeriod;
  locale?: Locale;
}

type BudgetSnapshot = Awaited<ReturnType<typeof getSeasonBudgetSnapshot>>;

interface SectionTableData {
  title: string;
  tabName?: string;
  description: string;
  headers: string[];
  rows: Array<Array<string | number>>;
  eurCols?: number[]; // 1-based column indices
  pctCols?: number[]; // 1-based column indices
  sumCols?: number[]; // 1-based column indices for Totals row
  totalLabelCol?: number; // 1-based column for "TOTAL" label
  rightAlignCols?: number[]; // 1-based column indices right-aligned in PDF/XLSX
  pdfWeights?: number[];
  extraNotes?: { title: string; rows: Array<[string, string]> };
}

const THIN_BLACK: ExcelJS.Border = { style: "thin", color: { argb: "FF000000" } };
const MEDIUM_BLACK: ExcelJS.Border = { style: "medium", color: { argb: "FF000000" } };
const THIN_SLATE: ExcelJS.Border = { style: "thin", color: { argb: "FFCBD5E1" } };

/**
 * Normalizes strings for PDFKit's standard WinAnsi Helvetica font so narrow
 * non-breaking spaces in French Euro numbers or Unicode arrows never garble.
 */
function sanitizePdfText(val: string | number | null | undefined): string {
  return String(val ?? "—")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\u2192/g, "->")
    .replace(/\r?\n+/g, " ");
}

function formatPdfEur(cents: number, locale: Locale): string {
  return sanitizePdfText(formatEur(cents, locale));
}

function escapeCsvCell(val: string | number, delimiter: string): string {
  const s = String(val);
  if (s.includes(delimiter) || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsvLines(
  headers: string[],
  rows: Array<Array<string | number>>,
  delimiter: string
): string {
  const lines = [headers.map(h => escapeCsvCell(h, delimiter)).join(delimiter)];
  for (const r of rows) {
    lines.push(r.map(cell => escapeCsvCell(cell, delimiter)).join(delimiter));
  }
  return lines.join("\r\n");
}

function buildStatementForSnapshot(
  snapshot: BudgetSnapshot,
  locale: Locale,
  confirmedOnly = false
): FinancialStatementReport {
  return buildFinancialStatement({
    seasonName: snapshot.season.name,
    startDate: snapshot.season.startDate,
    deadlineDate: snapshot.season.deadlineDate,
    openingBalanceCents: snapshot.analytics.openingBalanceCents,
    spendings: snapshot.spendings,
    provisionalSpendings: snapshot.provisionalSpendings,
    entries: snapshot.entries,
    locale,
    confirmedOnly
  });
}

function computeTotalsRow(
  rows: Array<Array<string | number>>,
  colCount: number,
  sumCols: number[],
  totalLabelCol: number,
  totalLabel: string
): Array<string | number> {
  const totals: Array<string | number> = new Array(colCount).fill("");
  if (totalLabelCol >= 1 && totalLabelCol <= colCount) {
    totals[totalLabelCol - 1] = totalLabel;
  }
  for (const col of sumCols) {
    let sum = 0;
    let isFloat = false;
    let hasValue = false;
    for (const r of rows) {
      const raw = r[col - 1];
      if (typeof raw === "number" && Number.isFinite(raw)) {
        sum += raw;
        hasValue = true;
      } else if (typeof raw === "string" && /^-?\d+(\.\d+)?$/.test(raw.trim())) {
        sum += Number(raw.trim());
        if (raw.includes(".")) isFloat = true;
        hasValue = true;
      }
    }
    if (hasValue) {
      totals[col - 1] = isFloat ? sum.toFixed(2) : Math.round(sum);
    }
  }
  return totals;
}

function getSectionTabularData(
  sectionId: BudgetSectionId,
  snapshot: BudgetSnapshot,
  locale: Locale = "en"
): SectionTableData {
  const { season, analytics, spendings, provisionalSpendings, entries } = snapshot;
  const exp = getDictionary(locale).exportReport;
  const periodUnitLabel =
    locale === "en"
      ? analytics.rates.periodUnit
      : getRatePeriodLabel(locale, analytics.rates.periodUnit, "noun").toLowerCase();
  const formatPeriodBucket = (bucketKey: string, fallback: string) =>
    locale === "en"
      ? fallback
      : formatTimeBucketLabel(bucketKey, fallback, analytics.rates.periodUnit, locale);

  switch (sectionId) {
    case "financial_statement": {
      const stmt = buildStatementForSnapshot(snapshot, locale);
      const fsExp = exp.financialStatement;
      const rows: Array<Array<string | number>> = stmt.pairedRows.map(pair => [
        pair.left?.groupLabel ?? "",
        pair.left?.label ?? "",
        pair.left && !pair.left.isBlankPadding ? formatCentsPlain(pair.left.totalCents) : "",
        pair.right?.groupLabel ?? "",
        pair.right?.label ?? "",
        pair.right && !pair.right.isBlankPadding ? formatCentsPlain(pair.right.totalCents) : ""
      ]);
      rows.push([
        "",
        stmt.totalLabel,
        formatCentsPlain(stmt.totalChargesCents),
        "",
        stmt.totalLabel,
        formatCentsPlain(stmt.totalProduitsCents)
      ]);
      return {
        title: fsExp.title,
        tabName: fsExp.tabName,
        description: fsExp.sectionDesc,
        headers: [...fsExp.csvHeaders],
        rows,
        eurCols: [3, 6],
        rightAlignCols: [3, 6],
        extraNotes: {
          title: fsExp.reconciliationTitle,
          rows: [
            [
              fsExp.openingCarryOverLabel,
              formatPdfEur(stmt.openingBalanceCents, locale)
            ],
            [
              fsExp.realizedOnlyLabel,
              `${formatPdfEur(stmt.totalProduitsConfirmedCents, locale)} - ${formatPdfEur(stmt.totalChargesConfirmedCents, locale)} = ${formatPdfEur(stmt.netConfirmedResultCents, locale)}`
            ],
            [
              fsExp.withProvisionalLabel,
              `${formatPdfEur(stmt.totalProduitsCents, locale)} - ${formatPdfEur(stmt.totalChargesCents, locale)} = ${formatPdfEur(stmt.netProjectedResultCents, locale)}`
            ],
            [
              fsExp.endingActualCashLabel,
              formatPdfEur(stmt.actualCashBalanceCents, locale)
            ],
            [
              fsExp.endingProjectedCashLabel,
              formatPdfEur(stmt.projectedCashBalanceCents, locale)
            ],
            [exp.totalRowLabel, fsExp.mappingNote]
          ]
        }
      };
    }

    case "summary": {
      const netProjectedCents =
        analytics.confirmedEntriesCents +
        analytics.provisionalEntriesCents -
        (analytics.finalSpendingsCents + analytics.provisionalSpendingsCents);
      return {
        title: exp.summary.title,
        tabName: exp.summary.title,
        description: exp.summary.sectionDesc,
        headers: [...exp.summary.headers],
        eurCols: [2],
        rightAlignCols: [2],
        pdfWeights: [210, 120, 448],
        rows: [
          [
            exp.summary.rowSeasonName,
            season.name,
            `${season.startDate} -> ${season.deadlineDate} (${locale === "en" ? season.status : getSeasonStatusLabel(locale, season.status)})`
          ],
          [
            exp.summary.rowOpeningBalance,
            formatCentsPlain(analytics.openingBalanceCents),
            exp.summary.rowOpeningNote
          ],
          [
            exp.summary.rowConfirmedEntries,
            formatCentsPlain(analytics.confirmedEntriesCents),
            exp.summary.rowConfirmedCount(analytics.counts.confirmedEntries)
          ],
          [
            exp.summary.rowProvisionalEntries,
            formatCentsPlain(analytics.provisionalEntriesCents),
            exp.summary.rowProvisionalCount(analytics.counts.provisionalEntries)
          ],
          [
            exp.summary.rowFinalSpendings,
            formatCentsPlain(analytics.finalSpendingsCents),
            exp.summary.rowInvoicedCount(analytics.counts.finalSpendings)
          ],
          [
            exp.summary.rowProvisionalSpendings,
            formatCentsPlain(analytics.provisionalSpendingsCents),
            exp.summary.rowActiveOrdersCount(analytics.counts.activeOrders)
          ],
          [
            exp.summary.rowNetPeriodResult,
            formatCentsPlain(netProjectedCents),
            exp.summary.rowNetPeriodResultNote
          ],
          [
            exp.summary.rowActualCashLeft,
            formatCentsPlain(analytics.actualCashLeftCents),
            exp.summary.rowActualCashNote
          ],
          [
            exp.summary.rowProjectedBalance,
            formatCentsPlain(analytics.projectedBalanceCents),
            exp.summary.rowProjectedNote
          ],
          [
            exp.summary.rowOpenRequests,
            "—",
            exp.summary.rowPendingCount(
              analytics.counts.pendingReview +
                analytics.counts.counterProposed +
                analytics.counts.optionSelection
            )
          ]
        ],
        extraNotes: {
          title: exp.summary.glossaryTitle,
          rows: exp.summary.glossaryRows.map(([k, v]) => [k, v] as [string, string])
        }
      };
    }

    case "by_department":
      return {
        title: exp.byDepartment.title,
        tabName: exp.byDepartment.tabName,
        description: exp.byDepartment.sectionDesc,
        headers: [...exp.byDepartment.headers],
        eurCols: [3, 4, 5, 6, 7],
        pctCols: [8, 9],
        sumCols: [4, 5, 6, 10, 11, 12],
        totalLabelCol: 2,
        rightAlignCols: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        pdfWeights: [42, 92, 68, 68, 68, 68, 68, 56, 52, 64, 64, 68],
        rows: analytics.byDepartment.map(d => [
          d.code,
          getDepartmentLabel(locale, d.department),
          d.allocatedCents !== null ? formatCentsPlain(d.allocatedCents) : "—",
          formatCentsPlain(d.finalSpendingsCents),
          formatCentsPlain(d.provisionalSpendingsCents),
          formatCentsPlain(d.totalProjectedCents),
          d.remainingProjectedCents !== null ? formatCentsPlain(d.remainingProjectedCents) : "—",
          d.utilizationProjectedPct !== null ? d.utilizationProjectedPct : "—",
          d.shareOfFinalPct,
          d.spendingCount,
          d.orderCount,
          d.openRequestCount
        ])
      };

    case "by_timeframe":
      return {
        title: exp.byTimeframe.title(periodUnitLabel),
        tabName: exp.byTimeframe.tabName,
        description: exp.byTimeframe.sectionDesc,
        headers: [...exp.byTimeframe.headers],
        eurCols: [2, 3, 4, 5, 6],
        sumCols: [2, 3, 4, 5, 6],
        totalLabelCol: 1,
        rightAlignCols: [2, 3, 4, 5, 6],
        pdfWeights: [148, 126, 126, 126, 126, 126],
        rows: analytics.timeSeries.map(t => [
          formatPeriodBucket(t.bucketKey, t.label),
          formatCentsPlain(t.finalSpendingsCents),
          formatCentsPlain(t.provisionalSpendingsCents),
          formatCentsPlain(t.confirmedEntriesCents),
          formatCentsPlain(t.provisionalEntriesCents),
          formatCentsPlain(t.netActualCents)
        ])
      };

    case "all_spendings":
      return {
        title: exp.allSpendings.title,
        tabName: exp.allSpendings.tabName,
        description: exp.allSpendings.sectionDesc,
        headers: [...exp.allSpendings.headers],
        eurCols: [6, 7, 8, 9],
        sumCols: [6, 7, 8, 9],
        totalLabelCol: 4,
        rightAlignCols: [6, 7, 8, 9],
        pdfWeights: [54, 52, 76, 114, 78, 46, 42, 42, 54, 52, 54, 54, 56],
        rows: spendings.map(s => [
          s.requestCode,
          getDepartmentLabel(locale, s.department),
          s.carSystem ? formatCarSystemDisplay(s.carSystem, locale) : "—",
          s.title,
          s.chosenOptionLabel,
          formatCentsPlain(s.basePriceCents),
          formatCentsPlain(s.shippingCents),
          formatCentsPlain(s.importFeeCents),
          formatCentsPlain(s.finalAmountCents),
          s.effectiveDate.slice(0, 10),
          s.creatorName,
          s.invoicedByName,
          s.attachments
            .filter(a => a.kind === "invoice")
            .map(a => a.originalName)
            .join(", ") || "—"
        ])
      };

    case "provisional_spendings":
      return {
        title: exp.provisionalSpendings.title,
        tabName: exp.provisionalSpendings.tabName,
        description: exp.provisionalSpendings.sectionDesc,
        headers: [...exp.provisionalSpendings.headers],
        eurCols: [6, 7, 8, 9],
        sumCols: [6, 7, 8, 9],
        totalLabelCol: 4,
        rightAlignCols: [6, 7, 8, 9],
        pdfWeights: [58, 56, 84, 122, 84, 50, 46, 46, 58, 58, 58, 58],
        rows: provisionalSpendings.map(o => [
          o.requestCode,
          getDepartmentLabel(locale, o.department),
          o.carSystem ? formatCarSystemDisplay(o.carSystem, locale) : "—",
          o.title,
          o.chosenOptionLabel,
          formatCentsPlain(o.basePriceCents),
          formatCentsPlain(o.shippingCents),
          formatCentsPlain(o.importFeeCents),
          formatCentsPlain(o.provisionalTotalCents),
          o.orderedAt.slice(0, 10),
          o.creatorName,
          o.orderedByName
        ])
      };

    case "provisional_entries":
      return {
        title: exp.provisionalEntries.title,
        tabName: exp.provisionalEntries.tabName,
        description: exp.provisionalEntries.sectionDesc,
        headers: [...exp.provisionalEntries.headers],
        eurCols: [4],
        sumCols: [4],
        totalLabelCol: 3,
        rightAlignCols: [4],
        pdfWeights: [72, 92, 165, 86, 72, 100, 191],
        rows: entries
          .filter(e => e.status === "provisional")
          .map(e => [
            e.entryCode,
            getEntryCategoryLabel(locale, e.category),
            e.title,
            formatCentsPlain(e.initialAmountCents),
            e.entryDate,
            e.creatorName,
            e.comment.replace(/\s+/g, " ").trim()
          ])
      };

    case "all_entries":
      return {
        title: exp.allEntries.title,
        tabName: exp.allEntries.tabName,
        description: exp.allEntries.sectionDesc,
        headers: [...exp.allEntries.headers],
        eurCols: [5, 6],
        sumCols: [5, 6],
        totalLabelCol: 4,
        rightAlignCols: [5, 6],
        pdfWeights: [56, 62, 66, 128, 58, 58, 58, 60, 66, 66, 100],
        rows: entries.map(e => [
          e.entryCode,
          getEntryStatusLabel(locale, e.status),
          getEntryCategoryLabel(locale, e.category),
          e.title,
          formatCentsPlain(e.initialAmountCents),
          formatCentsPlain(e.effectiveAmountCents),
          e.entryDate,
          e.confirmedAt ? e.confirmedAt.slice(0, 10) : "—",
          e.creatorName,
          e.confirmedByName ?? "—",
          e.comment.replace(/\s+/g, " ").trim()
        ])
      };

    case "entries_by_category":
      return {
        title: exp.entriesByCategory.title,
        tabName: exp.entriesByCategory.tabName,
        description: exp.entriesByCategory.sectionDesc,
        headers: [...exp.entriesByCategory.headers],
        eurCols: [2, 3, 4],
        pctCols: [5],
        sumCols: [2, 3, 4, 6, 7],
        totalLabelCol: 1,
        rightAlignCols: [2, 3, 4, 5, 6, 7],
        pdfWeights: [158, 120, 120, 120, 90, 85, 85],
        rows: analytics.byCategory.map(c => [
          getEntryCategoryLabel(locale, c.category),
          formatCentsPlain(c.confirmedCents),
          formatCentsPlain(c.provisionalCents),
          formatCentsPlain(c.totalProjectedCents),
          c.shareOfConfirmedPct,
          c.confirmedCount,
          c.provisionalCount
        ])
      };

    case "cashflow_rates":
      return {
        title: exp.cashflowRates.title(periodUnitLabel),
        tabName: exp.cashflowRates.tabName,
        description: exp.cashflowRates.sectionDesc,
        headers: [...exp.cashflowRates.headers],
        eurCols: [2, 3, 4, 5, 6],
        rightAlignCols: [2, 3, 4, 5, 6],
        pdfWeights: [148, 126, 126, 126, 126, 126],
        rows: [
          [
            exp.cashflowRates.summaryRowLabel(analytics.rates.periodCount, periodUnitLabel),
            formatCentsPlain(analytics.rates.actualInputPerPeriodCents) +
              exp.cashflowRates.perPeriodSuffix(periodUnitLabel),
            formatCentsPlain(analytics.rates.actualOutputPerPeriodCents) +
              exp.cashflowRates.perPeriodSuffix(periodUnitLabel),
            formatCentsPlain(analytics.rates.actualNetPerPeriodCents) +
              exp.cashflowRates.perPeriodSuffix(periodUnitLabel),
            formatCentsPlain(analytics.actualCashLeftCents),
            formatCentsPlain(analytics.projectedBalanceCents)
          ],
          ...analytics.timeSeries.map(t => [
            formatPeriodBucket(t.bucketKey, t.label),
            formatCentsPlain(t.confirmedEntriesCents),
            formatCentsPlain(t.finalSpendingsCents),
            formatCentsPlain(t.netActualCents),
            formatCentsPlain(t.cumulativeActualBalanceCents),
            formatCentsPlain(t.cumulativeProjectedBalanceCents)
          ])
        ]
      };
  }
}

function makeUniqueSheetName(used: Set<string>, rawName: string): string {
  const base = rawName.replace(/[\\/*?:[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Sheet";
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let idx = 2;
  while (true) {
    const suffix = ` (${idx})`;
    const candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    idx++;
  }
}

function applyBoxBorder(cell: ExcelJS.Cell, border: Partial<ExcelJS.Borders>): void {
  cell.border = border;
}

/**
 * Writes the Charges vs. Produits accounting sheet matching the team's visual reference
 * table (cyan top title, light-grey Charges / Produits headers, vertically merged category
 * groups, pale-yellow Mécénat/Sponsoring highlight, black gridlines, aligned =SUM totals).
 */
function writeStatementWorksheet(
  wb: ExcelJS.Workbook,
  snapshot: BudgetSnapshot,
  usedSheetNames: Set<string>,
  locale: Locale
): void {
  const exp = getDictionary(locale).exportReport;
  const fsExp = exp.financialStatement;
  const stmt = buildStatementForSnapshot(snapshot, locale);
  const ws = wb.addWorksheet(makeUniqueSheetName(usedSheetNames, fsExp.tabName));
  ws.views = [{ showGridLines: true }];
  ws.pageSetup = { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 1 };

  ws.columns = [
    { width: 20 },
    { width: 32 },
    { width: 16 },
    { width: 24 },
    { width: 36 },
    { width: 16 }
  ];

  // Row 1: Cyan/Teal Banner across A1:F1
  ws.mergeCells("A1:F1");
  const titleCell = ws.getCell("A1");
  titleCell.value = stmt.bannerTitle;
  titleCell.font = { name: "Arial", size: 11, bold: true, color: { argb: "FF000000" } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2DB5C0" } };
  ws.getRow(1).height = 24;
  for (let c = 1; c <= 6; c++) {
    applyBoxBorder(ws.getCell(1, c), {
      top: MEDIUM_BLACK,
      bottom: MEDIUM_BLACK,
      left: c === 1 ? MEDIUM_BLACK : undefined,
      right: c === 6 ? MEDIUM_BLACK : undefined
    });
  }

  // Row 2: Light grey Charges (A2:C2) and Produits (D2:F2) headers
  ws.mergeCells("A2:C2");
  ws.mergeCells("D2:F2");
  const chargesHdr = ws.getCell("A2");
  chargesHdr.value = stmt.chargesHeader;
  chargesHdr.font = { name: "Arial", size: 11, bold: false, color: { argb: "FF000000" } };
  chargesHdr.alignment = { horizontal: "left", vertical: "middle" };
  const produitsHdr = ws.getCell("D2");
  produitsHdr.value = stmt.produitsHeader;
  produitsHdr.font = { name: "Arial", size: 11, bold: false, color: { argb: "FF000000" } };
  produitsHdr.alignment = { horizontal: "left", vertical: "middle" };
  ws.getRow(2).height = 20;
  for (let c = 1; c <= 6; c++) {
    const cell = ws.getCell(2, c);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
    applyBoxBorder(cell, {
      top: THIN_BLACK,
      bottom: THIN_BLACK,
      left: c === 1 || c === 4 ? MEDIUM_BLACK : THIN_BLACK,
      right: c === 3 || c === 6 ? MEDIUM_BLACK : THIN_BLACK
    });
  }

  const firstItemRow = 3;
  stmt.pairedRows.forEach((pair, idx) => {
    const rIdx = firstItemRow + idx;
    const row = ws.getRow(rIdx);
    const maxLabelLen = Math.max((pair.left?.label ?? "").length, (pair.right?.label ?? "").length);
    row.height = Math.max(19, Math.min(46, Math.ceil(Math.max(1, maxLabelLen) / 34) * 15));

    // Left (Cols 1..3)
    const leftGroupCell = row.getCell(1);
    const leftLabelCell = row.getCell(2);
    const leftAmtCell = row.getCell(3);
    if (pair.leftGroupSpan > 0 && pair.left) {
      leftGroupCell.value = pair.left.groupLabel;
    }
    leftGroupCell.font = { name: "Arial", size: 10, color: { argb: "FF000000" } };
    leftGroupCell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };

    leftLabelCell.value = pair.left?.label ?? "";
    leftLabelCell.font = { name: "Arial", size: 10, color: { argb: "FF000000" } };
    leftLabelCell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };

    if (pair.left && !pair.left.isBlankPadding) {
      leftAmtCell.value = Number(formatCentsPlain(pair.left.totalCents));
      leftAmtCell.numFmt = '#,##0.00 "€"';
    }
    leftAmtCell.font = { name: "Arial", size: 10, color: { argb: "FF000000" } };
    leftAmtCell.alignment = { horizontal: "right", vertical: "middle" };

    // Right (Cols 4..6)
    const rightGroupCell = row.getCell(4);
    const rightLabelCell = row.getCell(5);
    const rightAmtCell = row.getCell(6);
    if (pair.rightGroupSpan > 0 && pair.right) {
      rightGroupCell.value = pair.right.groupLabel;
    }
    rightGroupCell.font = { name: "Arial", size: 10, color: { argb: "FF000000" } };
    rightGroupCell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };

    rightLabelCell.value = pair.right?.label ?? "";
    rightLabelCell.font = { name: "Arial", size: 10, color: { argb: "FF000000" } };
    rightLabelCell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    if (pair.right?.highlight && !pair.right.isBlankPadding) {
      rightLabelCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFF2CC" }
      };
    }

    if (pair.right && !pair.right.isBlankPadding) {
      rightAmtCell.value = Number(formatCentsPlain(pair.right.totalCents));
      rightAmtCell.numFmt = '#,##0.00 "€"';
    }
    rightAmtCell.font = { name: "Arial", size: 10, color: { argb: "FF000000" } };
    rightAmtCell.alignment = { horizontal: "right", vertical: "middle" };

    // Item-level crisp borders
    applyBoxBorder(leftLabelCell, { top: THIN_BLACK, bottom: THIN_BLACK, left: THIN_BLACK, right: THIN_BLACK });
    applyBoxBorder(leftAmtCell, { top: THIN_BLACK, bottom: THIN_BLACK, left: THIN_BLACK, right: MEDIUM_BLACK });
    applyBoxBorder(rightLabelCell, { top: THIN_BLACK, bottom: THIN_BLACK, left: THIN_BLACK, right: THIN_BLACK });
    applyBoxBorder(rightAmtCell, { top: THIN_BLACK, bottom: THIN_BLACK, left: THIN_BLACK, right: MEDIUM_BLACK });
  });

  // Merge vertical group cells cleanly on Col A & Col D with matching group outlines
  const applyGroupMerges = (colNum: number, spans: number[], leftBorder: ExcelJS.Border) => {
    for (let i = 0; i < spans.length; i++) {
      const span = spans[i];
      if (span <= 0) continue;
      const startRow = firstItemRow + i;
      const endRow = startRow + span - 1;
      if (span > 1) {
        ws.mergeCells(startRow, colNum, endRow, colNum);
      }
      for (let r = startRow; r <= endRow; r++) {
        applyBoxBorder(ws.getCell(r, colNum), {
          top: r === startRow ? THIN_BLACK : undefined,
          bottom: r === endRow ? THIN_BLACK : undefined,
          left: leftBorder,
          right: THIN_BLACK
        });
      }
    }
  };
  applyGroupMerges(1, stmt.pairedRows.map(p => p.leftGroupSpan), MEDIUM_BLACK);
  applyGroupMerges(4, stmt.pairedRows.map(p => p.rightGroupSpan), MEDIUM_BLACK);

  const lastItemRow = firstItemRow + stmt.pairedRows.length - 1;
  const totalRowNum = lastItemRow + 1;
  const totalRow = ws.getRow(totalRowNum);
  totalRow.height = 22;

  totalRow.getCell(2).value = stmt.totalLabel;
  totalRow.getCell(2).font = { name: "Arial", size: 10, bold: true, color: { argb: "FF000000" } };
  totalRow.getCell(2).alignment = { horizontal: "right", vertical: "middle" };

  const leftSumCell = totalRow.getCell(3);
  leftSumCell.value = {
    formula: `SUM(C${firstItemRow}:C${lastItemRow})`,
    result: Number(formatCentsPlain(stmt.totalChargesCents))
  };
  leftSumCell.numFmt = '#,##0.00 "€"';
  leftSumCell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FF000000" } };
  leftSumCell.alignment = { horizontal: "right", vertical: "middle" };

  totalRow.getCell(5).value = stmt.totalLabel;
  totalRow.getCell(5).font = { name: "Arial", size: 10, bold: true, color: { argb: "FF000000" } };
  totalRow.getCell(5).alignment = { horizontal: "right", vertical: "middle" };

  const rightSumCell = totalRow.getCell(6);
  rightSumCell.value = {
    formula: `SUM(F${firstItemRow}:F${lastItemRow})`,
    result: Number(formatCentsPlain(stmt.totalProduitsCents))
  };
  rightSumCell.numFmt = '#,##0.00 "€"';
  rightSumCell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FF000000" } };
  rightSumCell.alignment = { horizontal: "right", vertical: "middle" };

  for (let c = 1; c <= 6; c++) {
    applyBoxBorder(totalRow.getCell(c), {
      top: MEDIUM_BLACK,
      bottom: MEDIUM_BLACK,
      left: c === 1 || c === 4 ? MEDIUM_BLACK : c === 3 || c === 6 ? THIN_BLACK : undefined,
      right: c === 3 || c === 6 ? MEDIUM_BLACK : undefined
    });
  }

  // Reconciliation & External Reader Explanation block below the Bilan table
  let noteRow = totalRowNum + 2;
  ws.mergeCells(noteRow, 1, noteRow, 6);
  const noteHeader = ws.getCell(noteRow, 1);
  noteHeader.value = fsExp.reconciliationTitle;
  noteHeader.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
  noteHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
  ws.getRow(noteRow).height = 20;
  noteRow++;

  const reconLines: Array<[string, number | string]> = [
    [fsExp.openingCarryOverLabel, Number(formatCentsPlain(stmt.openingBalanceCents))],
    [fsExp.realizedOnlyLabel, Number(formatCentsPlain(stmt.netConfirmedResultCents))],
    [fsExp.withProvisionalLabel, Number(formatCentsPlain(stmt.netProjectedResultCents))],
    [fsExp.endingActualCashLabel, Number(formatCentsPlain(stmt.actualCashBalanceCents))],
    [fsExp.endingProjectedCashLabel, Number(formatCentsPlain(stmt.projectedCashBalanceCents))],
    [fsExp.mappingNote, ""]
  ];

  reconLines.forEach(([label, val], idx) => {
    const r = ws.getRow(noteRow);
    const isMappingNote = idx === reconLines.length - 1;
    if (isMappingNote) {
      ws.mergeCells(noteRow, 1, noteRow, 6);
      const cell = ws.getCell(noteRow, 1);
      cell.value = label;
      cell.font = { name: "Arial", size: 9, italic: true, color: { argb: "FF475569" } };
      cell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
      r.height = 28;
    } else {
      ws.mergeCells(noteRow, 1, noteRow, 5);
      const lblCell = ws.getCell(noteRow, 1);
      lblCell.value = label;
      lblCell.font = {
        name: "Arial",
        size: 10,
        bold: idx >= 3,
        color: { argb: "FF0F172A" }
      };
      lblCell.alignment = { horizontal: "left", vertical: "middle" };

      const valCell = ws.getCell(noteRow, 6);
      valCell.value = val;
      valCell.numFmt = '#,##0.00 "€"';
      valCell.font = {
        name: "Arial",
        size: 10,
        bold: idx >= 3,
        color: { argb: "FF0F172A" }
      };
      valCell.alignment = { horizontal: "right", vertical: "middle" };
      for (let c = 1; c <= 6; c++) {
        applyBoxBorder(ws.getCell(noteRow, c), {
          top: THIN_SLATE,
          bottom: THIN_SLATE,
          left: c === 1 || c === 6 ? THIN_SLATE : undefined,
          right: c === 6 ? THIN_SLATE : undefined
        });
      }
      r.height = 19;
    }
    noteRow++;
  });
}

function colNumberToLetter(colNum: number): string {
  let n = colNum;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function writeStructuredTableWorksheet(
  wb: ExcelJS.Workbook,
  data: SectionTableData,
  snapshot: BudgetSnapshot,
  usedSheetNames: Set<string>,
  locale: Locale
): void {
  const exp = getDictionary(locale).exportReport;
  const ws = wb.addWorksheet(makeUniqueSheetName(usedSheetNames, data.tabName ?? data.title));
  ws.pageSetup = { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  const colCount = Math.max(1, data.headers.length);
  ws.addRow([`INSA ROUEN RACING — ${snapshot.season.name} (${snapshot.season.yearCode})`]);
  ws.addRow([data.title, exp.xlsxGenerated(formatDate(new Date(), locale))]);
  ws.addRow([data.description]);
  ws.addRow([]);

  if (colCount > 1) {
    ws.mergeCells(1, 1, 1, colCount);
    ws.mergeCells(3, 1, 3, colCount);
  }
  ws.getRow(1).font = { name: "Arial", bold: true, size: 13, color: { argb: "FF0F172A" } };
  ws.getRow(1).height = 22;
  ws.getRow(2).font = { name: "Arial", bold: true, size: 10, color: { argb: "FFDC2626" } };
  ws.getRow(3).font = { name: "Arial", italic: true, size: 9.5, color: { argb: "FF475569" } };
  ws.getRow(3).alignment = { wrapText: true, vertical: "middle" };
  ws.getRow(3).height = 24;

  const headerRow = ws.addRow(data.headers);
  headerRow.height = 24;
  headerRow.font = { name: "Arial", bold: true, size: 10, color: { argb: "FFFFFFFF" } };
  for (let c = 1; c <= colCount; c++) {
    const hc = headerRow.getCell(c);
    hc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
    hc.alignment = {
      horizontal: data.rightAlignCols?.includes(c) ? "right" : "left",
      vertical: "middle",
      wrapText: true
    };
    applyBoxBorder(hc, { top: THIN_SLATE, bottom: MEDIUM_BLACK, left: THIN_SLATE, right: THIN_SLATE });
  }

  const firstDataRowNum = 6;
  if (data.rows.length === 0) {
    const emptyRow = ws.addRow([exp.pdfEmptySection]);
    if (colCount > 1) ws.mergeCells(emptyRow.number, 1, emptyRow.number, colCount);
    emptyRow.getCell(1).font = { name: "Arial", italic: true, size: 10, color: { argb: "FF64748B" } };
    emptyRow.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
    emptyRow.height = 22;
    for (let c = 1; c <= colCount; c++) {
      applyBoxBorder(emptyRow.getCell(c), { top: THIN_SLATE, bottom: THIN_SLATE, left: THIN_SLATE, right: THIN_SLATE });
    }
  }
  data.rows.forEach((r, idx) => {
    const converted = r.map((cell, colIdx) => {
      const colOneBased = colIdx + 1;
      if (
        (data.eurCols?.includes(colOneBased) || data.pctCols?.includes(colOneBased)) &&
        typeof cell === "string" &&
        /^-?\d+(\.\d+)?$/.test(cell.trim())
      ) {
        return Number(cell.trim());
      }
      return cell;
    });

    const added = ws.addRow(converted);
    const fillColor = idx % 2 === 1 ? "FFF8FAFC" : "FFFFFFFF";
    let maxLines = 1;

    for (let colIdx = 1; colIdx <= colCount; colIdx++) {
      const c = added.getCell(colIdx);
      c.font = { name: "Arial", size: 10, color: { argb: "FF0F172A" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillColor } };
      applyBoxBorder(c, { top: THIN_SLATE, bottom: THIN_SLATE, left: THIN_SLATE, right: THIN_SLATE });

      if (data.eurCols?.includes(colIdx) && typeof c.value === "number") {
        c.numFmt = '#,##0.00 "€"';
        c.alignment = { horizontal: "right", vertical: "middle" };
      } else if (data.pctCols?.includes(colIdx) && typeof c.value === "number") {
        c.numFmt = '0.0"%"';
        c.alignment = { horizontal: "right", vertical: "middle" };
      } else if (data.rightAlignCols?.includes(colIdx)) {
        c.alignment = { horizontal: "right", vertical: "middle" };
      } else {
        c.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
        const str = String(c.value ?? "");
        maxLines = Math.max(maxLines, Math.ceil(str.length / 42));
      }
    }
    added.height = Math.max(19, Math.min(64, maxLines * 14));
  });

  const lastDataRowNum = firstDataRowNum + data.rows.length - 1;
  if (data.sumCols && data.sumCols.length > 0 && data.rows.length > 0) {
    const computed = computeTotalsRow(
      data.rows,
      colCount,
      data.sumCols,
      data.totalLabelCol ?? 1,
      exp.totalRowLabel
    );
    const totalRow = ws.addRow(new Array(colCount).fill(""));
    totalRow.height = 22;
    const lblCol = data.totalLabelCol ?? 1;
    totalRow.getCell(lblCol).value = exp.totalRowLabel;

    for (let colIdx = 1; colIdx <= colCount; colIdx++) {
      const cell = totalRow.getCell(colIdx);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
      cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FF0F172A" } };
      applyBoxBorder(cell, {
        top: MEDIUM_BLACK,
        bottom: MEDIUM_BLACK,
        left: THIN_SLATE,
        right: THIN_SLATE
      });

      if (data.sumCols.includes(colIdx)) {
        const colLetter = colNumberToLetter(colIdx);
        const numericFallback = Number(computed[colIdx - 1] || 0);
        cell.value = {
          formula: `SUM(${colLetter}${firstDataRowNum}:${colLetter}${lastDataRowNum})`,
          result: Number.isFinite(numericFallback) ? numericFallback : 0
        };
        if (data.eurCols?.includes(colIdx)) {
          cell.numFmt = '#,##0.00 "€"';
        }
        cell.alignment = { horizontal: "right", vertical: "middle" };
      } else {
        cell.alignment = {
          horizontal: data.rightAlignCols?.includes(colIdx) ? "right" : "left",
          vertical: "middle"
        };
      }
    }
  }

  if (data.extraNotes && data.extraNotes.rows.length > 0) {
    ws.addRow([]);
    const hdrRow = ws.addRow([data.extraNotes.title]);
    const hdrNum = hdrRow.number;
    if (colCount > 1) ws.mergeCells(hdrNum, 1, hdrNum, colCount);
    hdrRow.getCell(1).font = { name: "Arial", bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    hdrRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
    hdrRow.height = 20;

    for (const [term, desc] of data.extraNotes.rows) {
      const nr = ws.addRow([term, desc]);
      if (colCount > 2) ws.mergeCells(nr.number, 2, nr.number, colCount);
      nr.getCell(1).font = { name: "Arial", bold: true, size: 9.5, color: { argb: "FF0F172A" } };
      nr.getCell(1).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
      nr.getCell(2).font = { name: "Arial", size: 9.5, color: { argb: "FF334155" } };
      nr.getCell(2).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
      for (let c = 1; c <= colCount; c++) {
        applyBoxBorder(nr.getCell(c), { top: THIN_SLATE, bottom: THIN_SLATE, left: THIN_SLATE, right: THIN_SLATE });
      }
      nr.height = Math.max(20, Math.ceil(desc.length / 75) * 14);
    }
  }

  ws.views = [{ state: "frozen", ySplit: 5 }];
  for (let colIdx = 1; colIdx <= colCount; colIdx++) {
    let maxLen = String(data.headers[colIdx - 1] ?? "").length;
    for (let rIdx = firstDataRowNum; rIdx <= lastDataRowNum + 1; rIdx++) {
      const val = ws.getRow(rIdx).getCell(colIdx).value;
      const text =
        val && typeof val === "object" && "formula" in val
          ? String(val.result ?? "")
          : String(val ?? "");
      if (text.length > maxLen) maxLen = text.length;
    }
    ws.getColumn(colIdx).width = Math.max(13, Math.min(44, maxLen + 4));
  }
}

async function generateXlsxBuffer(
  snapshot: BudgetSnapshot,
  sections: BudgetSectionId[],
  locale: Locale = "en"
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "INSA Racing Achats";
  wb.created = new Date();
  const usedSheetNames = new Set<string>();

  for (const sectionId of sections) {
    if (sectionId === "financial_statement") {
      writeStatementWorksheet(wb, snapshot, usedSheetNames, locale);
      continue;
    }
    const data = getSectionTabularData(sectionId, snapshot, locale);
    writeStructuredTableWorksheet(wb, data, snapshot, usedSheetNames, locale);
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

function generateCsvFiles(
  snapshot: BudgetSnapshot,
  sections: BudgetSectionId[],
  delimiter: string,
  locale: Locale = "en"
): Array<{ filename: string; content: Buffer }> {
  const BOM = "\uFEFF";
  const exp = getDictionary(locale).exportReport;
  return sections.map(sectionId => {
    const data = getSectionTabularData(sectionId, snapshot, locale);
    const rowsWithTotal =
      data.sumCols && data.sumCols.length > 0 && data.rows.length > 0
        ? [
            ...data.rows,
            computeTotalsRow(
              data.rows,
              data.headers.length,
              data.sumCols,
              data.totalLabelCol ?? 1,
              exp.totalRowLabel
            )
          ]
        : data.rows;
    const csv = BOM + buildCsvLines(data.headers, rowsWithTotal, delimiter);
    return {
      filename: `${slugifyFilename(snapshot.season.yearCode)}_${sectionId}.csv`,
      content: Buffer.from(csv, "utf8")
    };
  });
}

function generateSingleCsvBuffer(
  snapshot: BudgetSnapshot,
  sections: BudgetSectionId[],
  delimiter: string,
  locale: Locale = "en"
): Buffer {
  const BOM = "\uFEFF";
  const exp = getDictionary(locale).exportReport;
  const blocks = sections.map(sectionId => {
    const data = getSectionTabularData(sectionId, snapshot, locale);
    const rowsWithTotal =
      data.sumCols && data.sumCols.length > 0 && data.rows.length > 0
        ? [
            ...data.rows,
            computeTotalsRow(
              data.rows,
              data.headers.length,
              data.sumCols,
              data.totalLabelCol ?? 1,
              exp.totalRowLabel
            )
          ]
        : data.rows;
    let block =
      `${escapeCsvCell(data.title, delimiter)}\r\n` +
      `${escapeCsvCell(data.description, delimiter)}\r\n` +
      buildCsvLines(data.headers, rowsWithTotal, delimiter);
    if (data.extraNotes && data.extraNotes.rows.length > 0) {
      block +=
        `\r\n\r\n${escapeCsvCell(data.extraNotes.title, delimiter)}\r\n` +
        buildCsvLines([data.headers[0], data.headers[data.headers.length - 1]], data.extraNotes.rows, delimiter);
    }
    return block;
  });
  return Buffer.from(BOM + blocks.join("\r\n\r\n"), "utf8");
}

function scalePdfColumnWidths(weights: number[] | undefined, colCount: number, totalWidth: number): number[] {
  const raw =
    weights && weights.length === colCount ? weights : new Array<number>(colCount).fill(1);
  const sum = raw.reduce((a, b) => a + b, 0) || colCount;
  return raw.map(w => (w / sum) * totalWidth);
}

function drawPdfHeaderAndGuide(
  doc: PDFKit.PDFDocument,
  snapshot: BudgetSnapshot,
  locale: Locale
): void {
  const { season, analytics } = snapshot;
  const exp = getDictionary(locale).exportReport;
  const x0 = doc.page.margins.left;
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const yStart = doc.y;

  // Hero Banner
  doc.rect(x0, yStart, pageWidth, 54).fill("#0f172a");
  doc.rect(x0, yStart, 5, 54).fill("#dc2626");
  doc.fontSize(15).font("Helvetica-Bold").fillColor("#ffffff").text(sanitizePdfText(exp.pdfTitle), x0 + 16, yStart + 9, {
    width: pageWidth - 32
  });
  doc.fontSize(8.5).font("Helvetica").fillColor("#cbd5e1").text(sanitizePdfText(exp.pdfSubtitle), x0 + 16, yStart + 27, {
    width: pageWidth - 32
  });
  doc
    .fontSize(8)
    .font("Helvetica")
    .fillColor("#94a3b8")
    .text(
      sanitizePdfText(
        exp.pdfMeta(season.name, season.startDate, season.deadlineDate, formatDate(new Date(), locale))
      ),
      x0 + 16,
      yStart + 39,
      { width: pageWidth - 32 }
    );

  // 4 KPI Cards
  const cardsY = yStart + 64;
  const gap = 8;
  const cardW = (pageWidth - gap * 3) / 4;
  const cardH = 50;
  const totalInflows = analytics.confirmedEntriesCents + analytics.provisionalEntriesCents;
  const totalOutflows = analytics.finalSpendingsCents + analytics.provisionalSpendingsCents;

  const cards = [
    {
      label: exp.pdfKpiCards.cashLeftLabel,
      value: formatPdfEur(analytics.actualCashLeftCents, locale),
      help: exp.pdfKpiCards.cashLeftHelp,
      accent: analytics.actualCashLeftCents < 0 ? "#dc2626" : "#0f172a"
    },
    {
      label: exp.pdfKpiCards.projectedLabel,
      value: formatPdfEur(analytics.projectedBalanceCents, locale),
      help: exp.pdfKpiCards.projectedHelp,
      accent: analytics.projectedBalanceCents < 0 ? "#dc2626" : "#0369a1"
    },
    {
      label: exp.pdfKpiCards.inflowsLabel,
      value: formatPdfEur(totalInflows, locale),
      help: exp.pdfKpiCards.inflowsHelp(
        formatPdfEur(analytics.confirmedEntriesCents, locale),
        formatPdfEur(analytics.provisionalEntriesCents, locale)
      ),
      accent: "#047857"
    },
    {
      label: exp.pdfKpiCards.outflowsLabel,
      value: formatPdfEur(totalOutflows, locale),
      help: exp.pdfKpiCards.outflowsHelp(
        formatPdfEur(analytics.finalSpendingsCents, locale),
        formatPdfEur(analytics.provisionalSpendingsCents, locale)
      ),
      accent: "#0f172a"
    }
  ];

  cards.forEach((card, i) => {
    const cx = x0 + i * (cardW + gap);
    doc.rect(cx, cardsY, cardW, cardH).fillAndStroke("#f8fafc", "#cbd5e1");
    doc.rect(cx, cardsY, cardW, 3).fill(card.accent);
    doc
      .font("Helvetica-Bold")
      .fontSize(7.5)
      .fillColor("#475569")
      .text(sanitizePdfText(card.label), cx + 8, cardsY + 8, { width: cardW - 16, lineBreak: false });
    doc
      .font("Helvetica-Bold")
      .fontSize(12.5)
      .fillColor(card.accent)
      .text(sanitizePdfText(card.value), cx + 8, cardsY + 19, { width: cardW - 16, lineBreak: false });
    doc
      .font("Helvetica")
      .fontSize(6.8)
      .fillColor("#64748b")
      .text(sanitizePdfText(card.help), cx + 8, cardsY + 35, { width: cardW - 16, ellipsis: true, lineBreak: false });
  });

  // Quick Reader Guide box
  const guideY = cardsY + cardH + 10;
  const guideH = 52;
  doc.rect(x0, guideY, pageWidth, guideH).fillAndStroke("#f1f5f9", "#cbd5e1");
  doc
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor("#0f172a")
    .text(sanitizePdfText(exp.pdfReaderGuideTitle), x0 + 10, guideY + 6, { width: pageWidth - 20 });
  exp.pdfReaderGuideItems.forEach((bullet, idx) => {
    doc
      .font("Helvetica")
      .fontSize(7.2)
      .fillColor("#334155")
      .text(`• ${sanitizePdfText(bullet)}`, x0 + 12, guideY + 18 + idx * 10, {
        width: pageWidth - 24,
        lineBreak: false
      });
  });

  doc.x = x0;
  doc.y = guideY + guideH + 14;
}

/** Draws the photo-matched 6-column Charges vs. Produits table inside the PDF report. */
function drawPdfStatementSection(
  doc: PDFKit.PDFDocument,
  snapshot: BudgetSnapshot,
  locale: Locale
): void {
  const exp = getDictionary(locale).exportReport;
  const fsExp = exp.financialStatement;
  const stmt = buildStatementForSnapshot(snapshot, locale);
  const x0 = doc.page.margins.left;
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  const w = [
    pageWidth * 0.135,
    pageWidth * 0.245,
    pageWidth * 0.12,
    pageWidth * 0.15,
    pageWidth * 0.23,
    pageWidth * 0.12
  ];
  const colX = [x0];
  for (let i = 0; i < w.length - 1; i++) {
    colX.push(colX[i] + w[i]);
  }

  const rowHeights = stmt.pairedRows.map(pair => {
    doc.font("Helvetica").fontSize(8);
    const lh =
      pair.left && !pair.left.isBlankPadding
        ? doc.heightOfString(sanitizePdfText(pair.left.label), { width: w[1] - 10 })
        : 8;
    const rh =
      pair.right && !pair.right.isBlankPadding
        ? doc.heightOfString(sanitizePdfText(pair.right.label), { width: w[4] - 10 })
        : 8;
    return Math.max(16, Math.max(lh, rh) + 6);
  });
  const tableItemsHeight = rowHeights.reduce((a, b) => a + b, 0);
  const totalNeededHeight = 40 + 38 + tableItemsHeight + 20 + 62;
  if (doc.y + Math.min(totalNeededHeight, 360) > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }

  doc.fontSize(12).font("Helvetica-Bold").fillColor("#dc2626").text(sanitizePdfText(fsExp.title), x0);
  doc.fontSize(8).font("Helvetica").fillColor("#475569").text(sanitizePdfText(fsExp.sectionDesc), x0, doc.y + 1, {
    width: pageWidth
  });
  doc.moveDown(0.5);

  const leftW = w[0] + w[1] + w[2];
  const rightW = w[3] + w[4] + w[5];

  // Row 1: Teal banner
  let y = doc.y;
  doc.rect(x0, y, pageWidth, 20).fillAndStroke("#2db5c0", "#000000");
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#000000").text(sanitizePdfText(stmt.bannerTitle), x0 + 6, y + 5, {
    width: pageWidth - 12,
    align: "center",
    lineBreak: false
  });
  y += 20;

  // Row 2: Light grey Charges | Produits subheaders
  doc.rect(x0, y, leftW, 18).fillAndStroke("#e5e7eb", "#000000");
  doc.rect(x0 + leftW, y, rightW, 18).fillAndStroke("#e5e7eb", "#000000");
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#000000").text(sanitizePdfText(stmt.chargesHeader), x0 + 6, y + 4.5, {
    width: leftW - 12,
    lineBreak: false
  });
  doc.text(sanitizePdfText(stmt.produitsHeader), x0 + leftW + 6, y + 4.5, {
    width: rightW - 12,
    lineBreak: false
  });
  y += 18;

  const firstItemY = y;
  const rowOffsets: number[] = [];
  let accumY = firstItemY;
  stmt.pairedRows.forEach((pair, idx) => {
    const rh = rowHeights[idx];
    const ry = accumY;
    rowOffsets.push(ry);
    accumY += rh;

    // Label & Amount cells (Col B, C, E, F)
    doc.rect(colX[1], ry, w[1], rh).fillAndStroke("#ffffff", "#000000");
    doc.rect(colX[2], ry, w[2], rh).fillAndStroke("#ffffff", "#000000");

    const rightFill = pair.right?.highlight && !pair.right.isBlankPadding ? "#fff2cc" : "#ffffff";
    doc.rect(colX[4], ry, w[4], rh).fillAndStroke(rightFill, "#000000");
    doc.rect(colX[5], ry, w[5], rh).fillAndStroke("#ffffff", "#000000");

    doc.font("Helvetica").fontSize(8).fillColor("#000000");
    if (pair.left && !pair.left.isBlankPadding) {
      doc.text(sanitizePdfText(pair.left.label), colX[1] + 5, ry + 3.5, {
        width: w[1] - 10
      });
      doc.text(formatPdfEur(pair.left.totalCents, locale), colX[2] + 4, ry + (rh - 9) / 2, {
        width: w[2] - 8,
        align: "right",
        lineBreak: false
      });
    }
    if (pair.right && !pair.right.isBlankPadding) {
      doc.text(sanitizePdfText(pair.right.label), colX[4] + 5, ry + 3.5, {
        width: w[4] - 10
      });
      doc.text(formatPdfEur(pair.right.totalCents, locale), colX[5] + 4, ry + (rh - 9) / 2, {
        width: w[5] - 8,
        align: "right",
        lineBreak: false
      });
    }
  });

  // Vertically merged group boxes (Col A & Col D)
  const drawMergedGroupBoxes = (colIdx: number, spans: number[], labels: Array<string | undefined>) => {
    for (let i = 0; i < spans.length; i++) {
      const span = spans[i];
      if (span <= 0) continue;
      const gy = rowOffsets[i];
      let gh = 0;
      for (let k = 0; k < span; k++) gh += rowHeights[i + k];
      doc.rect(colX[colIdx], gy, w[colIdx], gh).fillAndStroke("#ffffff", "#000000");
      const label = sanitizePdfText(labels[i] ?? "");
      doc.font("Helvetica").fontSize(8).fillColor("#000000");
      const textH = doc.heightOfString(label, { width: w[colIdx] - 8, align: "center" });
      doc.text(label, colX[colIdx] + 4, gy + Math.max(2, (gh - textH) / 2), {
        width: w[colIdx] - 8,
        align: "center"
      });
    }
  };
  drawMergedGroupBoxes(
    0,
    stmt.pairedRows.map(p => p.leftGroupSpan),
    stmt.pairedRows.map(p => p.left?.groupLabel)
  );
  drawMergedGroupBoxes(
    3,
    stmt.pairedRows.map(p => p.rightGroupSpan),
    stmt.pairedRows.map(p => p.right?.groupLabel)
  );

  // Totals row
  const totY = accumY;
  doc.rect(x0, totY, leftW, 19).fillAndStroke("#ffffff", "#000000");
  doc.rect(x0 + leftW, totY, rightW, 19).fillAndStroke("#ffffff", "#000000");
  doc.rect(colX[2], totY, w[2], 19).fillAndStroke("#ffffff", "#000000");
  doc.rect(colX[5], totY, w[5], 19).fillAndStroke("#ffffff", "#000000");

  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#000000");
  doc.text(sanitizePdfText(stmt.totalLabel), colX[1] + 4, totY + 5, {
    width: w[1] - 8,
    align: "right",
    lineBreak: false
  });
  doc.text(formatPdfEur(stmt.totalChargesCents, locale), colX[2] + 4, totY + 5, {
    width: w[2] - 8,
    align: "right",
    lineBreak: false
  });
  doc.text(sanitizePdfText(stmt.totalLabel), colX[4] + 4, totY + 5, {
    width: w[4] - 8,
    align: "right",
    lineBreak: false
  });
  doc.text(formatPdfEur(stmt.totalProduitsCents, locale), colX[5] + 4, totY + 5, {
    width: w[5] - 8,
    align: "right",
    lineBreak: false
  });

  // Reconciliation strip underneath
  const recY = totY + 25;
  doc
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor("#0f172a")
    .text(sanitizePdfText(fsExp.reconciliationTitle), x0, recY);
  doc
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor("#334155")
    .text(
      `${sanitizePdfText(fsExp.openingCarryOverLabel)}: ${formatPdfEur(stmt.openingBalanceCents, locale)}   |   ` +
        `${sanitizePdfText(fsExp.endingActualCashLabel)}: ${formatPdfEur(stmt.actualCashBalanceCents, locale)}   |   ` +
        `${sanitizePdfText(fsExp.endingProjectedCashLabel)}: ${formatPdfEur(stmt.projectedCashBalanceCents, locale)}`,
      x0,
      recY + 11,
      { width: pageWidth }
    );
  doc
    .font("Helvetica-Oblique")
    .fontSize(7.2)
    .fillColor("#475569")
    .text(sanitizePdfText(fsExp.mappingNote), x0, recY + 22, { width: pageWidth });

  doc.x = x0;
  doc.y = recY + 42;
}

function drawPdfTableSection(
  doc: PDFKit.PDFDocument,
  data: SectionTableData,
  locale: Locale
): void {
  const exp = getDictionary(locale).exportReport;
  const x0 = doc.page.margins.left;
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bottomLimit = doc.page.height - doc.page.margins.bottom - 14;

  if (doc.y > bottomLimit - 95) {
    doc.addPage();
  }

  doc.fontSize(12).font("Helvetica-Bold").fillColor("#dc2626").text(sanitizePdfText(data.title), x0);
  doc.fontSize(8).font("Helvetica").fillColor("#475569").text(sanitizePdfText(data.description), x0, doc.y + 1, {
    width: pageWidth
  });
  doc.moveDown(0.45);

  const colCount = data.headers.length;
  const colWidths = scalePdfColumnWidths(data.pdfWeights, colCount, pageWidth);
  const colX: number[] = [x0];
  for (let i = 0; i < colWidths.length - 1; i++) {
    colX.push(colX[i] + colWidths[i]);
  }

  const fontSize = colCount >= 11 ? 6.8 : 7.6;

  const formatCellDisplay = (raw: string | number | undefined, colOneBased: number): string => {
    if (raw === undefined || raw === null || raw === "") return "—";
    if (data.eurCols?.includes(colOneBased) && typeof raw === "string") {
      if (/^-?\d+\.\d{2}$/.test(raw)) {
        return formatPdfEur(Math.round(Number(raw) * 100), locale);
      }
      const perMatch = raw.match(/^(-?\d+\.\d{2})(\s*\/.+)$/);
      if (perMatch) {
        return `${formatPdfEur(Math.round(Number(perMatch[1]) * 100), locale)}${sanitizePdfText(perMatch[2])}`;
      }
    }
    if (data.pctCols?.includes(colOneBased) && typeof raw === "number") {
      return `${raw.toFixed(1)}%`;
    }
    return sanitizePdfText(raw);
  };

  const measureRowHeight = (cells: string[], isHeader: boolean): number => {
    doc.font(isHeader ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize);
    let maxH = 10;
    for (let i = 0; i < colCount; i++) {
      const h = doc.heightOfString(cells[i] || " ", { width: Math.max(12, colWidths[i] - 8) });
      if (h > maxH) maxH = h;
    }
    return Math.max(isHeader ? 20 : 17, maxH + 8);
  };

  const drawRow = (
    cells: string[],
    opts: { isHeader?: boolean; isTotal?: boolean; zebra?: boolean }
  ) => {
    const isHeader = Boolean(opts.isHeader);
    const isTotal = Boolean(opts.isTotal);
    const rowH = measureRowHeight(cells, isHeader || isTotal);

    if (doc.y + rowH > bottomLimit) {
      doc.addPage();
      if (!isHeader) {
        drawHeaderRow();
      }
    }

    const y = doc.y;
    const fill = isHeader
      ? "#0f172a"
      : isTotal
        ? "#e2e8f0"
        : opts.zebra
          ? "#f8fafc"
          : "#ffffff";
    const stroke = isHeader ? "#0f172a" : "#cbd5e1";

    doc.rect(x0, y, pageWidth, rowH).fillAndStroke(fill, stroke);
    doc
      .font(isHeader || isTotal ? "Helvetica-Bold" : "Helvetica")
      .fontSize(fontSize)
      .fillColor(isHeader ? "#ffffff" : "#0f172a");

    for (let i = 0; i < colCount; i++) {
      const align = data.rightAlignCols?.includes(i + 1) ? "right" : "left";
      doc.text(cells[i] ?? "", colX[i] + 4, y + 4, {
        width: Math.max(12, colWidths[i] - 8),
        align
      });
    }
    doc.x = x0;
    doc.y = y + rowH;
  };

  const drawHeaderRow = () => {
    drawRow(data.headers.map(h => sanitizePdfText(h)), { isHeader: true });
  };

  drawHeaderRow();
  if (data.rows.length === 0) {
    drawRow([sanitizePdfText(exp.pdfEmptySection), ...new Array(Math.max(0, colCount - 1)).fill("")], {});
  } else {
    data.rows.forEach((r, idx) => {
      const formatted = r.map((c, colIdx) => formatCellDisplay(c, colIdx + 1));
      drawRow(formatted, { zebra: idx % 2 === 1 });
    });
    if (data.sumCols && data.sumCols.length > 0) {
      const totals = computeTotalsRow(
        data.rows,
        colCount,
        data.sumCols,
        data.totalLabelCol ?? 1,
        exp.totalRowLabel
      );
      const formattedTotals = totals.map((c, colIdx) =>
        c === "" ? "" : formatCellDisplay(c, colIdx + 1)
      );
      drawRow(formattedTotals, { isTotal: true });
    }
  }

  if (data.extraNotes && data.extraNotes.rows.length > 0) {
    doc.moveDown(0.5);
    if (doc.y + 70 > bottomLimit) doc.addPage();
    doc
      .font("Helvetica-Bold")
      .fontSize(8.5)
      .fillColor("#0f172a")
      .text(sanitizePdfText(data.extraNotes.title), x0);
    doc.moveDown(0.2);
    for (const [term, desc] of data.extraNotes.rows) {
      const line = `${sanitizePdfText(term)}: ${sanitizePdfText(desc)}`;
      const h = doc.font("Helvetica").fontSize(7.5).heightOfString(line, { width: pageWidth - 12 });
      if (doc.y + h + 4 > bottomLimit) doc.addPage();
      doc
        .font("Helvetica-Bold")
        .fontSize(7.5)
        .fillColor("#0f172a")
        .text(`${sanitizePdfText(term)}: `, x0 + 4, doc.y, { continued: true, width: pageWidth - 8 });
      doc.font("Helvetica").fillColor("#334155").text(sanitizePdfText(desc));
    }
  }

  doc.x = x0;
  doc.moveDown(1);
}

function generatePdfBuffer(
  snapshot: BudgetSnapshot,
  sections: BudgetSectionId[],
  locale: Locale = "en"
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 32,
      bufferPages: true
    });
    const chunks: Buffer[] = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const exp = getDictionary(locale).exportReport;
    drawPdfHeaderAndGuide(doc, snapshot, locale);

    for (const sectionId of sections) {
      if (sectionId === "financial_statement") {
        drawPdfStatementSection(doc, snapshot, locale);
        continue;
      }
      const data = getSectionTabularData(sectionId, snapshot, locale);
      drawPdfTableSection(doc, data, locale);
    }

    // Stamp page numbers cleanly across all buffered pages without triggering extra pages.
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const prevBottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const footerY = doc.page.height - 20;
      const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      doc
        .font("Helvetica")
        .fontSize(7.5)
        .fillColor("#64748b")
        .text(
          sanitizePdfText(exp.pdfPageFooter(i - range.start + 1, range.count)),
          doc.page.margins.left,
          footerY,
          { width, align: "center", lineBreak: false }
        );
      doc.page.margins.bottom = prevBottomMargin;
    }

    doc.end();
  });
}

async function createStructuredZipBuffer(params: {
  snapshot: BudgetSnapshot;
  sections: BudgetSectionId[];
  primaryFiles: Array<{ filename: string; content: Buffer }>;
}): Promise<Buffer> {
  const { snapshot, sections, primaryFiles } = params;
  const sectionSet = new Set(sections);

  const includeFinalSpendings =
    sectionSet.has("all_spendings") ||
    sectionSet.has("by_department") ||
    sectionSet.has("by_timeframe") ||
    sectionSet.has("summary") ||
    sectionSet.has("financial_statement") ||
    sectionSet.has("cashflow_rates");

  const includeProvSpendings =
    sectionSet.has("provisional_spendings") ||
    sectionSet.has("by_department") ||
    sectionSet.has("summary") ||
    sectionSet.has("financial_statement") ||
    sectionSet.has("cashflow_rates");

  const includeEntries =
    sectionSet.has("all_entries") ||
    sectionSet.has("entries_by_category") ||
    sectionSet.has("summary") ||
    sectionSet.has("financial_statement") ||
    sectionSet.has("cashflow_rates");

  const includeProvEntries =
    sectionSet.has("provisional_entries") ||
    sectionSet.has("entries_by_category") ||
    sectionSet.has("summary") ||
    sectionSet.has("financial_statement") ||
    sectionSet.has("cashflow_rates");

  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    stream.on("data", c => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
    archive.pipe(stream);

    for (const file of primaryFiles) {
      archive.append(file.content, { name: file.filename });
    }

    const usedPaths = new Set<string>();
    const appendAttachment = async (folder: string, originalName: string, storageKey: string) => {
      try {
        const buf = await readStoredFile(storageKey);
        let candidate = `${folder}/${originalName}`;
        let counter = 1;
        while (usedPaths.has(candidate)) {
          candidate = `${folder}/${counter}_${originalName}`;
          counter++;
        }
        usedPaths.add(candidate);
        archive.append(buf, { name: candidate });
      } catch {
        // Skip missing file gracefully rather than breaking the whole export
      }
    };

    (async () => {
      if (includeFinalSpendings) {
        for (const sp of snapshot.spendings) {
          const deptFolder = DEPARTMENT_MAP[sp.department].code;
          const folder = `documents/spendings/${deptFolder}/${sp.requestCode}_${slugifyFilename(sp.title)}`;
          for (const att of sp.attachments) {
            if (att.kind === "invoice" || att.kind === "fee_proof" || att.kind === "document") {
              await appendAttachment(folder, `${att.kind}_${att.originalName}`, att.storageKey);
            }
          }
        }
      }

      if (includeProvSpendings) {
        for (const ord of snapshot.provisionalSpendings) {
          const deptFolder = DEPARTMENT_MAP[ord.department].code;
          const folder = `documents/provisional_spendings/${deptFolder}/${ord.requestCode}_${slugifyFilename(ord.title)}`;
          for (const att of ord.attachments) {
            if (att.kind === "fee_proof" || att.kind === "document") {
              await appendAttachment(folder, `${att.kind}_${att.originalName}`, att.storageKey);
            }
          }
        }
      }

      for (const entry of snapshot.entries) {
        if (entry.status === "cancelled") continue;
        if (entry.status === "confirmed" && !includeEntries) continue;
        if (entry.status === "provisional" && !includeProvEntries) continue;
        const catFolder = slugifyFilename(ENTRY_CATEGORY_MAP[entry.category].label);
        const root = entry.status === "confirmed" ? "entries" : "provisional_entries";
        const folder = `documents/${root}/${catFolder}/${entry.entryCode}_${slugifyFilename(entry.title)}`;
        for (const att of entry.attachments) {
          await appendAttachment(folder, `${att.kind}_${att.originalName}`, att.storageKey);
        }
      }

      await archive.finalize();
    })().catch(reject);
  });
}

export async function generateBudgetExport(params: ExportRequestParams): Promise<{
  filename: string;
  mimeType: string;
  buffer: Buffer;
}> {
  const snapshot = await getSeasonBudgetSnapshot({
    seasonId: params.seasonId,
    periodUnit: params.ratePeriod,
    fromDate: params.fromDate || undefined,
    toDate: params.toDate || undefined
  });

  const validOrder = BUDGET_SECTIONS.map(s => s.id).filter(id => params.sections.includes(id));
  const selectedSections = validOrder.length > 0 ? validOrder : (["summary"] as BudgetSectionId[]);
  const locale = normalizeLocale(params.locale ?? "en");
  const baseSlug = `INSA_Racing_Budget_${slugifyFilename(snapshot.season.yearCode)}_${new Date().toISOString().slice(0, 10)}`;

  if (params.includeZip) {
    let primaryFiles: Array<{ filename: string; content: Buffer }>;
    if (params.format === "xlsx") {
      primaryFiles = [
        {
          filename: `${baseSlug}.xlsx`,
          content: await generateXlsxBuffer(snapshot, selectedSections, locale)
        }
      ];
    } else if (params.format === "pdf") {
      primaryFiles = [
        {
          filename: `${baseSlug}.pdf`,
          content: await generatePdfBuffer(snapshot, selectedSections, locale)
        }
      ];
    } else {
      primaryFiles = generateCsvFiles(snapshot, selectedSections, params.csvDelimiter, locale);
    }

    const zipBuffer = await createStructuredZipBuffer({
      snapshot,
      sections: selectedSections,
      primaryFiles
    });

    return {
      filename: `${baseSlug}_bundle.zip`,
      mimeType: "application/zip",
      buffer: zipBuffer
    };
  }

  if (params.format === "xlsx") {
    return {
      filename: `${baseSlug}.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: await generateXlsxBuffer(snapshot, selectedSections, locale)
    };
  }

  if (params.format === "pdf") {
    return {
      filename: `${baseSlug}.pdf`,
      mimeType: "application/pdf",
      buffer: await generatePdfBuffer(snapshot, selectedSections, locale)
    };
  }

  return {
    filename: `${baseSlug}.csv`,
    mimeType: "text/csv; charset=utf-8",
    buffer: generateSingleCsvBuffer(snapshot, selectedSections, params.csvDelimiter, locale)
  };
}
