import { NextResponse } from 'next/server';
import { requireRole, accessErrorResponse } from '@/server/auth';

export async function POST() {
  try { await requireRole(['ADMIN','TRAINER','AUDITOR']); return NextResponse.json({ error:'Manual Excel imports are disabled. New audit submissions are synchronized from the configured Google Sheet.' }, { status:410 }); }
  catch (error) { return accessErrorResponse(error); }
}
