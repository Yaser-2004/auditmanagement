CREATE TABLE "CumulativeDefect" ("id" TEXT NOT NULL,"counsellorId" TEXT NOT NULL,"cycleId" TEXT NOT NULL,"parameterId" TEXT NOT NULL,"status" TEXT NOT NULL DEFAULT 'UNRESOLVED',"everRectified" BOOLEAN NOT NULL DEFAULT false,"firstAuditId" TEXT NOT NULL,"latestAuditId" TEXT NOT NULL,"firstIdentifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "CumulativeDefect_pkey" PRIMARY KEY ("id"));
CREATE TABLE "DefectEvent" ("id" TEXT NOT NULL,"defectId" TEXT NOT NULL,"auditId" TEXT NOT NULL,"eventType" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "DefectEvent_pkey" PRIMARY KEY ("id"));
CREATE TABLE "AdoptionSnapshot" ("id" TEXT NOT NULL,"counsellorId" TEXT NOT NULL,"cycleId" TEXT NOT NULL,"auditId" TEXT NOT NULL,"checkpoint" "Stage" NOT NULL,"numerator" INTEGER NOT NULL,"denominator" INTEGER NOT NULL,"percentage" DECIMAL(8,2),"newDefects" INTEGER NOT NULL,"continuingDefects" INTEGER NOT NULL,"rectifiedDefects" INTEGER NOT NULL,"recurringDefects" INTEGER NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "AdoptionSnapshot_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "CumulativeDefect_counsellorId_cycleId_parameterId_key" ON "CumulativeDefect"("counsellorId","cycleId","parameterId");
CREATE INDEX "CumulativeDefect_cycleId_counsellorId_status_idx" ON "CumulativeDefect"("cycleId","counsellorId","status");
CREATE UNIQUE INDEX "DefectEvent_defectId_auditId_key" ON "DefectEvent"("defectId","auditId");
CREATE INDEX "DefectEvent_auditId_eventType_idx" ON "DefectEvent"("auditId","eventType");
CREATE UNIQUE INDEX "AdoptionSnapshot_counsellorId_cycleId_auditId_key" ON "AdoptionSnapshot"("counsellorId","cycleId","auditId");
CREATE INDEX "AdoptionSnapshot_cycleId_checkpoint_createdAt_idx" ON "AdoptionSnapshot"("cycleId","checkpoint","createdAt");
ALTER TABLE "CumulativeDefect" ADD CONSTRAINT "CumulativeDefect_counsellorId_fkey" FOREIGN KEY ("counsellorId") REFERENCES "Counsellor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CumulativeDefect" ADD CONSTRAINT "CumulativeDefect_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "AuditCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DefectEvent" ADD CONSTRAINT "DefectEvent_defectId_fkey" FOREIGN KEY ("defectId") REFERENCES "CumulativeDefect"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdoptionSnapshot" ADD CONSTRAINT "AdoptionSnapshot_counsellorId_fkey" FOREIGN KEY ("counsellorId") REFERENCES "Counsellor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdoptionSnapshot" ADD CONSTRAINT "AdoptionSnapshot_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "AuditCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

