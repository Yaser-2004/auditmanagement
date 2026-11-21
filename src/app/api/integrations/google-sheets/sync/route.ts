import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { db } from '@/lib/prisma';
import { accessErrorResponse, requireRole } from '@/server/auth';
import { synchronizeGoogleSheet } from '@/server/google-sheets-sync';

function validCronSecret(request: Request) {
  const expected = process.env.GOOGLE_SYNC_CRON_SECRET || '';
  const actual = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (expected.length < 32 || expected.length !== actual.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

export async function POST(request: Request) {
  let actorId: string | null = null;
  try {
    if (!validCronSecret(request)) actorId = (await requireRole(['ADMIN'])).id;
    const run = await synchronizeGoogleSheet(actorId ? 'MANUAL' : 'SCHEDULED');
    if (actorId) await db.auditLog.create({ data: { userId: actorId, action: 'GOOGLE_SHEETS_SYNC', entity: 'SyncRun', entityId: run.id, details: { status: run.status, fetched: run.fetchedCount, processed: run.processedCount, duplicates: run.duplicateCount, review: run.reviewCount, failed: run.failedCount } } });
    return NextResponse.json({ id: run.id, status: run.status, fetched: run.fetchedCount, processed: run.processedCount, duplicates: run.duplicateCount, needsReview: run.reviewCount, failed: run.failedCount });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Google Sheets sync failed:')) return NextResponse.json({ error: error.message }, { status: 502 });
    return accessErrorResponse(error);
  }
}

/** Platform cron entry point. Supports providers that invoke scheduled routes with GET. */
export async function GET(request: Request) {
  if (!process.env.GOOGLE_SYNC_CRON_SECRET?.trim()) return NextResponse.json({ error: 'Scheduled sync is not configured: GOOGLE_SYNC_CRON_SECRET is missing.' }, { status: 503 });
  if (!validCronSecret(request)) return NextResponse.json({ error: 'Unauthorized scheduled sync request.' }, { status: 401 });
  try {
    const run = await synchronizeGoogleSheet('SCHEDULED');
    return NextResponse.json({ id: run.id, status: run.status, fetched: run.fetchedCount, processed: run.processedCount, duplicates: run.duplicateCount, needsReview: run.reviewCount, failed: run.failedCount });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Google Sheets sync failed:')) return NextResponse.json({ error: error.message }, { status: 502 });
    return accessErrorResponse(error);
  }
}
