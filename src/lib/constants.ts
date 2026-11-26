export const DEPARTMENTS = [
  { id: "powertrain", code: "PT", label: "Powertrain", color: "#ef4444" },
  { id: "chassis", code: "CHAS", label: "Chassis", color: "#f97316" },
  { id: "aero", code: "AERO", label: "Aero", color: "#06b6d4" },
  { id: "suspension", code: "SUSP", label: "Suspension", color: "#8b5cf6" },
  { id: "electronics", code: "ELEC", label: "Electronics", color: "#3b82f6" },
  { id: "ergonomics", code: "ERGO", label: "Ergonomics", color: "#10b981" },
  { id: "team_logistics", code: "LOG", label: "Team Logistics", color: "#eab308" }
] as const;

export type DepartmentId = (typeof DEPARTMENTS)[number]["id"];

export const DEPARTMENT_MAP: Record<
  DepartmentId,
  (typeof DEPARTMENTS)[number]
> = Object.fromEntries(DEPARTMENTS.map(d => [d.id, d])) as Record<
  DepartmentId,
  (typeof DEPARTMENTS)[number]
>;

export const ASSIGNABLE_ROLES = ["viewer", "requestor", "approver"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];
export type UserRole = AssignableRole | "master";

export const ROLE_LABELS: Record<UserRole, string> = {
  viewer: "Viewer",
  requestor: "Requestor",
  approver: "Approver",
  master: "Master"
};

export const USER_STATUSES = ["invited", "active", "suspended"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const REQUEST_STATUSES = [
  "pending_review",
  "counter_proposed",
  "option_selection",
  "order",
  "spending",
  "denied_archived",
  "withdrawn_archived",
  "order_cancelled_archived"
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  pending_review: "Pending Review",
  counter_proposed: "Counter-Proposed",
  option_selection: "Option Selection",
  order: "Order (Provisional)",
  spending: "Spending (Final)",
  denied_archived: "Denied & Archived",
  withdrawn_archived: "Withdrawn & Archived",
  order_cancelled_archived: "Order Cancelled & Archived"
};

export const ENTRY_CATEGORIES = [
  { id: "sponsorship", label: "Sponsorship", color: "#06b6d4" },
  { id: "fsdie", label: "FSDIE", color: "#8b5cf6" },
  { id: "insa", label: "INSA", color: "#ef4444" },
  { id: "donor", label: "Donor", color: "#10b981" },
  { id: "partnership", label: "Partnership", color: "#f59e0b" }
] as const;

export type EntryCategory = (typeof ENTRY_CATEGORIES)[number]["id"];

export const ENTRY_CATEGORY_MAP: Record<
  EntryCategory,
  (typeof ENTRY_CATEGORIES)[number]
> = Object.fromEntries(ENTRY_CATEGORIES.map(c => [c.id, c])) as Record<
  EntryCategory,
  (typeof ENTRY_CATEGORIES)[number]
>;

export const ENTRY_STATUSES = ["provisional", "confirmed", "cancelled"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const ENTRY_STATUS_LABELS: Record<EntryStatus, string> = {
  provisional: "Provisional",
  confirmed: "Confirmed",
  cancelled: "Cancelled"
};

export const BUDGET_SECTIONS = [
  { id: "summary", label: "Dashboard & Summary" },
  { id: "financial_statement", label: "Charges & Income Statement (Bilan)" },
  { id: "by_department", label: "Spendings by Department" },
  { id: "by_timeframe", label: "Spendings by Timeframe" },
  { id: "all_spendings", label: "All Spendings" },
  { id: "provisional_spendings", label: "Provisional Spendings" },
  { id: "provisional_entries", label: "Provisional Entries" },
  { id: "all_entries", label: "All Entries" },
  { id: "entries_by_category", label: "Entries by Category" },
  { id: "cashflow_rates", label: "Total Money Left & Input/Output Rate" }
] as const;

export type BudgetSectionId = (typeof BUDGET_SECTIONS)[number]["id"];

export const RATE_PERIODS = ["day", "week", "month", "quarter"] as const;
export type RatePeriod = (typeof RATE_PERIODS)[number];

export const SEASON_STATUSES = ["active", "archived"] as const;
export type SeasonStatus = (typeof SEASON_STATUSES)[number];

export const CAR_SYSTEM_SUGGESTIONS = [
  "Aerodynamics / Front Wing",
  "Aerodynamics / Rear Wing",
  "Aerodynamics / Undertray & Diffuser",
  "Chassis / Monocoque & Frame",
  "Chassis / Impact Attenuator & Firewall",
  "Powertrain / Engine & Drivetrain",
  "Powertrain / High-Voltage Accumulator",
  "Powertrain / Inverter & Motor",
  "Powertrain / Cooling System",
  "Suspension / Wishbones & Pushrods",
  "Suspension / Dampers, Uprights & Hubs",
  "Suspension / Steering & Brakes",
  "Electronics / Wiring Harness & ECU",
  "Electronics / Telemetry & Sensors",
  "Electronics / Shutdown Circuit & LV",
  "Ergonomics / Seat, Pedal Box & Steering Wheel",
  "Team Logistics / Workshop, Tooling & Safety"
] as const;

export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  title: string;
  role: UserRole;
  status: UserStatus;
  avatarAttachmentId: string | null;
  isEnvMaster: boolean;
}
