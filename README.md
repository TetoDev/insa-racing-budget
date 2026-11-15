# INSA Racing — Purchase & Budget Platform

Internal purchase request, negotiation, order tracking, spending, money-entry, and season budget platform for the **INSA Racing Formula Student** team. Built with **TypeScript**, **SolidStart v2 (SolidJS)**, **Tailwind CSS v4**, and **PostgreSQL**, containerized for Linux VPS deployment via **Docker Compose**.

---

## Core Features

- **Immutable Reference IDs**: Auto-generated per `(Season, Department)` in `<YY>-<DEPT>-<NNN>` format (e.g. `26-AERO-004`), preserved permanently across Request, Order, and Spending stages.
- **Complete Purchase Lifecycle**:
  - **Stage 1 (Review & Negotiation)**: Requestors submit photos, technical documents, justification, single internal department, and 1..N buying options (EUR TTC + drawbacks). Approvers can deny (archived), approve to Stage 2, or submit a counter-proposition; Requestors can accept, deny, or counter-argue back and forth with full timeline audit logging.
  - **Stage 2 (Strict Option Selection)**: Approvers select strictly from the initial buying options (new request required for option changes) or deny. Confirming an option converts the item to an **Order** in **Provisional Spendings**.
  - **Order -> Spending**: Approvers can log shipping & import fees, cancel active orders, or upload the supplier invoice PDF/photo to confirm the order into **Final Spendings**.
- **Season Budgets & Money Entries (EUR, TTC-included)**:
  - Master manages season budgets (start date, deadline, year code, opening balance); older seasons remain readable in archived mode.
  - Money entry categories: `Sponsorship`, `FSDIE`, `INSA`, `Donor`, `Partnership`. Provisional entries confirm once an invoice document is attached by any approver (or Master).
  - All 9 budget sections: Summary Dashboard, Department Breakdown (7 departments), Timeframe Spendings, All Spendings, Provisional Spendings, Provisional Entries, All Entries, Entries by Category, and Total Money Left (Actual vs Projected) + configurable Input vs Output Rate (Day / Week / Month / Quarter).
- **Invite-Only RBAC & Global Transparency**:
  - Credentials for the **Master** account live in `.env` (full rights + exclusive user invitation/role management & season control).
  - Every team member email must be pre-approved and invited by Master with a role (`viewer`, `requestor`, or `approver`).
  - Password reset and invite emails are sent via OVH Zimbra SMTP (`contact@insa-racing.fr`).
  - Every logged-in user can view all logs, requests, orders, spendings, and entries.
- **Filtered Exports + Structured Document ZIPs**:
  - Restricted to **Approvers** and **Master**.
  - Export selectable budget sections to **Excel (`.xlsx`)**, **CSV (`.csv`)**, or **PDF (`.pdf`)**, optionally bundled into a structured `.zip` containing all invoices and supporting documents organized by department and category.

---

## Tech Stack

- **Frontend / SSR**: SolidStart (`@solidjs/start` ^2), SolidJS, Solid Router, Tailwind CSS v4, Lucide icons
- **Runtime / Server**: Nitro v3, Node.js 24 LTS
- **Database**: PostgreSQL 17 + Drizzle ORM (automatic advisory-locked schema bootstrap + `.env` Master sync on startup)
- **Email & Exports**: Nodemailer (OVH Zimbra SMTP), ExcelJS, PDFKit, Archiver

---

## Quick Start (Linux VPS with Docker Compose)

1. **Generate secrets and configure `.env`**:
   ```bash
   cp .env.example .env
   node scripts/deploy-check.mjs --generate-secrets
   nano .env
   ```
   Fill in:
   - `APP_URL`: Your public HTTPS URL (e.g. `https://achats.insa-racing.fr`)
   - `DOMAIN`: Hostname served by Caddy TLS (when using `--profile proxy`)
   - `SESSION_SECRET`: 64-char random hex secret (from `--generate-secrets` or `openssl rand -hex 32`)
   - `MASTER_EMAIL` & `MASTER_PASSWORD`: Master administrator credentials (optionally store a salted hash generated with `npm run deploy:hash-password -- "YourPassword"`)
   - `POSTGRES_PASSWORD`: Strong alphanumeric/base64url database password (`docker-compose.yml` wires `DATABASE_URL` from `POSTGRES_*` automatically unless overridden)
   - `SMTP_PASS`: Password for `contact@insa-racing.fr` (OVH Zimbra European defaults: `ssl0.ovh.net:465` with `SMTP_SECURE=true`, or `587` STARTTLS with `SMTP_SECURE=false`)

2. **Validate `.env` (and optionally test live OVH SMTP login)**:
   ```bash
   npm run deploy:check
   npm run deploy:check -- --verify-smtp
   ```

3. **Start PostgreSQL and the Application**:
   - **Option A — Bundled Caddy Auto-HTTPS (standalone VPS)**:
     ```bash
     docker compose --profile proxy up -d --build --wait
     ```
   - **Option B — Existing Host Nginx / Traefik (app listens on `127.0.0.1:3000`)**:
     See [deploy/nginx.conf.example](deploy/nginx.conf.example), then run:
     ```bash
     docker compose up -d --build --wait
     ```

4. **Verify Health**:
   ```bash
   curl -fsS http://127.0.0.1:3000/api/health
   ```
   `/api/health` confirms database readiness (advisory-locked schema bootstrap + Master account sync) and writable `/data/uploads` storage. Once healthy, open `APP_URL`, log in as Master, create/verify the active season, and invite team members.

---

## Local Development

```bash
npm install
cp .env.example .env
# Point DATABASE_URL to a local or Docker Postgres instance, then:
npm run dev
```

Useful scripts:
- `npm run typecheck` — Run `tsc --noEmit`
- `npm test` — Run Vitest unit & integration test suite
- `npm run build` — Build production SolidStart/Nitro bundle into `.output`

---

## Local Test Environment (with Mailpit Mail Catcher)

Run a complete isolated local stack (PostgreSQL + Mailpit SMTP catcher + built SolidStart app) with zero manual `.env` editing:

```bash
docker compose -f docker-compose.local.yml up -d --build
```

- **App URL**: `http://localhost:3000`
- **Mailpit Web Inbox (all caught emails)**: `http://localhost:8025`
- **Default Local Master Login**: `master@insa-racing.fr` / `InsaLocal2026!`

Any invite or forgot-password email sent by the app is delivered over SMTP to `mailpit:1025` and appears immediately in Mailpit at `http://localhost:8025` without sending external mail.

To stop or completely reset local test data:
```bash
docker compose -f docker-compose.local.yml down      # Stop containers, keep test DB/uploads
docker compose -f docker-compose.local.yml down -v   # Stop containers and wipe test volumes
```

---

## Backup & Updates (VPS)

Both PostgreSQL data and uploaded receipts/invoices live in Docker named volumes (`pgdata` and `uploads_data`). Run [deploy/backup.sh](deploy/backup.sh) manually or via cron to create timestamped `.sql.gz` + `.tar.gz` archives under `./backups` (auto-detects the Compose volume name and prunes backups older than 30 days):

```bash
chmod +x deploy/backup.sh
./deploy/backup.sh
```

Zero-effort application updates without touching database or upload volumes:

```bash
docker compose up -d --build --wait   # or add --profile proxy
```
