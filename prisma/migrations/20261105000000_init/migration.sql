-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RoleName" AS ENUM ('ADMIN', 'TRAINER', 'QUALITY_AUDITOR', 'MANAGER');

-- CreateEnum
CREATE TYPE "Stage" AS ENUM ('T1', 'Q1', 'Q2', 'T2', 'Q3', 'Q4');

-- CreateEnum
CREATE TYPE "EvalStatus" AS ENUM ('PASS', 'PARTIAL', 'FAIL', 'NA');

-- CreateEnum
CREATE TYPE "AdoptionStatus" AS ENUM ('CALCULATED', 'NEEDS_CONFIGURATION');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "RoleName" NOT NULL DEFAULT 'MANAGER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "head" TEXT,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Counsellor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "manager" TEXT,
    "teamId" TEXT,

    CONSTRAINT "Counsellor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditCycle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditParameter" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "maxMarks" DECIMAL(6,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AuditParameter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Audit" (
    "id" TEXT NOT NULL,
    "counsellorId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "stage" "Stage" NOT NULL,
    "auditor" TEXT NOT NULL,
    "auditDate" TIMESTAMP(3) NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "callDate" TIMESTAMP(3),
    "callId" TEXT,
    "callLink" TEXT,
    "liveScore" DECIMAL(8,2),
    "totalMarks" DECIMAL(8,2),
    "calculatedScore" DECIMAL(8,2),
    "scorePercent" DECIMAL(8,2),
    "details" JSONB NOT NULL,
    "sourceRow" JSONB NOT NULL,
    "sourceHash" TEXT NOT NULL,

    CONSTRAINT "Audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditResult" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "parameterId" TEXT NOT NULL,
    "status" "EvalStatus" NOT NULL,
    "rawValue" TEXT,
    "calculatedMarks" DECIMAL(8,2),

    CONSTRAINT "AuditResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditImport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stage" "Stage" NOT NULL,
    "cycleId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREVIEWED',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "successRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditImportRow" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "auditId" TEXT,
    "raw" JSONB NOT NULL,
    "errors" JSONB NOT NULL,

    CONSTRAINT "AuditImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditImportError" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "rowNumber" INTEGER,
    "field" TEXT,
    "message" TEXT NOT NULL,

    CONSTRAINT "AuditImportError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdoptionStage" (
    "id" TEXT NOT NULL,
    "counsellorId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" "AdoptionStatus" NOT NULL DEFAULT 'NEEDS_CONFIGURATION',
    "numerator" INTEGER NOT NULL DEFAULT 0,
    "denominator" INTEGER NOT NULL DEFAULT 0,
    "percentage" DECIMAL(8,2),
    "ruleVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdoptionStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdoptionDefect" (
    "id" TEXT NOT NULL,
    "adoptionStageId" TEXT NOT NULL,
    "parameterId" TEXT NOT NULL,
    "classification" TEXT NOT NULL,

    CONSTRAINT "AdoptionDefect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceMetric" (
    "id" TEXT NOT NULL,
    "counsellorId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "definitions" JSONB NOT NULL,
    "avg1" DECIMAL(10,3),
    "avg2" DECIMAL(10,3),
    "delta" DECIMAL(10,3),
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerformanceMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SLAViolation" (
    "id" TEXT NOT NULL,
    "auditId" TEXT,
    "cycleId" TEXT NOT NULL,
    "counsellorId" TEXT,
    "ruleVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "delayHours" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SLAViolation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditConfiguration" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "value" JSONB NOT NULL,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Team_name_key" ON "Team"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Counsellor_email_key" ON "Counsellor"("email");

-- CreateIndex
CREATE INDEX "Counsellor_teamId_name_idx" ON "Counsellor"("teamId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "AuditCycle_name_startsAt_key" ON "AuditCycle"("name", "startsAt");

-- CreateIndex
CREATE INDEX "Audit_cycleId_stage_auditDate_idx" ON "Audit"("cycleId", "stage", "auditDate");

-- CreateIndex
CREATE UNIQUE INDEX "Audit_counsellorId_cycleId_stage_sourceHash_key" ON "Audit"("counsellorId", "cycleId", "stage", "sourceHash");

-- CreateIndex
CREATE INDEX "AuditResult_parameterId_status_idx" ON "AuditResult"("parameterId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AuditResult_auditId_parameterId_key" ON "AuditResult"("auditId", "parameterId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditImport_userId_fileHash_key" ON "AuditImport"("userId", "fileHash");

-- CreateIndex
CREATE UNIQUE INDEX "AuditImportRow_importId_rowNumber_key" ON "AuditImportRow"("importId", "rowNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AdoptionStage_counsellorId_cycleId_stage_key" ON "AdoptionStage"("counsellorId", "cycleId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "AdoptionDefect_adoptionStageId_parameterId_classification_key" ON "AdoptionDefect"("adoptionStageId", "parameterId", "classification");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceMetric_counsellorId_cycleId_key" ON "PerformanceMetric"("counsellorId", "cycleId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditConfiguration_key_version_key" ON "AuditConfiguration"("key", "version");

-- AddForeignKey
ALTER TABLE "Counsellor" ADD CONSTRAINT "Counsellor_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_counsellorId_fkey" FOREIGN KEY ("counsellorId") REFERENCES "Counsellor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "AuditCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditResult" ADD CONSTRAINT "AuditResult_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditResult" ADD CONSTRAINT "AuditResult_parameterId_fkey" FOREIGN KEY ("parameterId") REFERENCES "AuditParameter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditImport" ADD CONSTRAINT "AuditImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditImportRow" ADD CONSTRAINT "AuditImportRow_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditImportRow" ADD CONSTRAINT "AuditImportRow_importId_fkey" FOREIGN KEY ("importId") REFERENCES "AuditImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditImportError" ADD CONSTRAINT "AuditImportError_importId_fkey" FOREIGN KEY ("importId") REFERENCES "AuditImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdoptionDefect" ADD CONSTRAINT "AdoptionDefect_adoptionStageId_fkey" FOREIGN KEY ("adoptionStageId") REFERENCES "AdoptionStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

