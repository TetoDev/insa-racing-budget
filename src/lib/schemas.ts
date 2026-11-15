import { z } from "zod";
import { ASSIGNABLE_ROLES, BUDGET_SECTIONS, DEPARTMENTS, ENTRY_CATEGORIES, RATE_PERIODS } from "./constants";

const departmentIds = DEPARTMENTS.map(d => d.id) as [string, ...string[]];
const entryCategoryIds = ENTRY_CATEGORIES.map(c => c.id) as [string, ...string[]];
const budgetSectionIds = BUDGET_SECTIONS.map(s => s.id) as [string, ...string[]];

export const loginSchema = z.object({
  email: z.string().trim().email("Valid email is required").toLowerCase(),
  password: z.string().min(1, "Password is required")
});

export const inviteUserSchema = z.object({
  email: z.string().trim().email("Valid email is required").toLowerCase(),
  role: z.enum(ASSIGNABLE_ROLES),
  title: z.string().trim().max(80).optional()
});

export const acceptInviteSchema = z.object({
  token: z.string().min(16, "Invalid invitation token"),
  fullName: z.string().trim().min(2, "Full name is required").max(80),
  title: z.string().trim().min(2, "Team title is required").max(80),
  password: z.string().min(8, "Password must be at least 8 characters").max(128)
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email("Valid email is required").toLowerCase()
});

export const resetPasswordSchema = z.object({
  token: z.string().min(16, "Invalid reset token"),
  password: z.string().min(8, "Password must be at least 8 characters").max(128)
});

export const createSeasonSchema = z.object({
  name: z.string().trim().min(2, "Season name is required").max(80),
  yearCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{2,4}$/, "Year code must be 2-4 alphanumeric characters (e.g. 26)"),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Valid start date required"),
  deadlineDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Valid deadline date required"),
  openingBalanceEur: z.string().trim().default("0")
});

export const optionInputSchema = z.object({
  label: z.string().trim().min(1, "Option title/supplier is required").max(120),
  productUrl: z
    .string()
    .trim()
    .max(500)
    .optional()
    .refine(val => !val || /^https?:\/\//i.test(val), "Product URL must start with http:// or https://"),
  priceEur: z.string().trim().min(1, "Price in EUR is required"),
  drawbacks: z.string().trim().min(1, "Drawbacks description is required").max(1500),
  notes: z.string().trim().max(1000).optional()
});

export const carSystemSchema = z
  .string()
  .trim()
  .min(2, "Car system / part is required")
  .max(120, "Car system / part must be at most 120 characters");

export const createRequestPayloadSchema = z.object({
  title: z.string().trim().min(3, "Request title is required").max(140),
  department: z.enum(departmentIds as [typeof DEPARTMENTS[number]["id"], ...typeof DEPARTMENTS[number]["id"][]]),
  carSystem: carSystemSchema,
  explanation: z.string().trim().min(5, "Explanation is required").max(5000),
  options: z.array(optionInputSchema).min(1, "At least one buying option is required").max(12)
});

export const editRequestPayloadSchema = z.object({
  title: z.string().trim().min(3, "Title is required").max(140),
  carSystem: carSystemSchema,
  explanation: z.string().trim().min(5, "Explanation is required").max(5000),
  options: z.array(optionInputSchema).min(1, "At least one option is required").max(12),
  removeAttachmentIds: z.array(z.string().uuid()).default([])
});

export const reviewCommentSchema = z.object({
  comment: z.string().trim().min(1, "Comment is required").max(3000)
});

export const exportConfigSchema = z.object({
  seasonId: z.string().uuid(),
  format: z.enum(["xlsx", "csv", "pdf"]),
  includeZip: z.boolean().default(false),
  csvDelimiter: z.enum([",", ";"]).default(";"),
  sections: z.array(z.enum(budgetSectionIds as [typeof BUDGET_SECTIONS[number]["id"], ...typeof BUDGET_SECTIONS[number]["id"][]])).min(1),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  ratePeriod: z.enum(RATE_PERIODS).default("month")
});

export const entryCategorySchema = z.enum(
  entryCategoryIds as [typeof ENTRY_CATEGORIES[number]["id"], ...typeof ENTRY_CATEGORIES[number]["id"][]]
);

export const editProvisionalEntrySchema = z.object({
  title: z.string().trim().min(2, "Title is required").max(140),
  category: entryCategorySchema,
  amountEur: z.string().trim().min(1, "Amount in EUR is required"),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Valid date (YYYY-MM-DD) is required"),
  comment: z.string().trim().min(1, "Comment is required").max(3000),
  removeAttachmentIds: z.array(z.string().uuid()).default([])
});

export const updateDepartmentBudgetsSchema = z.object({
  seasonId: z.string().uuid(),
  allocations: z
    .array(
      z.object({
        department: z.enum(
          departmentIds as [typeof DEPARTMENTS[number]["id"], ...typeof DEPARTMENTS[number]["id"][]]
        ),
        allocatedEur: z.string().trim().default("0")
      })
    )
    .min(1)
    .max(DEPARTMENTS.length)
});
