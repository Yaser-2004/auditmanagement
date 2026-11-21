ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'COUNSELLOR';

ALTER TABLE "User"
  ADD COLUMN "employeeId" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX "User_employeeId_key" ON "User"("employeeId");

ALTER TABLE "AuditCycle" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Counsellor"
  ADD COLUMN "employeeId" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "userId" TEXT;
CREATE UNIQUE INDEX "Counsellor_employeeId_key" ON "Counsellor"("employeeId");
CREATE UNIQUE INDEX "Counsellor_userId_key" ON "Counsellor"("userId");
ALTER TABLE "Counsellor" ADD CONSTRAINT "Counsellor_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CycleCounsellor" (
  "id" TEXT NOT NULL,
  "cycleId" TEXT NOT NULL,
  "counsellorId" TEXT NOT NULL,
  "enrolledById" TEXT,
  "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "removedAt" TIMESTAMP(3),
  CONSTRAINT "CycleCounsellor_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CycleCounsellor_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "AuditCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CycleCounsellor_counsellorId_fkey" FOREIGN KEY ("counsellorId") REFERENCES "Counsellor"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CycleCounsellor_enrolledById_fkey" FOREIGN KEY ("enrolledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CycleCounsellor_cycleId_counsellorId_key" ON "CycleCounsellor"("cycleId","counsellorId");
CREATE INDEX "CycleCounsellor_cycleId_active_idx" ON "CycleCounsellor"("cycleId","active");

-- Existing audit participants remain enrolled when this model is introduced.
INSERT INTO "CycleCounsellor" ("id","cycleId","counsellorId","active")
SELECT 'legacy-enrollment-' || x."cycleId" || '-' || x."counsellorId", x."cycleId", x."counsellorId", TRUE
FROM (SELECT DISTINCT "cycleId","counsellorId" FROM "Audit") x
ON CONFLICT ("cycleId","counsellorId") DO NOTHING;

ALTER TABLE "CycleAssignment"
  ADD COLUMN "assignedById" TEXT,
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "endedAt" TIMESTAMP(3);
ALTER TABLE "CycleAssignment" ADD CONSTRAINT "CycleAssignment_assignedById_fkey"
  FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "CycleAssignment_cycleId_userId_counsellorId_active_idx"
  ON "CycleAssignment"("cycleId","userId","counsellorId","active");

-- Legacy audit imports may have introduced counsellors without explicit roster rows.
-- Keep existing rows visible to administrators; new imports will require explicit enrollment.
