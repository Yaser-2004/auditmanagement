ALTER TYPE "RoleName" RENAME VALUE 'QUALITY_AUDITOR' TO 'AUDITOR';
DO $$ BEGIN CREATE TYPE "CycleStatus" AS ENUM ('DRAFT','ACTIVE','COMPLETED','CLOSED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "CycleAccess" AS ENUM ('VIEW','UPLOAD'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "AuditCycle" ADD COLUMN "status" "CycleStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "AuditCycle" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
ALTER TABLE "AuditCycle" ADD COLUMN "createdById" TEXT;
ALTER TABLE "Audit" ADD COLUMN "businessKey" TEXT;
ALTER TABLE "Audit" ADD COLUMN "uploadedById" TEXT;
ALTER TABLE "Audit" ADD COLUMN "importId" TEXT;
ALTER TABLE "Audit" ADD COLUMN "isCurrent" BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE "Audit" ADD COLUMN "supersededAt" TIMESTAMP(3);
ALTER TABLE "Audit" ADD COLUMN "supersededById" TEXT;
ALTER TABLE "DefectEvent" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AdoptionSnapshot" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;

-- Preserve existing audit rows, including historical same-call duplicates, while making future business keys unique.
WITH ranked AS (
  SELECT "id", "cycleId", "counsellorId", "stage", "callId", "sourceHash",
         ROW_NUMBER() OVER (PARTITION BY "cycleId", "counsellorId", "stage", "callId" ORDER BY "submittedAt", "id") AS rn
  FROM "Audit"
)
UPDATE "Audit" a
SET "businessKey" = CASE
  WHEN r."callId" IS NOT NULL AND r.rn = 1 THEN r."cycleId" || '|' || r."counsellorId" || '|' || r."stage"::text || '|call:' || r."callId"
  WHEN r."callId" IS NOT NULL THEN 'legacy:' || r."id"
  ELSE r."cycleId" || '|' || r."counsellorId" || '|' || r."stage"::text || '|hash:' || r."sourceHash"
END
FROM ranked r WHERE a."id" = r."id";
ALTER TABLE "Audit" ALTER COLUMN "businessKey" SET NOT NULL;
CREATE UNIQUE INDEX "Audit_businessKey_key" ON "Audit"("businessKey");
CREATE INDEX "Audit_cycleId_counsellorId_isCurrent_idx" ON "Audit"("cycleId","counsellorId","isCurrent");
DROP INDEX IF EXISTS "DefectEvent_defectId_auditId_key";
CREATE UNIQUE INDEX "DefectEvent_defectId_auditId_revision_key" ON "DefectEvent"("defectId","auditId","revision");
DROP INDEX IF EXISTS "AdoptionSnapshot_counsellorId_cycleId_auditId_key";
CREATE UNIQUE INDEX "AdoptionSnapshot_counsellorId_cycleId_auditId_revision_key" ON "AdoptionSnapshot"("counsellorId","cycleId","auditId","revision");

-- Link old audit rows to the import row that recorded them, when such history exists.
WITH linked AS (
  SELECT DISTINCT ON (r."auditId") r."auditId", r."importId", i."userId"
  FROM "AuditImportRow" r JOIN "AuditImport" i ON i."id" = r."importId"
  WHERE r."auditId" IS NOT NULL
  ORDER BY r."auditId", i."createdAt", r."id"
)
UPDATE "Audit" a SET "importId" = l."importId", "uploadedById" = l."userId"
FROM linked l WHERE a."id" = l."auditId";

-- Existing rows without an import-row link receive a preserved legacy import entry.
INSERT INTO "AuditImport" ("id","userId","stage","cycleId","fileName","fileHash","status","totalRows","successRows")
SELECT 'legacy-import-' || a."id", (SELECT u."id" FROM "User" u ORDER BY u."createdAt",u."id" LIMIT 1), a."stage", a."cycleId", 'legacy-audit-' || a."id" || '.xlsx', md5(a."id") || md5(a."id" || '-legacy'), 'LEGACY', 1, 1
FROM "Audit" a WHERE a."importId" IS NULL;
UPDATE "Audit" a SET "importId"='legacy-import-' || a."id", "uploadedById"=(SELECT u."id" FROM "User" u ORDER BY u."createdAt",u."id" LIMIT 1)
WHERE a."importId" IS NULL;
ALTER TABLE "Audit" ALTER COLUMN "uploadedById" SET NOT NULL;
ALTER TABLE "Audit" ALTER COLUMN "importId" SET NOT NULL;

CREATE TABLE "CycleAssignment" (
  "id" TEXT NOT NULL,
  "cycleId" TEXT NOT NULL,
  "userId" TEXT,
  "counsellorId" TEXT,
  "teamId" TEXT,
  "access" "CycleAccess" NOT NULL DEFAULT 'VIEW',
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CycleAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CycleAssignment_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "AuditCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CycleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CycleAssignment_counsellorId_fkey" FOREIGN KEY ("counsellorId") REFERENCES "Counsellor"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CycleAssignment_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CycleAssignment_target_check" CHECK ("userId" IS NOT NULL OR "counsellorId" IS NOT NULL OR "teamId" IS NOT NULL)
);
CREATE INDEX "CycleAssignment_cycleId_userId_access_idx" ON "CycleAssignment"("cycleId","userId","access");
CREATE INDEX "CycleAssignment_cycleId_counsellorId_idx" ON "CycleAssignment"("cycleId","counsellorId");
CREATE INDEX "CycleAssignment_cycleId_teamId_idx" ON "CycleAssignment"("cycleId","teamId");
ALTER TABLE "AuditCycle" ADD CONSTRAINT "AuditCycle_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_importId_fkey" FOREIGN KEY ("importId") REFERENCES "AuditImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditImport" ADD CONSTRAINT "AuditImport_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "AuditCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
