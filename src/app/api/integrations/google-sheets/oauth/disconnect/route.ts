import { NextResponse } from 'next/server';
import { db } from '@/lib/prisma';
import { accessErrorResponse, requireRole } from '@/server/auth';
import { GOOGLE_SHEETS_CREDENTIAL_ID } from '@/integrations/google-sheets/oauth';

export async function POST() {
  try {
    const admin = await requireRole(['ADMIN']);
    const rows = await db.$queryRaw<Array<{ accountEmail: string }>>`SELECT "accountEmail" FROM "GoogleSheetsCredential" WHERE "id" = ${GOOGLE_SHEETS_CREDENTIAL_ID} LIMIT 1`;
    await db.$executeRaw`DELETE FROM "GoogleSheetsCredential" WHERE "id" = ${GOOGLE_SHEETS_CREDENTIAL_ID}`;
    await db.auditLog.create({ data: { userId: admin.id, action: 'GOOGLE_SHEETS_ACCOUNT_DISCONNECTED', entity: 'GoogleSheetsCredential', entityId: GOOGLE_SHEETS_CREDENTIAL_ID, details: { accountEmail: rows[0]?.accountEmail ?? null } } });
    return NextResponse.json({ connected: false });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
