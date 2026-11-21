-- Store the user's Google OAuth refresh token encrypted by the application.
-- This replaces service-account credentials while preserving all audit data.
CREATE TABLE "GoogleSheetsCredential" (
  "id" TEXT NOT NULL,
  "accountEmail" TEXT NOT NULL,
  "refreshTokenCiphertext" TEXT NOT NULL,
  "encryptionIv" TEXT NOT NULL,
  "encryptionTag" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoogleSheetsCredential_pkey" PRIMARY KEY ("id")
);
