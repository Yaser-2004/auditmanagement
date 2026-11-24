import { NextResponse } from 'next/server';
import { db } from '@/lib/prisma';
import { accessErrorResponse, requireRole } from '@/server/auth';
import { GoogleSheetsIntegrationError } from '@/integrations/google-sheets/errors';
import { synchronizeGoogleSheet } from '@/server/google-sheets-sync';

/** Manual Sync Now uses the signed-in Admin session; no cron secret reaches the browser. */
export async function POST() {
  try {
    const admin = await requireRole(['ADMIN']);
    const run = await synchronizeGoogleSheet('MANUAL');
    await db.auditLog.create({ data: { userId: admin.id, action: 'GOOGLE_SHEETS_SYNC', entity: 'SyncRun', entityId: run.id, details: { status: run.status, fetched: run.fetchedCount, processed: run.processedCount, duplicates: run.duplicateCount, review: run.reviewCount, failed: run.failedCount } } });
    return NextResponse.json({ id: run.id, status: run.status, fetched: run.fetchedCount, processed: run.processedCount, duplicates: run.duplicateCount, needsReview: run.reviewCount, failed: run.failedCount });
  } catch (error) {
    if (error instanceof GoogleSheetsIntegrationError) {
      return NextResponse.json({ error: error.message, code: error.code, google: error.diagnostics }, { status: error.httpStatus });
    }
    if (error instanceof Error && error.message.startsWith('Google Sheets sync failed:')) return NextResponse.json({ error: error.message }, { status: 502 });
    return accessErrorResponse(error);
  }
}
