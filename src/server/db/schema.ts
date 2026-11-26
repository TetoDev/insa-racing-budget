import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid
} from "drizzle-orm/pg-core";
import type {
  DepartmentId,
  EntryCategory,
  EntryStatus,
  RequestStatus,
  SeasonStatus,
  UserRole,
  UserStatus
} from "~/lib/constants";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  fullName: text("full_name").notNull(),
  title: text("title").notNull(),
  role: text("role").$type<UserRole>().notNull(),
  status: text("status").$type<UserStatus>().notNull().default("invited"),
  avatarAttachmentId: uuid("avatar_attachment_id"),
  isEnvMaster: boolean("is_env_master").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true })
});

export const authTokens = pgTable("auth_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  purpose: text("purpose").$type<"invite" | "password_reset">().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const seasons = pgTable("seasons", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  yearCode: text("year_code").notNull().unique(),
  startDate: text("start_date").notNull(),
  deadlineDate: text("deadline_date").notNull(),
  openingBalanceCents: integer("opening_balance_cents").notNull().default(0),
  status: text("status").$type<SeasonStatus>().notNull().default("active"),
  createdById: uuid("created_by_id")
    .notNull()
    .references(() => users.id),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const departmentCounters = pgTable(
  "department_counters",
  {
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    department: text("department").$type<DepartmentId>().notNull(),
    lastSeq: integer("last_seq").notNull().default(0)
  },
  t => [primaryKey({ columns: [t.seasonId, t.department] })]
);

export const entryCounters = pgTable("entry_counters", {
  seasonId: uuid("season_id")
    .primaryKey()
    .references(() => seasons.id, { onDelete: "cascade" }),
  lastSeq: integer("last_seq").notNull().default(0)
});

export const departmentBudgets = pgTable(
  "department_budgets",
  {
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    department: text("department").$type<DepartmentId>().notNull(),
    allocatedCents: integer("allocated_cents").notNull().default(0),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  t => [primaryKey({ columns: [t.seasonId, t.department] })]
);

export const purchaseRequests = pgTable("purchase_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestCode: text("request_code").notNull().unique(),
  seasonId: uuid("season_id")
    .notNull()
    .references(() => seasons.id),
  department: text("department").$type<DepartmentId>().notNull(),
  carSystem: text("car_system").notNull().default(""),
  quantity: integer("quantity").notNull().default(1),
  title: text("title").notNull(),
  explanation: text("explanation").notNull(),
  status: text("status").$type<RequestStatus>().notNull().default("pending_review"),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => users.id),
  hasApproverResponse: boolean("has_approver_response").notNull().default(false),
  selectedOptionId: uuid("selected_option_id"),
  selectedOptionPriceCents: integer("selected_option_price_cents"),
  shippingCents: integer("shipping_cents").notNull().default(0),
  importFeeCents: integer("import_fee_cents").notNull().default(0),
  finalAmountCents: integer("final_amount_cents"),
  orderedById: uuid("ordered_by_id").references(() => users.id),
  orderedAt: timestamp("ordered_at", { withTimezone: true }),
  invoicedById: uuid("invoiced_by_id").references(() => users.id),
  invoicedAt: timestamp("invoiced_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const buyingOptions = pgTable("buying_options", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id")
    .notNull()
    .references(() => purchaseRequests.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
  label: text("label").notNull(),
  productUrl: text("product_url"),
  unitPriceCents: integer("unit_price_cents").notNull().default(0),
  priceCents: integer("price_cents").notNull(),
  drawbacks: text("drawbacks").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const moneyEntries = pgTable("money_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  entryCode: text("entry_code").notNull().unique(),
  seasonId: uuid("season_id")
    .notNull()
    .references(() => seasons.id),
  title: text("title").notNull(),
  category: text("category").$type<EntryCategory>().notNull(),
  status: text("status").$type<EntryStatus>().notNull().default("provisional"),
  initialAmountCents: integer("initial_amount_cents").notNull(),
  confirmedAmountCents: integer("confirmed_amount_cents"),
  entryDate: text("entry_date").notNull(),
  comment: text("comment").notNull(),
  createdById: uuid("created_by_id")
    .notNull()
    .references(() => users.id),
  confirmedById: uuid("confirmed_by_id").references(() => users.id),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const attachments = pgTable("attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityType: text("entity_type").$type<"request" | "entry" | "avatar">().notNull(),
  entityId: uuid("entity_id").notNull(),
  kind: text("kind")
    .$type<"photo" | "document" | "invoice" | "fee_proof" | "supporting_doc" | "avatar">()
    .notNull(),
  originalName: text("original_name").notNull(),
  storageKey: text("storage_key").notNull().unique(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  uploadedById: uuid("uploaded_by_id")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const requestTimeline = pgTable("request_timeline", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id")
    .notNull()
    .references(() => purchaseRequests.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => users.id),
  eventType: text("event_type").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  comment: text("comment").notNull(),
  metadataJson: jsonb("metadata_json").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const entryTimeline = pgTable("entry_timeline", {
  id: uuid("id").primaryKey().defaultRandom(),
  entryId: uuid("entry_id")
    .notNull()
    .references(() => moneyEntries.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => users.id),
  eventType: text("event_type").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  comment: text("comment").notNull(),
  metadataJson: jsonb("metadata_json").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  seasonId: uuid("season_id").references(() => seasons.id, { onDelete: "set null" }),
  actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
  actorLabel: text("actor_label").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id"),
  targetCode: text("target_code"),
  summary: text("summary").notNull(),
  detailsJson: jsonb("details_json").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});
