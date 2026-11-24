import { NextResponse } from 'next/server';
import { accessErrorResponse } from '@/server/auth';
import { authorizeGoogleSheetsCron } from '@/server/google-sheets-cron-auth';
import { GoogleSheetsIntegrationError } from '@/integrations/google-sheets/errors';
import { synchronizeGoogleSheet } from '@/server/google-sheets-sync';

async function scheduledSync(request: Request) {
  const authorization = authorizeGoogleSheetsCron(request.headers.get('authorization'));
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  try {
    const run = await synchronizeGoogleSheet('SCHEDULED');
    return NextResponse.json({ id: run.id, status: run.status, fetched: run.fetchedCount, processed: run.processedCount, duplicates: run.duplicateCount, needsReview: run.reviewCount, failed: run.failedCount });
  } catch (error) {
    if (error instanceof GoogleSheetsIntegrationError) {
      return NextResponse.json({ error: error.message, code: error.code, google: error.diagnostics }, { status: error.httpStatus });
    }
    if (error instanceof Error && error.message.startsWith('Google Sheets sync failed:')) return NextResponse.json({ error: error.message }, { status: 502 });
    return accessErrorResponse(error);
  }
}

/** Cron-job.org and deployment schedulers must use the configured bearer token. */
export async function GET(request: Request) {
  return scheduledSync(request);
}

/** POST is also available to schedulers that do not support GET triggers. */
export async function POST(request: Request) {
  return scheduledSync(request);
}
