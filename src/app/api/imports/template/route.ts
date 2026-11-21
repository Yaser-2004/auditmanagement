import { NextResponse } from 'next/server';
import { requireRole, accessErrorResponse } from '@/server/auth';

export async function GET() {
  try { await requireRole(['ADMIN','TRAINER','AUDITOR']); return NextResponse.json({ error:'The application no longer uses manual Excel templates. Submit evaluations through the connected Google Form.' }, { status:410 }); }
  catch (error) { return accessErrorResponse(error); }
}
