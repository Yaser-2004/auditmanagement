# Google Sheets ingestion

## Configure the Google Form and response sheet

1. Keep the `Evaluator` name and `Auditor Role` questions. Evaluator email is optional for the current workflow and may be retained when present, but it is not required to assign a cycle or stage.
2. `Auditor Role` must identify each submission as `Trainer` or `QA`.
3. Do not add a stage selector for the current workflow. Stage is inferred independently for each counsellor from their valid submission sequence: T1 → Q1 → Q2 → T2 → Q3 → Q4.
4. Keep `Audit ID` unique and stable for each form submission. `Call ID` is not the source submission key and may repeat.
5. Keep the existing parameter outcomes and/or the `Raw Response (JSON)` column. The source payload, remarks, feedback, defect codes, dispute status, revised score and other columns are retained with the submission.

The provided workbook has two header rows; the importer selects the compact parameter header row when present. It also supports a single Google Forms header row. The actual workbook sample has no Audit Stage field or evaluator email. Missing evaluator email does not block processing; the counsellor email identifies the counsellor, and `Auditor Role` advances the per-counsellor stage sequence. A counsellor still needs a Trainer T1 to start a cycle.

## Connect the Google account that already has sheet access

The app uses Google OAuth as the authorized user; no service account or sharing with a robot email is needed. The Google account you connect must already have at least Viewer access to the response sheet. For this setup that account is `yaser.siddiquee@gmail.com`.

1. In Google Cloud Console, create/select a project and enable the Google Sheets API.
2. Configure the Google Auth consent screen. If the app is in Testing mode, add `yaser.siddiquee@gmail.com` as a test user.
3. Create an OAuth Client ID for a **Web application**.
4. Add this exact Authorized redirect URI for local development: `http://localhost:3000/api/integrations/google-sheets/oauth/callback`.
5. Copy the OAuth client ID and secret into `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` in `.env`.
6. Run `npm run db:migrate`, then `npm run db:generate` and `npm run dev`.
7. As Admin, open **Google Sheets → Connect Google account**, sign in as `yaser.siddiquee@gmail.com`, and approve read-only Sheets access.

Google's guides: [create OAuth credentials](https://developers.google.com/workspace/guides/create-credentials), [web server OAuth flow](https://developers.google.com/identity/protocols/oauth2/web-server).

Set these environment variables in `.env` locally and as server-side secrets when deployed:

```dotenv
GOOGLE_SHEETS_SPREADSHEET_ID="your-spreadsheet-id"
GOOGLE_SHEETS_RANGE="'Form Responses 1'!A:ZZ"
GOOGLE_OAUTH_CLIENT_ID="your-oauth-client-id"
GOOGLE_OAUTH_CLIENT_SECRET="your-oauth-client-secret"
GOOGLE_OAUTH_REDIRECT_URI="http://localhost:3000/api/integrations/google-sheets/oauth/callback"
GOOGLE_EXPECTED_ACCOUNT_EMAIL="yaser.siddiquee@gmail.com"
GOOGLE_STAGE_DETECTION_MODE="SEQUENCE"
GOOGLE_SYNC_CRON_SECRET="at-least-32-random-characters"
GOOGLE_SYNC_RECONCILE_MINUTES="60"
GOOGLE_SYNC_MAX_RETRIES="3"
```

The app encrypts the OAuth refresh token with a key derived from `AUTH_SECRET` before storing it in the database. Keep `AUTH_SECRET` stable after connecting; changing it requires reconnecting Google. Do not put the refresh token in frontend code or commit OAuth client secrets. For local OAuth testing, add `yaser.siddiquee@gmail.com` as a test user on the OAuth consent screen. Google expires authorizations for test users after seven days when the app requests Sheets access, so reconnect weekly during Testing; ongoing production use requires the appropriate Google OAuth publishing/verification setup. See [Google's testing-mode behavior](https://support.google.com/cloud/answer/15549945?hl=en). `GOOGLE_STAGE_DETECTION_MODE` supports `SEQUENCE` (current default) and `EXPLICIT` (for a future sheet that includes an Audit Stage column). `GOOGLE_SYNC_CRON_SECRET` is used only by a scheduled caller; the Admin button uses the signed-in Admin session.

## Run and schedule synchronization

- Restart `npm run dev` after changing `.env`.
- Sign in as Admin and open **Google Sheets**. Use **Sync now** for a manual or initial historical sync.
- The backend exposes a protected `GET /api/integrations/google-sheets/sync` endpoint for deployment schedulers and retains the Admin-only manual `POST` used by **Sync now**. The scheduled request must send `Authorization: Bearer <GOOGLE_SYNC_CRON_SECRET>`; use at least 32 random characters and keep it only in server-side deployment secrets. The scheduled trigger is not active during local development. Once a production platform is selected, configure its scheduler to call this URL every minute.
- Run `npm run db:migrate` after installing the update. The migration creates a durable sheet cursor and lease record. Normal runs read only rows after the cursor. The same unique Audit ID is still checked before persistence, so retries cannot create a duplicate audit. Each hour (configurable with `GOOGLE_SYNC_RECONCILE_MINUTES`) the sync scans the full configured range to recover missed rows or detect changed historical source data. Unsupported range syntax safely falls back to full scans.
- Google API transient errors are retried up to `GOOGLE_SYNC_MAX_RETRIES` times (default 3, maximum 5). Failed and interrupted `RECEIVED` rows are retried during later runs; ambiguous or invalid rows remain in Admin review. A database lease prevents overlapping syncs, and per-counsellor transaction locks continue to protect sequence assignment. Run history and row-level issues are retained in SyncRun/SyncError.
- Same Audit ID and same payload is counted as an ignored duplicate. A changed payload with an existing Audit ID is saved as a revision and sent to Admin review.

## Sequence, review and cycle rules

- A valid submission requires Audit ID, audit timestamp, counsellor name and email, evaluator name, a recognized role, and parameter outcomes. Evaluator email is optional.
- Evaluator email is optional. If present it is retained with the source, but cycle identity is determined by Counsellor Email and stage compatibility by source `Auditor Role`.
- A counsellor is matched by email; a profile is created only after identity and evaluator validation. A name mismatch on an existing email is held for review.
- The first valid Trainer submission with no open cycle becomes T1 and creates Cycle 1 for that counsellor. Other counsellors are processed independently.
- For an open cycle, a Trainer/QA role mismatch, invalid order, same source timestamp ambiguity, or a duplicate checkpoint under explicit-stage mode is preserved as `NEEDS_REVIEW` and excluded from calculations.
- Exactly one accepted audit is expected at each stage. A completed Q4 closes the cycle. The next valid Trainer submission starts that counsellor’s next cycle. An incomplete cycle does not roll over based on elapsed time.
- Without an explicit stage column, two distinct QA submissions in succession can be sequenced as Q1 then Q2, but the system cannot prove that the second was not an extra Q1. The configured one-submission-per-stage business rule is therefore a required assumption.
- `OVERDUE` is not calculated until maximum due times for each stage are defined; until then missing stages remain `PENDING`.

## Existing records and corrections

Legacy Excel import rows and shared manual cycles remain stored for historical access. New manual Excel imports and manual cycle creation are disabled. Source corrections retain the previous source payload revision and require Admin review; the source Audit ID remains associated with its existing counsellor cycle and stage. The application's existing scoring and cumulative adoption services recalculate from accepted audit records; spreadsheet `Adoption %` and `Score (Decimal)` remain preserved source fields and do not replace those calculations.
