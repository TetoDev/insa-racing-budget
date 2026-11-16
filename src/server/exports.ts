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

function getSectionTabularData(
  sectionId: BudgetSectionId,
  snapshot: BudgetSnapshot,
  locale: Locale = "en"
): { title: string; headers: string[]; rows: Array<Array<string | number>>; eurCols?: number[] } {
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
    case "summary":
      return {
        title: exp.summary.title,
        headers: [...exp.summary.headers],
        eurCols: [2],
        rows: [
          [exp.summary.rowSeasonName, season.name, `${season.startDate} -> ${season.deadlineDate}`],
          [
            exp.summary.rowOpeningBalance,
            formatCentsPlain(analytics.openingBalanceCents),
            locale === "en" ? season.status : getSeasonStatusLabel(locale, season.status)
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
            "",
            exp.summary.rowPendingCount(
              analytics.counts.pendingReview +
                analytics.counts.counterProposed +
                analytics.counts.optionSelection
            )
          ]
        ]
      };

    case "by_department":
      return {
        title: exp.byDepartment.title,
        headers: [...exp.byDepartment.headers],
        eurCols: [3, 4, 5, 6, 7],
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
        headers: [...exp.byTimeframe.headers],
        eurCols: [2, 3, 4, 5, 6],
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
        headers: [...exp.allSpendings.headers],
        eurCols: [6, 7, 8, 9],
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
        headers: [...exp.provisionalSpendings.headers],
        eurCols: [6, 7, 8, 9],
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
        headers: [...exp.provisionalEntries.headers],
        eurCols: [4],
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
        headers: [...exp.allEntries.headers],
        eurCols: [5, 6],
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
        headers: [...exp.entriesByCategory.headers],
        eurCols: [2, 3, 4],
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
        headers: [...exp.cashflowRates.headers],
        eurCols: [2, 3, 4, 5, 6],
        rows: [
          [
            exp.cashflowRates.summaryRowLabel(analytics.rates.periodCount, periodUnitLabel),
            formatCentsPlain(analytics.rates.actualInputPerPeriodCents) + exp.cashflowRates.perPeriodSuffix,
            formatCentsPlain(analytics.rates.actualOutputPerPeriodCents) + exp.cashflowRates.perPeriodSuffix,
            formatCentsPlain(analytics.rates.actualNetPerPeriodCents) + exp.cashflowRates.perPeriodSuffix,
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

async function generateXlsxBuffer(
  snapshot: BudgetSnapshot,
  sections: BudgetSectionId[],
  locale: Locale = "en"
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const exp = getDictionary(locale).exportReport;
  wb.creator = "INSA Racing Achats";
  wb.created = new Date();

  for (const sectionId of sections) {
    const data = getSectionTabularData(sectionId, snapshot, locale);
    const sheetName = data.title
      .replace(/[\\/*?:[\]]/g, "")
      .slice(0, 31);
    const ws = wb.addWorksheet(sheetName);

    ws.addRow([`INSA Racing — ${snapshot.season.name} (${snapshot.season.yearCode})`]);
    ws.addRow([data.title, exp.xlsxGenerated(formatDate(new Date(), locale))]);
    ws.addRow([]);

    ws.getRow(1).font = { bold: true, size: 13 };
    ws.getRow(2).font = { italic: true, size: 10, color: { argb: "FF475569" } };

    const headerRow = ws.addRow(data.headers);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF0F172A" }
    };

    for (const r of data.rows) {
      const converted = r.map((cell, idx) => {
        if (
          data.eurCols?.includes(idx + 1) &&
          typeof cell === "string" &&
          /^-?\d+\.\d{2}$/.test(cell)
        ) {
          return Number(cell);
        }
        return cell;
      });
      const added = ws.addRow(converted);
      if (data.eurCols) {
        for (const colIdx of data.eurCols) {
          const c = added.getCell(colIdx);
          if (typeof c.value === "number") {
            c.numFmt = '#,##0.00 "€"';
          }
        }
      }
    }

    ws.views = [{ state: "frozen", ySplit: 4 }];
    ws.columns.forEach(col => {
      let maxLen = 12;
      col.eachCell?.({ includeEmpty: false }, cell => {
        const len = String(cell.value ?? "").length;
        if (len > maxLen) maxLen = len;
      });
      col.width = Math.min(48, maxLen + 4);
    });
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
  return sections.map(sectionId => {
    const data = getSectionTabularData(sectionId, snapshot, locale);
    const csv = BOM + buildCsvLines(data.headers, data.rows, delimiter);
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
  const blocks = sections.map(sectionId => {
    const data = getSectionTabularData(sectionId, snapshot, locale);
    return `${data.title}\r\n` + buildCsvLines(data.headers, data.rows, delimiter);
  });
  return Buffer.from(BOM + blocks.join("\r\n\r\n"), "utf8");
}

function generatePdfBuffer(
  snapshot: BudgetSnapshot,
  sections: BudgetSectionId[],
  locale: Locale = "en"
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36 });
    const chunks: Buffer[] = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const { season, analytics } = snapshot;
    const exp = getDictionary(locale).exportReport;

    doc.fontSize(18).font("Helvetica-Bold").fillColor("#0f172a").text(exp.pdfTitle);
    doc
      .fontSize(10)
      .font("Helvetica")
      .fillColor("#475569")
      .text(
        exp.pdfMeta(season.name, season.startDate, season.deadlineDate, formatDate(new Date(), locale))
      );
    doc.moveDown(0.8);

    // Compact executive KPI strip
    doc
      .fontSize(10)
      .font("Helvetica-Bold")
      .fillColor("#0f172a")
      .text(
        exp.pdfKpis(
          formatEur(analytics.actualCashLeftCents, locale),
          formatEur(analytics.projectedBalanceCents, locale),
          formatEur(analytics.finalSpendingsCents, locale),
          formatEur(analytics.provisionalSpendingsCents, locale)
        )
      );
    doc.moveDown(1);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    for (let sIdx = 0; sIdx < sections.length; sIdx++) {
      const sectionId = sections[sIdx];
      const data = getSectionTabularData(sectionId, snapshot, locale);

      if (doc.y > doc.page.height - 130) {
        doc.addPage();
      }

      doc.fontSize(13).font("Helvetica-Bold").fillColor("#dc2626").text(data.title);
      doc.moveDown(0.35);

      const colCount = data.headers.length;
      const colWidth = pageWidth / colCount;
      const rowHeight = 18;

      const drawRow = (cells: Array<string | number>, isHeader: boolean, zebra: boolean) => {
        if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
        }
        const y = doc.y;
        const x0 = doc.page.margins.left;

        if (isHeader) {
          doc.rect(x0, y, pageWidth, rowHeight).fill("#0f172a");
          doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(7.5);
        } else {
          if (zebra) {
            doc.rect(x0, y, pageWidth, rowHeight).fill("#f8fafc");
          }
          doc.fillColor("#0f172a").font("Helvetica").fontSize(7.5);
        }

        for (let i = 0; i < colCount; i++) {
          const text = String(cells[i] ?? "—");
          doc.text(text, x0 + i * colWidth + 4, y + 5, {
            width: colWidth - 8,
            height: rowHeight - 4,
            ellipsis: true,
            lineBreak: false
          });
        }
        doc.y = y + rowHeight;
      };

      drawRow(data.headers, true, false);
      if (data.rows.length === 0) {
        drawRow([exp.pdfEmptySection, ...new Array(Math.max(0, colCount - 1)).fill("")], false, false);
      } else {
        data.rows.forEach((row, idx) => drawRow(row, false, idx % 2 === 1));
      }

      doc.moveDown(1);
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
    sectionSet.has("cashflow_rates");

  const includeProvSpendings =
    sectionSet.has("provisional_spendings") ||
    sectionSet.has("by_department") ||
    sectionSet.has("summary") ||
    sectionSet.has("cashflow_rates");

  const includeEntries =
    sectionSet.has("all_entries") ||
    sectionSet.has("entries_by_category") ||
    sectionSet.has("summary") ||
    sectionSet.has("cashflow_rates");

  const includeProvEntries =
    sectionSet.has("provisional_entries") ||
    sectionSet.has("entries_by_category") ||
    sectionSet.has("summary") ||
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
