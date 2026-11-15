import { PassThrough } from "node:stream";
import archiver from "archiver";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import {
  BUDGET_SECTIONS,
  DEPARTMENT_MAP,
  ENTRY_CATEGORY_MAP,
  ENTRY_STATUS_LABELS,
  type BudgetSectionId,
  type RatePeriod
} from "~/lib/constants";
import {
  formatCentsPlain,
  formatDate,
  formatEur,
  slugifyFilename
} from "~/lib/format";
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
  snapshot: BudgetSnapshot
): { title: string; headers: string[]; rows: Array<Array<string | number>>; eurCols?: number[] } {
  const { season, analytics, spendings, provisionalSpendings, entries } = snapshot;

  switch (sectionId) {
    case "summary":
      return {
        title: "Dashboard & Summary",
        headers: ["Metric", "Value (EUR)", "Count / Notes"],
        eurCols: [2],
        rows: [
          ["Season Name", season.name, `${season.startDate} -> ${season.deadlineDate}`],
          ["Opening Balance", formatCentsPlain(analytics.openingBalanceCents), season.status],
          ["Confirmed Money Entries", formatCentsPlain(analytics.confirmedEntriesCents), `${analytics.counts.confirmedEntries} confirmed`],
          ["Provisional Money Entries", formatCentsPlain(analytics.provisionalEntriesCents), `${analytics.counts.provisionalEntries} provisional`],
          ["Final Spendings (Invoiced)", formatCentsPlain(analytics.finalSpendingsCents), `${analytics.counts.finalSpendings} invoiced`],
          ["Provisional Spendings (Orders)", formatCentsPlain(analytics.provisionalSpendingsCents), `${analytics.counts.activeOrders} active orders`],
          ["Actual Cash Left", formatCentsPlain(analytics.actualCashLeftCents), "Opening + Confirmed Entries - Final Spendings"],
          ["Projected Balance", formatCentsPlain(analytics.projectedBalanceCents), "Includes Provisional Entries & Orders"],
          ["Open Requests (Review / Counter / Stage 2)", "", `${analytics.counts.pendingReview + analytics.counts.counterProposed + analytics.counts.optionSelection} pending`]
        ]
      };

    case "by_department":
      return {
        title: "Spendings by Department",
        headers: [
          "Code",
          "Department",
          "Allocated Budget (EUR)",
          "Final Spendings (EUR)",
          "Provisional Spendings (EUR)",
          "Projected Total (EUR)",
          "Remaining Projected (EUR)",
          "Utilization Projected (%)",
          "Share Final (%)",
          "Invoiced Count",
          "Active Orders",
          "Open Requests"
        ],
        eurCols: [3, 4, 5, 6, 7],
        rows: analytics.byDepartment.map(d => [
          d.code,
          d.label,
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
        title: `Spendings by Timeframe (${analytics.rates.periodUnit})`,
        headers: [
          "Period",
          "Final Spendings (EUR)",
          "Provisional Spendings (EUR)",
          "Confirmed Entries (EUR)",
          "Provisional Entries (EUR)",
          "Net Actual (EUR)"
        ],
        eurCols: [2, 3, 4, 5, 6],
        rows: analytics.timeSeries.map(t => [
          t.label,
          formatCentsPlain(t.finalSpendingsCents),
          formatCentsPlain(t.provisionalSpendingsCents),
          formatCentsPlain(t.confirmedEntriesCents),
          formatCentsPlain(t.provisionalEntriesCents),
          formatCentsPlain(t.netActualCents)
        ])
      };

    case "all_spendings":
      return {
        title: "All Spendings (Final Invoiced)",
        headers: [
          "Request ID",
          "Department",
          "Car System / Part",
          "Title",
          "Chosen Option",
          "Base Option (EUR)",
          "Shipping (EUR)",
          "Import Fees (EUR)",
          "Final Invoiced (EUR)",
          "Invoice Date",
          "Requestor",
          "Invoiced By",
          "Invoice Files"
        ],
        eurCols: [6, 7, 8, 9],
        rows: spendings.map(s => [
          s.requestCode,
          DEPARTMENT_MAP[s.department].label,
          s.carSystem || "—",
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
        title: "Provisional Spendings (Active Orders)",
        headers: [
          "Request ID",
          "Department",
          "Car System / Part",
          "Title",
          "Chosen Option",
          "Base Option (EUR)",
          "Shipping (EUR)",
          "Import Fees (EUR)",
          "Provisional Total (EUR)",
          "Ordered Date",
          "Requestor",
          "Ordered By"
        ],
        eurCols: [6, 7, 8, 9],
        rows: provisionalSpendings.map(o => [
          o.requestCode,
          DEPARTMENT_MAP[o.department].label,
          o.carSystem || "—",
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
        title: "Provisional Entries",
        headers: [
          "Entry ID",
          "Category",
          "Title",
          "Expected Amount (EUR)",
          "Entry Date",
          "Logged By",
          "Comment"
        ],
        eurCols: [4],
        rows: entries
          .filter(e => e.status === "provisional")
          .map(e => [
            e.entryCode,
            ENTRY_CATEGORY_MAP[e.category].label,
            e.title,
            formatCentsPlain(e.initialAmountCents),
            e.entryDate,
            e.creatorName,
            e.comment.replace(/\s+/g, " ").trim()
          ])
      };

    case "all_entries":
      return {
        title: "All Money Entries",
        headers: [
          "Entry ID",
          "Status",
          "Category",
          "Title",
          "Initial Amount (EUR)",
          "Final Amount (EUR)",
          "Entry Date",
          "Confirmed Date",
          "Logged By",
          "Confirmed By",
          "Comment"
        ],
        eurCols: [5, 6],
        rows: entries.map(e => [
          e.entryCode,
          ENTRY_STATUS_LABELS[e.status],
          ENTRY_CATEGORY_MAP[e.category].label,
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
        title: "Entries by Category",
        headers: [
          "Category",
          "Confirmed Entries (EUR)",
          "Provisional Entries (EUR)",
          "Projected Total (EUR)",
          "Share Confirmed (%)",
          "Confirmed Count",
          "Provisional Count"
        ],
        eurCols: [2, 3, 4],
        rows: analytics.byCategory.map(c => [
          c.label,
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
        title: `Money Left & Cashflow Rates (${analytics.rates.periodUnit})`,
        headers: [
          "Period",
          "Confirmed Inflow (EUR)",
          "Final Outflow (EUR)",
          "Net Actual Flow (EUR)",
          "Cumulative Actual Balance (EUR)",
          "Cumulative Projected Balance (EUR)"
        ],
        eurCols: [2, 3, 4, 5, 6],
        rows: [
          [
            `SUMMARY (${analytics.rates.periodCount} ${analytics.rates.periodUnit}s)`,
            formatCentsPlain(analytics.rates.actualInputPerPeriodCents) + "/p",
            formatCentsPlain(analytics.rates.actualOutputPerPeriodCents) + "/p",
            formatCentsPlain(analytics.rates.actualNetPerPeriodCents) + "/p",
            formatCentsPlain(analytics.actualCashLeftCents),
            formatCentsPlain(analytics.projectedBalanceCents)
          ],
          ...analytics.timeSeries.map(t => [
            t.label,
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
  sections: BudgetSectionId[]
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "INSA Racing Achats";
  wb.created = new Date();

  for (const sectionId of sections) {
    const data = getSectionTabularData(sectionId, snapshot);
    const sheetName = data.title
      .replace(/[\\/*?:[\]]/g, "")
      .slice(0, 31);
    const ws = wb.addWorksheet(sheetName);

    ws.addRow([`INSA Racing — ${snapshot.season.name} (${snapshot.season.yearCode})`]);
    ws.addRow([data.title, `Generated: ${new Date().toISOString().slice(0, 10)}`]);
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
  delimiter: string
): Array<{ filename: string; content: Buffer }> {
  const BOM = "\uFEFF";
  return sections.map(sectionId => {
    const data = getSectionTabularData(sectionId, snapshot);
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
  delimiter: string
): Buffer {
  const BOM = "\uFEFF";
  const blocks = sections.map(sectionId => {
    const data = getSectionTabularData(sectionId, snapshot);
    return `${data.title}\r\n` + buildCsvLines(data.headers, data.rows, delimiter);
  });
  return Buffer.from(BOM + blocks.join("\r\n\r\n"), "utf8");
}

function generatePdfBuffer(
  snapshot: BudgetSnapshot,
  sections: BudgetSectionId[]
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36 });
    const chunks: Buffer[] = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const { season, analytics } = snapshot;

    doc.fontSize(18).font("Helvetica-Bold").fillColor("#0f172a").text("INSA Racing — Budget Declaration Report");
    doc
      .fontSize(10)
      .font("Helvetica")
      .fillColor("#475569")
      .text(
        `Season: ${season.name} (${season.startDate} to ${season.deadlineDate})   |   Generated: ${formatDate(new Date())}   |   Currency: EUR (TTC)`
      );
    doc.moveDown(0.8);

    // Compact executive KPI strip
    doc
      .fontSize(10)
      .font("Helvetica-Bold")
      .fillColor("#0f172a")
      .text(
        `Actual Cash Left: ${formatEur(analytics.actualCashLeftCents)}   |   Projected Balance: ${formatEur(analytics.projectedBalanceCents)}   |   Final Spendings: ${formatEur(analytics.finalSpendingsCents)}   |   Provisional Spendings: ${formatEur(analytics.provisionalSpendingsCents)}`
      );
    doc.moveDown(1);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    for (let sIdx = 0; sIdx < sections.length; sIdx++) {
      const sectionId = sections[sIdx];
      const data = getSectionTabularData(sectionId, snapshot);

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
        drawRow(["No records in this section.", ...new Array(Math.max(0, colCount - 1)).fill("")], false, false);
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
  const baseSlug = `INSA_Racing_Budget_${slugifyFilename(snapshot.season.yearCode)}_${new Date().toISOString().slice(0, 10)}`;

  if (params.includeZip) {
    let primaryFiles: Array<{ filename: string; content: Buffer }>;
    if (params.format === "xlsx") {
      primaryFiles = [
        {
          filename: `${baseSlug}.xlsx`,
          content: await generateXlsxBuffer(snapshot, selectedSections)
        }
      ];
    } else if (params.format === "pdf") {
      primaryFiles = [
        {
          filename: `${baseSlug}.pdf`,
          content: await generatePdfBuffer(snapshot, selectedSections)
        }
      ];
    } else {
      primaryFiles = generateCsvFiles(snapshot, selectedSections, params.csvDelimiter);
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
      buffer: await generateXlsxBuffer(snapshot, selectedSections)
    };
  }

  if (params.format === "pdf") {
    return {
      filename: `${baseSlug}.pdf`,
      mimeType: "application/pdf",
      buffer: await generatePdfBuffer(snapshot, selectedSections)
    };
  }

  return {
    filename: `${baseSlug}.csv`,
    mimeType: "text/csv; charset=utf-8",
    buffer: generateSingleCsvBuffer(snapshot, selectedSections, params.csvDelimiter)
  };
}
