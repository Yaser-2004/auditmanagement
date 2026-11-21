# Multi-user six-stage demo

The six workbooks in this folder contain synthetic audit data for Alex Demo (`alex.demo@example.com`). Import them in order to verify role permissions, cycle enrollment, assignment scope, stage timing and cumulative adoption.

## Prepare the app

Stop `npm run dev` with Ctrl+C, then from the Learningshala project folder run:

```powershell
npm run db:migrate
npm run db:generate
npm run dev
```

Sign in using your existing administrator account.

## Set up the demo people and cycle

1. Open **User management** and register Alex Demo with email `alex.demo@example.com`, role **COUNSELLOR**, and any demo employee ID. If the counsellor profile already exists from an earlier demo import, using the same email links the new login to that profile.
2. Save the temporary password shown by the app. Alex must sign in once and choose a new password before the account can access the workspace.
3. Register Trainer One and Trainer Two as **TRAINER**, Auditor One and Auditor Two as **AUDITOR**, and Demo Manager as **MANAGER**. Save each displayed temporary password; each person must set a password on first sign-in.
4. In **Cycle management**, create **Demo Cumulative Test — Oct 2026**, with start date **October 12, 2026** and end date **October 25, 2026**. If you already used that cycle, choose a unique name such as **Demo Cumulative Test — Run 2**. Activate it.
5. In **Cycle assignments**, enroll Alex Demo in that cycle.
6. Assign Trainer One and Trainer Two to Alex Demo with **UPLOAD** access. Assign Auditor One and Auditor Two to Alex Demo with **UPLOAD** access. Assign Demo Manager to Alex Demo with **VIEW** access.

No administrator audit upload is needed. The trainer submits T1 and T2; auditors submit Q1 through Q4. If you created the counsellor profile using the same email as a prior import, no old audit needs to be rolled back to register Alex.

## Upload the six workbooks

For each upload, sign in as the named person, open **Excel Imports**, select the stage and demo cycle, choose the workbook, click **Preview and validate**, then confirm. Each workbook contains one valid audit row.

| Order | User | Stage | Workbook | Audit date |
|---:|---|---|---|---|
| 1 | Trainer One | T1 | `demo-t1.xlsx` | October 12 |
| 2 | Auditor One | Q1 | `demo-q1.xlsx` | October 13 |
| 3 | Auditor One | Q2 | `demo-q2.xlsx` | October 15 |
| 4 | Trainer Two | T2 | `demo-t2.xlsx` | October 19 |
| 5 | Auditor Two | Q3 | `demo-q3.xlsx` | October 20 |
| 6 | Auditor Two | Q4 | `demo-q4.xlsx` | October 22 |

The app requires the previous stage and enforces the minimum wait times: Q1 follows T1 by at least one day, Q2 follows Q1 by at least two days, Q3 follows T2 by at least one day, and Q4 follows Q3 by at least two days. Uploading the stages in the table order meets these rules.

## Expected cumulative checkpoints

Open **Adoption Analysis** as Admin or Manager. For the proposed checkpoint mapping A1→Q1, A2→Q2, A3→Q3 and A4→Q4, the demo should produce:

| Checkpoint | Rectified / unique defects | Adoption |
|---|---:|---:|
| T1 | 0 / 2 | 0% |
| Q1 | 2 / 2 | 100% |
| Q2 | 0 / 2 | 0% |
| T2 | 1 / 3 | 33.3% |
| Q3 | 2 / 3 | 66.7% |
| Q4 | 2 / 3 | 66.7% |

The corresponding A metrics are A1 **100% (2/2)**, A2 **0% (0/2)**, A3 **66.7% (2/3)**, A4 **66.7% (2/3)**, Avg1 **50%**, Avg2 **66.7%**, and Delta **+16.7 percentage points**. The mapping is proposed and remains editable in Settings pending the business owner’s confirmation.

The T1 workbook includes Partial on a non-defect parameter and N/A on another parameter. Partial scores zero like Fail for scoring, and N/A is excluded from applicable marks. Cumulative adoption defects are tracked only on Fail and are rectified only on Pass.

## Permission checks

- Trainers only see T1 and T2 as upload stages; auditors only see Q1, Q2, Q3 and Q4.
- Each staff member sees only their own import history and assigned counsellors.
- The Manager can view assigned dashboards, reports and adoption data; uploads and administration are not available.
- Admin can view all data, manage cycles, accounts, teams, enrollment and assignments. Audit uploads are correction-only; ordinary audit uploads belong to the assigned trainer or auditor.
- To check duplicate protection, have Trainer Two try the already imported T1 workbook. The app must flag the existing audit and leave it unchanged.
