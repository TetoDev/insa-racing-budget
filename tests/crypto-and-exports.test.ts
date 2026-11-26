import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { computeBudgetAnalytics } from "~/lib/budget-analytics";

let tempUploadDir = "";

vi.mock("~/server/budget", () => {
  const analytics = computeBudgetAnalytics({
    openingBalanceCents: 100_000,
    periodUnit: "month",
    requests: [
      {
        id: "req-1",
        requestCode: "26-AERO-004",
        title: "Rear Wing Carbon Skins",
        department: "aero",
        status: "spending",
        selectedOptionPriceCents: 120_000,
        shippingCents: 4_000,
        importFeeCents: 0,
        finalAmountCents: 124_000,
        createdAt: "2026-02-01T10:00:00.000Z",
        orderedAt: "2026-02-03T10:00:00.000Z",
        invoicedAt: "2026-02-10T10:00:00.000Z"
      },
      {
        id: "req-2",
        requestCode: "26-ELEC-002",
        title: "CAN Transceiver Kit",
        department: "electronics",
        status: "order",
        selectedOptionPriceCents: 25_000,
        shippingCents: 1_500,
        importFeeCents: 500,
        finalAmountCents: null,
        createdAt: "2026-02-12T10:00:00.000Z",
        orderedAt: "2026-02-14T10:00:00.000Z",
        invoicedAt: null
      }
    ],
    entries: [
      {
        id: "ent-1",
        entryCode: "26-ENT-001",
        title: "Regional Partnership",
        category: "partnership",
        status: "confirmed",
        initialAmountCents: 250_000,
        confirmedAmountCents: 250_000,
        entryDate: "2026-02-01",
        confirmedAt: "2026-02-05T09:00:00.000Z"
      },
      {
        id: "ent-2",
        entryCode: "26-ENT-002",
        title: "FSDIE Grant Allocation",
        category: "fsdie",
        status: "provisional",
        initialAmountCents: 80_000,
        confirmedAmountCents: null,
        entryDate: "2026-02-18",
        confirmedAt: null
      }
    ]
  });

  return {
    getSeasonBudgetSnapshot: vi.fn(async () => ({
      season: {
        id: "season-2026",
        name: "Season 2025-2026",
        yearCode: "26",
        startDate: "2025-09-01",
        deadlineDate: "2026-08-31",
        openingBalanceCents: 100_000,
        status: "active"
      },
      analytics,
      spendings: [
        {
          id: "req-1",
          requestCode: "26-AERO-004",
          department: "aero",
          carSystem: "Aerodynamics / Rear Wing",
          title: "Rear Wing Carbon Skins",
          creatorName: "Claire Aero",
          chosenOptionLabel: "EasyComposites 2x2 Twill",
          basePriceCents: 120_000,
          shippingCents: 4_000,
          importFeeCents: 0,
          finalAmountCents: 124_000,
          effectiveDate: "2026-02-10T10:00:00.000Z",
          invoicedByName: "Marc Treasurer",
          attachments: [
            {
              id: "att-1",
              kind: "invoice",
              originalName: "facture_aero.pdf",
              storageKey: "2026-02/facture_aero.pdf"
            }
          ]
        }
      ],
      provisionalSpendings: [
        {
          id: "req-2",
          requestCode: "26-ELEC-002",
          department: "electronics",
          carSystem: "Electronics / Telemetry & Sensors",
          title: "CAN Transceiver Kit",
          creatorName: "Luc Elec",
          chosenOptionLabel: "Mouser Batch",
          basePriceCents: 25_000,
          shippingCents: 1_500,
          importFeeCents: 500,
          provisionalTotalCents: 27_000,
          orderedAt: "2026-02-14T10:00:00.000Z",
          orderedByName: "Marc Treasurer",
          attachments: [
            {
              id: "att-2",
              kind: "document",
              originalName: "quote_mouser.pdf",
              storageKey: "2026-02/quote_mouser.pdf"
            }
          ]
        }
      ],
      entries: [
        {
          id: "ent-1",
          entryCode: "26-ENT-001",
          title: "Regional Partnership",
          category: "partnership",
          status: "confirmed",
          initialAmountCents: 250_000,
          confirmedAmountCents: 250_000,
          effectiveAmountCents: 250_000,
          entryDate: "2026-02-01",
          effectiveDate: "2026-02-05T09:00:00.000Z",
          comment: "Convention signed",
          creatorName: "Marc Treasurer",
          confirmedByName: "Marc Treasurer",
          confirmedAt: "2026-02-05T09:00:00.000Z",
          attachments: [
            {
              id: "att-3",
              kind: "invoice",
              originalName: "partner_invoice.pdf",
              storageKey: "2026-02/partner_invoice.pdf"
            }
          ]
        },
        {
          id: "ent-2",
          entryCode: "26-ENT-002",
          title: "FSDIE Grant Allocation",
          category: "fsdie",
          status: "provisional",
          initialAmountCents: 80_000,
          confirmedAmountCents: null,
          effectiveAmountCents: 80_000,
          entryDate: "2026-02-18",
          effectiveDate: "2026-02-18",
          comment: "Awaiting commission sign-off",
          creatorName: "Marc Treasurer",
          confirmedByName: null,
          confirmedAt: null,
          attachments: [
            {
              id: "att-4",
              kind: "document",
              originalName: "fsdie_dossier.pdf",
              storageKey: "2026-02/fsdie_dossier.pdf"
            }
          ]
        }
      ]
    }))
  };
});

