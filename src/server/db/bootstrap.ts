import { eq } from "drizzle-orm";
import { getEnv } from "../env";
import { getDb, getSql } from "./index";
import { seasons, users } from "./schema";

let readyPromise: Promise<void> | null = null;

export async function ensureDbReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = runBootstrap().catch(err => {
      readyPromise = null;
      throw err;
    });
  }
  return readyPromise;
}

async function runBootstrap(): Promise<void> {
  const sql = getSql();
  const conn = await sql.reserve();
  // Hold PostgreSQL advisory lock on the same reserved connection during schema bootstrap
  await conn`SELECT pg_advisory_lock(84291042)`;
  try {
    await conn.unsafe(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;

      CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text NOT NULL UNIQUE,
        password_hash text,
        full_name text NOT NULL,
        title text NOT NULL,
        role text NOT NULL,
        status text NOT NULL DEFAULT 'invited',
        avatar_attachment_id uuid,
        is_env_master boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        last_login_at timestamptz
      );

      CREATE TABLE IF NOT EXISTS auth_tokens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash text NOT NULL UNIQUE,
        purpose text NOT NULL,
        expires_at timestamptz NOT NULL,
        consumed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS seasons (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        year_code text NOT NULL UNIQUE,
        start_date text NOT NULL,
        deadline_date text NOT NULL,
        opening_balance_cents integer NOT NULL DEFAULT 0,
        status text NOT NULL DEFAULT 'active',
        created_by_id uuid NOT NULL REFERENCES users(id),
        archived_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS department_counters (
        season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
        department text NOT NULL,
        last_seq integer NOT NULL DEFAULT 0,
        PRIMARY KEY (season_id, department)
      );

      CREATE TABLE IF NOT EXISTS entry_counters (
        season_id uuid PRIMARY KEY REFERENCES seasons(id) ON DELETE CASCADE,
        last_seq integer NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS department_budgets (
        season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
        department text NOT NULL,
        allocated_cents integer NOT NULL DEFAULT 0,
        updated_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (season_id, department)
      );

      CREATE TABLE IF NOT EXISTS purchase_requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        request_code text NOT NULL UNIQUE,
        season_id uuid NOT NULL REFERENCES seasons(id),
        department text NOT NULL,
        car_system text NOT NULL DEFAULT '',
        title text NOT NULL,
        explanation text NOT NULL,
        status text NOT NULL DEFAULT 'pending_review',
        creator_id uuid NOT NULL REFERENCES users(id),
        has_approver_response boolean NOT NULL DEFAULT false,
        selected_option_id uuid,
        selected_option_price_cents integer,
        shipping_cents integer NOT NULL DEFAULT 0,
        import_fee_cents integer NOT NULL DEFAULT 0,
        final_amount_cents integer,
        ordered_by_id uuid REFERENCES users(id),
        ordered_at timestamptz,
        invoiced_by_id uuid REFERENCES users(id),
        invoiced_at timestamptz,
        archived_at timestamptz,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS car_system text NOT NULL DEFAULT '';
      CREATE INDEX IF NOT EXISTS idx_pr_season_status ON purchase_requests(season_id, status);
      CREATE INDEX IF NOT EXISTS idx_pr_season_dept ON purchase_requests(season_id, department);

      CREATE TABLE IF NOT EXISTS buying_options (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        request_id uuid NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
        sort_order integer NOT NULL DEFAULT 0,
        label text NOT NULL,
        product_url text,
        price_cents integer NOT NULL,
        drawbacks text NOT NULL,
        notes text,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS money_entries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        entry_code text NOT NULL UNIQUE,
        season_id uuid NOT NULL REFERENCES seasons(id),
        title text NOT NULL,
        category text NOT NULL,
        status text NOT NULL DEFAULT 'provisional',
        initial_amount_cents integer NOT NULL,
        confirmed_amount_cents integer,
        entry_date text NOT NULL,
        comment text NOT NULL,
        created_by_id uuid NOT NULL REFERENCES users(id),
        confirmed_by_id uuid REFERENCES users(id),
        confirmed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_me_season_status ON money_entries(season_id, status);

      CREATE TABLE IF NOT EXISTS attachments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_type text NOT NULL,
        entity_id uuid NOT NULL,
        kind text NOT NULL,
        original_name text NOT NULL,
        storage_key text NOT NULL UNIQUE,
        mime_type text NOT NULL,
        size_bytes integer NOT NULL,
        uploaded_by_id uuid NOT NULL REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_att_entity ON attachments(entity_type, entity_id);

      CREATE TABLE IF NOT EXISTS request_timeline (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        request_id uuid NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
        actor_id uuid NOT NULL REFERENCES users(id),
        event_type text NOT NULL,
        from_status text,
        to_status text,
        comment text NOT NULL,
        metadata_json jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_rt_request ON request_timeline(request_id, created_at);

      CREATE TABLE IF NOT EXISTS entry_timeline (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        entry_id uuid NOT NULL REFERENCES money_entries(id) ON DELETE CASCADE,
        actor_id uuid NOT NULL REFERENCES users(id),
        event_type text NOT NULL,
        from_status text,
        to_status text,
        comment text NOT NULL,
        metadata_json jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_et_entry ON entry_timeline(entry_id, created_at);

      CREATE TABLE IF NOT EXISTS audit_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        season_id uuid REFERENCES seasons(id) ON DELETE SET NULL,
        actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
        actor_label text NOT NULL,
        action text NOT NULL,
        target_type text NOT NULL,
        target_id text,
        target_code text,
        summary text NOT NULL,
        details_json jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_audit_season_created ON audit_logs(season_id, created_at DESC);
    `);

    const env = getEnv();
    const db = getDb();

    // Sync the environment Master account into users table so foreign keys and profiles work seamlessly
    const existingMaster = await db
      .select()
      .from(users)
      .where(eq(users.isEnvMaster, true))
      .limit(1);

    let masterId: string;
    if (existingMaster.length === 0) {
      const conflictByEmail = await db
        .select()
        .from(users)
        .where(eq(users.email, env.masterEmail))
        .limit(1);

      if (conflictByEmail.length > 0) {
        const [updated] = await db
          .update(users)
          .set({
            role: "master",
            status: "active",
            isEnvMaster: true,
            updatedAt: new Date()
          })
          .where(eq(users.id, conflictByEmail[0].id))
          .returning();
        masterId = updated.id;
      } else {
        const [inserted] = await db
          .insert(users)
          .values({
            email: env.masterEmail,
            fullName: env.masterName,
            title: env.masterTitle,
            role: "master",
            status: "active",
            isEnvMaster: true
          })
          .returning();
        masterId = inserted.id;
      }
    } else {
      masterId = existingMaster[0].id;
      if (existingMaster[0].email !== env.masterEmail) {
        await db
          .update(users)
          .set({
            email: env.masterEmail,
            role: "master",
            status: "active",
            updatedAt: new Date()
          })
          .where(eq(users.id, masterId));
      }
    }

    // Seed an initial season only if none exist yet so first-time login lands on a working workspace
    const existingSeasons = await db.select({ id: seasons.id }).from(seasons).limit(1);
    if (existingSeasons.length === 0) {
      const now = new Date();
      const yy = String(now.getUTCFullYear()).slice(-2);
      const start = `${now.getUTCFullYear()}-09-01`;
      const deadline = `${now.getUTCFullYear() + 1}-08-31`;
      await db.insert(seasons).values({
        name: `Formula Student ${now.getUTCFullYear()}-${now.getUTCFullYear() + 1}`,
        yearCode: yy,
        startDate: start,
        deadlineDate: deadline,
        openingBalanceCents: 0,
        status: "active",
        createdById: masterId
      });
    }
  } finally {
    try {
      await conn`SELECT pg_advisory_unlock(84291042)`;
    } finally {
      conn.release();
    }
  }
}
