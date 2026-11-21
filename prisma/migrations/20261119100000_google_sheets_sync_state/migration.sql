CREATE TABLE "GoogleSheetsSyncState" (
    "id" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "sheetName" TEXT NOT NULL,
    "cursorRow" INTEGER NOT NULL DEFAULT 0,
    "lastReconciledAt" TIMESTAMP(3),
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GoogleSheetsSyncState_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GoogleSheetsSyncState_leaseExpiresAt_idx" ON "GoogleSheetsSyncState"("leaseExpiresAt");
