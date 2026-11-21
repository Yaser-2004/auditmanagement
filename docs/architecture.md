# Learningshala: architecture and open requirements

## Existing repository inspection

The provided workspace had no application files, dependencies, database schema, or Git history. Node.js and npm are present; no Docker or PostgreSQL command-line client was found. The project is therefore a new implementation. PostgreSQL can be started using the included Docker Compose definition where Docker is available.

## Application structure

`src/app` contains App Router pages and server endpoints. `src/components` contains reusable interface elements. `src/domain` contains pure score, adoption, timeline, and metric calculations. `src/excel` parses workbooks and maps source columns. `src/server` owns protected access checks and persistence. `prisma` holds the PostgreSQL schema and versioned migrations. `tests` covers core business behavior. `docs` records assumptions and operating instructions.

## Data model

Users have a configurable role. Counsellors belong optionally to teams. Audit cycles group T1/Q1/Q2/T2/Q3/Q4 records. Each audit retains call and lead details, its original imported row, source hash, audit date, auditor, and parameter responses. Parameter definitions are seeded from the supplied master. Imports have row-level results and errors and are idempotent per user/file hash. Adoption results and performance metrics store the rule version and calculation status. SLA findings preserve schedule, submission and delay facts. Audit configuration records are versioned and separately marked confirmed. Audit logs record sensitive operations.

The Prisma schema is the initial schema definition; the migration directory will be generated using `prisma migrate dev` against a configured PostgreSQL database. The current environment does not include a running database.

## Business questions that remain open

1. How are Pass, Partial, Fail and N/A scored, including whether N/A changes the denominator?
2. Do Partial and N/A count as defects? When does an absent defect count as rectified?
3. What defines A1, A2, A3 and A4 for week averages and Delta?
4. Does a one-day SLA mean a calendar-day boundary or 24 elapsed hours? What are the allowed schedule and submission timestamps?
5. If a counsellor has multiple audits for the same stage and cycle, which record participates in adoption calculations?
6. Which proposed roles will be enabled, and what scope limits counsellor/team access?
7. Which source spreadsheet fields and aliases are authoritative, especially counselor identity, status and score?

Until confirmed, calculations return a configuration-required status where the unresolved rule affects their result. No sample production statistics are included.

## Implementation and operations

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env`, set a strong database password and `DATABASE_URL`, then start PostgreSQL with `docker compose up -d db`.
3. Run `npx prisma migrate dev --name init`, then `npm run db:seed`.
4. Configure the admin bootstrap account, run `npm run dev`, and deploy behind HTTPS with a managed PostgreSQL database and backup/retention policy.

The initial phase sequence is foundation and schema; flexible Excel preview/import and row-level history; scoring/adoption/SLA/metrics services; database-backed dashboards and exports; then security, responsive and workflow verification.
