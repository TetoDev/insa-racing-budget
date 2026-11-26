import { describe, expect, it } from "vitest";
import {
  buildFinancialStatement,
  classifyChargeBucket,
  classifyIncomeGroup,
  normalizeIncomeSourceLabel
} from "~/lib/financial-statement";

describe("financial statement (Charges & Produits) builder", () => {
  it("classifies departments and team_logistics items into Administratives, Financières, and Techniques", () => {
    expect(classifyChargeBucket({ department: "powertrain", title: "Emrax 228" })).toBe("powertrain");
    expect(classifyChargeBucket({ department: "chassis", title: "Tube Steel 25CrMo4" })).toBe("structure");
    expect(classifyChargeBucket({ department: "ergonomics", title: "OMP Racing Seat" })).toBe("structure");
    expect(classifyChargeBucket({ department: "suspension", title: "Öhlins Dampers" })).toBe("suspensions");
    expect(classifyChargeBucket({ department: "electronics", title: "BMS Master" })).toBe("mecatronique");
    expect(classifyChargeBucket({ department: "aero", title: "Prepreg Carbon" })).toBe("carrosserie");

    expect(
      classifyChargeBucket({
        department: "team_logistics",
        carSystem: "Workshop & Fabrication Tools",
        title: "GYS PROTIG Welder"
      })
    ).toBe("outillage");
    expect(
      classifyChargeBucket({
        department: "team_logistics",
        carSystem: "3D Printing & Filament",
        title: "Polymaker Fiberon"
      })
    ).toBe("outillage");
    expect(
      classifyChargeBucket({
        department: "team_logistics",
        carSystem: "Team Logistics / Events & Communication",
        title: "VistaPrint — Autocollants INSA Racing"
      })
    ).toBe("communication");
    expect(
      classifyChargeBucket({
        department: "team_logistics",
        carSystem: "Team Logistics / Workshop, Tooling & Safety",
        title: "IKEA Tourville — Workshop Trash Bin"
      })
    ).toBe("local");
    expect(
      classifyChargeBucket({
        department: "team_logistics",
        carSystem: "Team Logistics / Banking & Administrative Fees",
        title: "Banque — Monthly Bank Fee"
      })
    ).toBe("secretariat");
    expect(
      classifyChargeBucket({
        department: "team_logistics",
        carSystem: "Team Logistics / Banking & Administrative Fees",
        title: "Remboursement prêt association"
      })
    ).toBe("dettes");
  });

  it("groups funding entries into Aides obtenues, Concours, Mécénat / Sponsoring, and Rentrée d'argent propre", () => {
    expect(
      classifyIncomeGroup({
        category: "fsdie",
        title: "CROUS — Subvention Projets Étudiants 2024"
      })
    ).toBe("aides");
    expect(
      classifyIncomeGroup({
        category: "partnership",
        title: "Concours Créactifs — Virement Tranche 2"
      })
    ).toBe("concours");
    expect(
      classifyIncomeGroup({
        category: "insa",
        title: "Fondation INSA — Levée des Fonds (Prévisionnel Bilan Financier)"
      })
    ).toBe("sponsoring");
    expect(
      classifyIncomeGroup({
        category: "sponsorship",
        title: "Red Bull — Mécénat / Sponsoring"
      })
    ).toBe("sponsoring");
    expect(
      classifyIncomeGroup({
        category: "donor",
        title: "Apport Pulls Association — Collecte Nov 2024"
      })
    ).toBe("propre");

    expect(normalizeIncomeSourceLabel("CROUS — Subvention Projets Étudiants 2023")).toBe("CROUS");
    expect(normalizeIncomeSourceLabel("Apport Pulls Association — Collecte Nov 2024")).toBe("Apport Pulls");
    expect(normalizeIncomeSourceLabel("Red Bull — Mécénat / Sponsoring (Prévisionnel Bilan Financier)")).toBe(
      "Red Bull"
    );
  });

  it("reconciles totals across all Charges & Produits rows, aligns left/right row counts, and supports confirmed-only mode", () => {
    const stmt = buildFinancialStatement({
      seasonName: "Season 2021-2025",
      startDate: "2021-12-01",
      deadlineDate: "2025-12-31",
      openingBalanceCents: 10_000,
      spendings: [
        { department: "powertrain", title: "Emrax", finalAmountCents: 2_264_421 },
        { department: "chassis", title: "Tubes", finalAmountCents: 300_000 },
        { department: "ergonomics", title: "Pedals", finalAmountCents: 105_603 },
        { department: "aero", title: "Wing", finalAmountCents: 478_609 },
        { department: "team_logistics", carSystem: "IT & Hosting", title: "OVH", finalAmountCents: 50_000 }
      ],
      provisionalSpendings: [
        {
          department: "team_logistics",
          carSystem: "Workshop & Fabrication Tools",
          title: "TIG",
          provisionalTotalCents: 54_274
        }
      ],
      entries: [
        { category: "insa", status: "confirmed", title: "BDE INSA Rouen", effectiveAmountCents: 510_000 },
        { category: "fsdie", status: "confirmed", title: "FSDIE INSA — Mai", effectiveAmountCents: 1_640_000 },
        { category: "fsdie", status: "confirmed", title: "CROUS — 2023", effectiveAmountCents: 207_720 },
        { category: "fsdie", status: "confirmed", title: "CROUS — 2024", effectiveAmountCents: 207_720 },
        { category: "partnership", status: "confirmed", title: "Concours Créactifs 2022", effectiveAmountCents: 750_000 },
        { category: "sponsorship", status: "provisional", title: "Red Bull — Mécénat / Sponsoring", effectiveAmountCents: 200_000 },
        { category: "sponsorship", status: "provisional", title: "Matmut — Mécénat / Sponsoring", effectiveAmountCents: 550_000 },
        { category: "donor", status: "confirmed", title: "Cotisations", effectiveAmountCents: 32_000 },
        { category: "donor", status: "confirmed", title: "Apport Pulls — Nov", effectiveAmountCents: 42_000 },
        { category: "donor", status: "provisional", title: "Apport Pulls — Écart", effectiveAmountCents: 18_300 },
        { category: "donor", status: "cancelled", title: "Cancelled Entry", effectiveAmountCents: 999_999 }
      ],
      locale: "fr"
    });

    expect(stmt.leftRows.length).toBe(stmt.rightRows.length);
    expect(stmt.pairedRows.length).toBe(stmt.leftRows.length);
    expect(stmt.bannerTitle).toContain("Budget INSA ROUEN RACING");

    const sumLeft = stmt.leftRows.reduce((s, r) => s + r.totalCents, 0);
    const sumRight = stmt.rightRows.reduce((s, r) => s + r.totalCents, 0);
    expect(sumLeft).toBe(stmt.totalChargesCents);
    expect(sumRight).toBe(stmt.totalProduitsCents);
    expect(stmt.totalChargesCents).toBe(3_252_907);
    expect(stmt.totalProduitsCents).toBe(4_157_740);

    // Highlighted Mécénat / Sponsoring entries (Red Bull, Matmut)
    const sponsorRows = stmt.rightRows.filter(r => r.groupId === "sponsoring");
    expect(sponsorRows.every(r => r.highlight === true)).toBe(true);
    expect(sponsorRows.map(r => r.label)).toEqual(["Red Bull", "Matmut"]);

    // Coalesced multi-entry sources
    const crous = stmt.rightRows.find(r => r.label === "CROUS");
    expect(crous?.totalCents).toBe(415_440);
    const pulls = stmt.rightRows.find(r => r.label === "Apport Pulls");
    expect(pulls?.totalCents).toBe(60_300);

    // Confirmed-only mode excludes provisional orders and provisional inflows
    const confirmedOnly = buildFinancialStatement({
      seasonName: "Season 2021-2025",
      startDate: "2021-12-01",
      deadlineDate: "2025-12-31",
      openingBalanceCents: 10_000,
      spendings: [{ department: "powertrain", title: "Emrax", finalAmountCents: 200_000 }],
      provisionalSpendings: [{ department: "aero", title: "Wing", provisionalTotalCents: 50_000 }],
      entries: [
        { category: "fsdie", status: "confirmed", title: "FSDIE INSA", effectiveAmountCents: 300_000 },
        { category: "sponsorship", status: "provisional", title: "Matmut", effectiveAmountCents: 550_000 }
      ],
      locale: "en",
      confirmedOnly: true
    });
    expect(confirmedOnly.totalChargesCents).toBe(200_000);
    expect(confirmedOnly.totalProduitsCents).toBe(300_000);
    expect(confirmedOnly.actualCashBalanceCents).toBe(110_000);
  });
});