import {
  generateToken,
  hashPassword,
  hashToken,
  verifyPassword,
  verifyPlaintextConstantTime
} from "~/server/crypto";
import { generateBudgetExport } from "~/server/exports";
import { resolveSafeUploadPath, saveUploadedFile } from "~/server/storage";

/** Reads central directory filenames from a ZIP buffer without extra npm deps. */
function listZipEntries(zipBuf: Buffer): string[] {
  const names: string[] = [];
  let offset = 0;
  while (offset + 46 <= zipBuf.length) {
    const idx = zipBuf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), offset);
    if (idx === -1 || idx + 46 > zipBuf.length) break;
    const nameLen = zipBuf.readUInt16LE(idx + 28);
    const extraLen = zipBuf.readUInt16LE(idx + 30);
    const commentLen = zipBuf.readUInt16LE(idx + 32);
    names.push(zipBuf.subarray(idx + 46, idx + 46 + nameLen).toString("utf8"));
    offset = idx + 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

describe("crypto, upload validation, and budget export builders", () => {
  beforeAll(async () => {
    tempUploadDir = await fs.mkdtemp(path.join(os.tmpdir(), "insa-achats-test-"));
    process.env.UPLOAD_DIR = tempUploadDir;

    const sub = path.join(tempUploadDir, "2026-02");
    await fs.mkdir(sub, { recursive: true });
    await fs.writeFile(path.join(sub, "facture_aero.pdf"), "%PDF-1.4\n%aero-invoice");
    await fs.writeFile(path.join(sub, "quote_mouser.pdf"), "%PDF-1.4\n%mouser-quote");
    await fs.writeFile(path.join(sub, "partner_invoice.pdf"), "%PDF-1.4\n%partner");
    await fs.writeFile(path.join(sub, "fsdie_dossier.pdf"), "%PDF-1.4\n%fsdie");
  });

  afterAll(async () => {
    delete process.env.UPLOAD_DIR;
    if (tempUploadDir) {
      await fs.rm(tempUploadDir, { recursive: true, force: true });
    }
  });

  it("hashes and verifies passwords and tokens securely", async () => {
    const hashed = await hashPassword("FormulaStudent2026!");
    expect(hashed.startsWith("scrypt:")).toBe(true);
    expect(await verifyPassword("FormulaStudent2026!", hashed)).toBe(true);
    expect(await verifyPassword("WrongPassword", hashed)).toBe(false);
    expect(await verifyPassword("x", "malformed")).toBe(false);

    expect(verifyPlaintextConstantTime("master-secret", "master-secret")).toBe(true);
    expect(verifyPlaintextConstantTime("master-secret", "other-secret")).toBe(false);

    const tok = generateToken();
    expect(tok.raw.length).toBeGreaterThan(20);
    expect(hashToken(tok.raw)).toBe(tok.hash);
  });

  it("enforces magic bytes and blocks dangerous extensions and path traversal", async () => {
    const validPng = new File(
      [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])],
      "wing.png",
      { type: "image/png" }
    );
    const saved = await saveUploadedFile({ file: validPng, mode: "image_only" });
    expect(saved.mimeType).toBe("image/png");
    expect(saved.sizeBytes).toBe(9);

    const disguisedPng = new File(["<script>alert(1)</script>"], "evil.png", {
      type: "image/png"
    });
    await expect(saveUploadedFile({ file: disguisedPng, mode: "image_only" })).rejects.toThrow();

    const blockedSvg = new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" });
    await expect(saveUploadedFile({ file: blockedSvg, mode: "document" })).rejects.toThrow();

    expect(() => resolveSafeUploadPath("../../etc/passwd", tempUploadDir)).toThrow();
  });

  it("generates selectable .xlsx, .csv, .pdf, and structured document .zip bundles", async () => {
    const xlsxRes = await generateBudgetExport({
      seasonId: "season-2026",
      format: "xlsx",
      includeZip: false,
      csvDelimiter: ";",
      sections: ["summary", "financial_statement", "all_spendings", "entries_by_category"],
      ratePeriod: "month",
      locale: "fr"
    });
    expect(xlsxRes.filename).toMatch(/^INSA_Racing_Budget_26_FR_.*\.xlsx$/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Uint8Array.from(xlsxRes.buffer).buffer);
    const sheetNames = wb.worksheets.map(s => s.name);
    expect(sheetNames).toContain("Tableau de bord & Synthèse");
    expect(sheetNames).toContain("Bilan Charges & Produits");
    expect(sheetNames).toContain("Dépenses facturées");
    expect(sheetNames).toContain("Entrées par catégorie");

    // Verify EN worksheet names preserve compatibility & Totals + Glossary rows are present
    const enXlsxRes = await generateBudgetExport({
      seasonId: "season-2026",
      format: "xlsx",
      includeZip: false,
      csvDelimiter: ";",
      sections: ["summary", "financial_statement", "all_spendings", "entries_by_category"],
      ratePeriod: "month",
      locale: "en"
    });
    expect(enXlsxRes.filename).toMatch(/^INSA_Racing_Budget_26_EN_.*\.xlsx$/);
    const enWb = new ExcelJS.Workbook();
    await enWb.xlsx.load(Uint8Array.from(enXlsxRes.buffer).buffer);
    const enSheetNames = enWb.worksheets.map(s => s.name);
    expect(enSheetNames).toContain("Dashboard & Summary");
    expect(enSheetNames).toContain("Charges & Income");
    expect(enSheetNames).toContain("All Spendings (Final Invoiced)");
    expect(enSheetNames).toContain("Entries by Category");
    expect(enSheetNames).not.toContain("Provisional Spendings (Active O");

    // Verify Bilan Charges & Produits sheet matches photo structure & Excel =SUM formulas
    const bilanWs = wb.getWorksheet("Bilan Charges & Produits")!;
    expect(String(bilanWs.getCell("A1").value)).toContain("Budget INSA ROUEN RACING");
    expect(bilanWs.getCell("A2").value).toBe("Charges");
    expect(bilanWs.getCell("D2").value).toBe("Produits");
    const bilanTotalRow = bilanWs.lastRow!;
    const sumCells = [
      bilanWs.getColumn(2).values,
      bilanWs.getColumn(3).values
    ];
    expect(sumCells[0].some(v => v === "Total :")).toBe(true);
    expect(
      sumCells[1].some(
        v => v && typeof v === "object" && "formula" in v && String(v.formula).startsWith("SUM(")
      )
    ).toBe(true);
    expect(bilanTotalRow).toBeDefined();

    const csvRes = await generateBudgetExport({
      seasonId: "season-2026",
      format: "csv",
      includeZip: false,
      csvDelimiter: ";",
      sections: ["financial_statement", "by_department", "all_spendings", "all_entries"],
      ratePeriod: "month"
    });
    const csvText = csvRes.buffer.toString("utf8");
    expect(csvText.charCodeAt(0)).toBe(0xfeff);
    expect(csvText).toContain("Charges Group");
    expect(csvText).toContain("Allocated Budget (EUR)");
    expect(csvText).toContain("Remaining Projected (EUR)");
    expect(csvText).toContain("Utilization Projected (%)");
    expect(csvText).toContain("26-AERO-004");
    expect(csvText).toContain("Aerodynamics / Rear Wing");
    expect(csvText).toContain("26-ENT-001");
    expect(csvText).toContain("TOTAL");

    const frCsvRes = await generateBudgetExport({
      seasonId: "season-2026",
      format: "csv",
      includeZip: false,
      csvDelimiter: ";",
      sections: ["financial_statement", "by_department", "all_spendings"],
      ratePeriod: "month",
      locale: "fr"
    });
    expect(frCsvRes.filename).toMatch(/^INSA_Racing_Budget_26_FR_.*\.csv$/);
    const frCsvText = frCsvRes.buffer.toString("utf8");
    expect(frCsvText).toContain("Catégorie Charges;Poste de dépense;Charges (EUR)");
    expect(frCsvText).toContain("Budget alloué (EUR)");
    expect(frCsvText).toContain("1240,00");
    expect(frCsvText).toContain("1510,00");
    expect(frCsvText).toContain("2500,00");
    expect(frCsvText).toContain("3300,00");
    expect(frCsvText).toContain(";100;1;0;0");

    const pdfRes = await generateBudgetExport({
      seasonId: "season-2026",
      format: "pdf",
      includeZip: false,
      csvDelimiter: ";",
      sections: ["summary", "financial_statement", "by_department", "all_spendings", "cashflow_rates"],
      ratePeriod: "month",
      locale: "fr"
    });
    expect(pdfRes.filename).toMatch(/^INSA_Racing_Budget_26_FR_.*\.pdf$/);
    expect(pdfRes.buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(pdfRes.buffer.length).toBeGreaterThan(2000);

    const zipRes = await generateBudgetExport({
      seasonId: "season-2026",
      format: "xlsx",
      includeZip: true,
      csvDelimiter: ";",
      sections: [
        "all_spendings",
        "provisional_spendings",
        "all_entries",
        "provisional_entries"
      ],
      ratePeriod: "month"
    });
    expect(zipRes.filename).toMatch(/_bundle\.zip$/);
    const zipEntries = listZipEntries(zipRes.buffer);
    expect(zipEntries.some(n => n.endsWith(".xlsx"))).toBe(true);
    expect(zipEntries).toContain(
      "documents/spendings/AERO/26-AERO-004_Rear_Wing_Carbon_Skins/invoice_facture_aero.pdf"
    );
    expect(zipEntries).toContain(
      "documents/provisional_spendings/ELEC/26-ELEC-002_CAN_Transceiver_Kit/document_quote_mouser.pdf"
    );
    expect(zipEntries).toContain(
      "documents/entries/Partnership/26-ENT-001_Regional_Partnership/invoice_partner_invoice.pdf"
    );
    expect(zipEntries).toContain(
      "documents/provisional_entries/FSDIE/26-ENT-002_FSDIE_Grant_Allocation/document_fsdie_dossier.pdf"
    );
  });
});
