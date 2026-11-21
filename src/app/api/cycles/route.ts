import { NextResponse } from 'next/server';
import { requireRole, accessErrorResponse } from '@/server/auth';

export async function POST() {
  try { await requireRole(['ADMIN']); return NextResponse.json({ error:'Manual audit-cycle creation is disabled. A counsellor cycle is created automatically when a valid Trainer T1 submission is synchronized.' }, { status:410 }); }
  catch (error) { return accessErrorResponse(error); }
}
