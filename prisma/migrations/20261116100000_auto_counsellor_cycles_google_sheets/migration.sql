-- Add the automatic per-counsellor cycle and Google Sheets source ledger.
-- Existing cycles, audits, imports and derived metrics are retained as legacy history.
ALTER TYPE "CycleStatus" ADD VALUE IF NOT EXISTS 'IN_PROGRESS';

ALTER TABLE "AuditCycle"
  ALTER COLUMN "endsAt" DROP NOT NULL,
  ADD COLUMN "counsellorId" TEXT,
  ADD COLUMN "cycleNumber" INTEGER,
  ADD COLUMN "completedAt" TIMESTAMP(3);
ALTER TABLE "AuditCycle" DROP CONSTRAINT IF EXISTS "AuditCycle_name_startsAt_key";
ALTER TABLE "AuditCycle" ADD CONSTRAINT "AuditCycle_counsellorId_fkey"
  FOREIGN KEY ("counsellorId") REFERENCES "Counsellor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "AuditCycle_counsellorId_cycleNumber_key" ON "AuditCycle"("counsellorId", "cycleNumber");
-- completedAt is the cycle lifecycle guard, independent of enum transition timing.
CREATE UNIQUE INDEX "AuditCycle_one_unfinished_per_counsellor_key"
  ON "AuditCycle"("counsellorId")
  WHERE "counsellorId" IS NOT NULL AND "completedAt" IS NULL;
CREATE INDEX "AuditCycle_counsellorId_status_idx" ON "AuditCycle"("counsellorId", "status");

ALTER TABLE "CycleAssignment" ALTER COLUMN "cycleId" DROP NOT NULL;

ALTER TABLE "Audit"
  ALTER COLUMN "uploadedById" DROP NOT NULL,
  ALTER COLUMN "importId" DROP NOT NULL,
  ADD COLUMN "sourceSubmissionId" TEXT,
  ADD COLUMN "evaluatorEmail" TEXT,
  ADD COLUMN "evaluatorRole" TEXT,
  ADD COLUMN "sourceAuditId" TEXT,
  ADD COLUMN "disputeStatus" TEXT,
  ADD COLUMN "revisedScore" DECIMAL(8,4);
CREATE TYPE "SourceSubmissionStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'NEEDS_REVIEW', 'FAILED', 'IGNORED');
CREATE TYPE "SyncRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

CREATE TABLE "SyncRun" (
  "id" TEXT NOT NULL,
  "status" "SyncRunStatus" NOT NULL DEFAULT 'RUNNING',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "fetchedCount" INTEGER NOT NULL DEFAULT 0,
  "processedCount" INTEGER NOT NULL DEFAULT 0,
  "duplicateCount" INTEGER NOT NULL DEFAULT 0,
  "reviewCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SyncRun_startedAt_idx" ON "SyncRun"("startedAt");
CREATE INDEX "SyncRun_status_startedAt_idx" ON "SyncRun"("status", "startedAt");

CREATE TABLE "SourceSubmission" (
  "id" TEXT NOT NULL,
  "sourceAuditId" TEXT NOT NULL,
  "sourceSpreadsheetId" TEXT NOT NULL,
  "sourceSheetName" TEXT NOT NULL,
  "sourceRowReference" TEXT,
  "payload" JSONB NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "sourceStageText" TEXT,
  "detectedStage" "Stage",
  "sourceRoleText" TEXT,
  "normalizedRole" TEXT,
  "evaluatorName" TEXT,
  "evaluatorEmail" TEXT,
  "counsellorEmail" TEXT,
  "counsellorName" TEXT,
  "auditDate" TIMESTAMP(3),
  "status" "SourceSubmissionStatus" NOT NULL DEFAULT 'RECEIVED',
  "errorMessage" TEXT,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "revision" INTEGER NOT NULL DEFAULT 0,
  "resolvedStage" "Stage",
  "resolvedRole" TEXT,
  "resolvedCounsellorId" TEXT,
  "resolutionReason" TEXT,
  "reviewedById" TEXT,
  "resolvedEvaluatorUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "cycleId" TEXT,
  "counsellorId" TEXT,
  "lastSyncRunId" TEXT,
  CONSTRAINT "SourceSubmission_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SourceSubmission_resolvedCounsellorId_fkey" FOREIGN KEY ("resolvedCounsellorId") REFERENCES "Counsellor"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "SourceSubmission_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "SourceSubmission_resolvedEvaluatorUserId_fkey" FOREIGN KEY ("resolvedEvaluatorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "SourceSubmission_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "AuditCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "SourceSubmission_counsellorId_fkey" FOREIGN KEY ("counsellorId") REFERENCES "Counsellor"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "SourceSubmission_lastSyncRunId_fkey" FOREIGN KEY ("lastSyncRunId") REFERENCES "SyncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SourceSubmission_sourceAuditId_key" ON "SourceSubmission"("sourceAuditId");
CREATE INDEX "SourceSubmission_status_fetchedAt_idx" ON "SourceSubmission"("status", "fetchedAt");
CREATE INDEX "SourceSubmission_counsellorId_cycleId_idx" ON "SourceSubmission"("counsellorId", "cycleId");
CREATE INDEX "SourceSubmission_lastSyncRunId_idx" ON "SourceSubmission"("lastSyncRunId");
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_sourceSubmissionId_fkey"
  FOREIGN KEY ("sourceSubmissionId") REFERENCES "SourceSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SourceSubmissionRevision" (
  "id" TEXT NOT NULL,
  "sourceSubmissionId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "payload" JSONB NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SourceSubmissionRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SourceSubmissionRevision_sourceSubmissionId_fkey" FOREIGN KEY ("sourceSubmissionId") REFERENCES "SourceSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SourceSubmissionRevision_submission_revision_key" ON "SourceSubmissionRevision"("sourceSubmissionId", "revision");

CREATE TABLE "SyncError" (
  "id" TEXT NOT NULL,
  "syncRunId" TEXT NOT NULL,
  "sourceSubmissionId" TEXT,
  "sourceRowReference" TEXT,
  "message" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SyncError_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SyncError_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "SyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SyncError_sourceSubmissionId_fkey" FOREIGN KEY ("sourceSubmissionId") REFERENCES "SourceSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "SyncError_syncRunId_createdAt_idx" ON "SyncError"("syncRunId", "createdAt");

CREATE UNIQUE INDEX "Audit_sourceSubmissionId_key" ON "Audit"("sourceSubmissionId");
