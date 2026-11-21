import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/prisma';
import { accessErrorResponse, requireRole } from '@/server/auth';
import { applySourceCorrection, processSourceSubmission } from '@/server/google-sheets-sync';

const schema = z.object({
  action: z.enum(['RESOLVE', 'IGNORE']),
  reason: z.string().trim().min(5).max(500),
  stage: z.enum(['T1', 'Q1', 'Q2', 'T2', 'Q3', 'Q4']).optional(),
  role: z.enum(['TRAINER', 'QA']).optional(),
  counsellorId: z.string().optional(),
  evaluatorUserId: z.string().optional(),
});

export async function GET() {
  try {
    await requireRole(['ADMIN']);
    const [submissions, counsellors, evaluators] = await Promise.all([
      db.sourceSubmission.findMany({ where: { status: { in: ['NEEDS_REVIEW', 'FAILED', 'RECEIVED'] } }, take: 200, orderBy: { fetchedAt: 'desc' }, include: { revisions: { orderBy: { revision: 'desc' }, take: 2 } } }),
      db.counsellor.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, email: true } }),
      db.user.findMany({ where: { active: true, role: { in: ['TRAINER', 'AUDITOR'] } }, orderBy: { name: 'asc' }, select: { id: true, name: true, email: true, role: true } }),
    ]);
    return NextResponse.json({ submissions, counsellors, evaluators });
  } catch (error) { return accessErrorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const admin = await requireRole(['ADMIN']);
    const { id } = z.object({ id: z.string().min(1) }).parse(Object.fromEntries(new URL(request.url).searchParams));
    const input = schema.parse(await request.json());
    const prior = await db.sourceSubmission.findUnique({ where: { id }, include:{audit:{select:{id:true,isCurrent:true}}} });
    if (!prior) return NextResponse.json({ error: 'Source submission not found.' }, { status: 404 });
    if (prior.status === 'PROCESSED' && input.action !== 'IGNORE') return NextResponse.json({ error: 'Processed submissions require the authorized audit correction workflow; they cannot be reprocessed as a new checkpoint.' }, { status: 409 });
    if (input.action === 'IGNORE') {
      await db.sourceSubmission.update({ where: { id }, data: { status: 'IGNORED', resolutionReason: input.reason, reviewedById: admin.id, reviewedAt: new Date(), errorMessage: `Excluded by Admin: ${input.reason}` } });
      await db.auditLog.create({ data: { userId: admin.id, action: 'SOURCE_SUBMISSION_IGNORED', entity: 'SourceSubmission', entityId: id, details: { reason: input.reason, auditId: prior.sourceAuditId } } });
      return NextResponse.json({ status: 'IGNORED' });
    }
    if (input.counsellorId && !await db.counsellor.findUnique({ where: { id: input.counsellorId }, select: { id: true, active: true } })) return NextResponse.json({ error: 'Selected counsellor was not found.' }, { status: 404 });
    if (input.evaluatorUserId && !await db.user.findFirst({ where: { id: input.evaluatorUserId, active: true, role: { in: ['TRAINER', 'AUDITOR'] } }, select: { id: true } })) return NextResponse.json({ error: 'Selected evaluator account is not active or is not a Trainer/QA account.' }, { status: 400 });
    const run = await db.syncRun.create({ data: { status: 'RUNNING' } });
    await db.sourceSubmission.update({ where: { id }, data: {
      status: 'RECEIVED', errorMessage: null, resolutionReason: input.reason, reviewedById: admin.id, reviewedAt: new Date(),
      ...(input.stage ? { resolvedStage: input.stage } : {}), ...(input.role ? { resolvedRole: input.role } : {}),
      ...(input.counsellorId ? { resolvedCounsellorId: input.counsellorId } : {}), ...(input.evaluatorUserId ? { resolvedEvaluatorUserId: input.evaluatorUserId } : {}),
      lastSyncRunId: run.id,
    } });
    const result = prior.audit ? await applySourceCorrection(id, run.id) : await processSourceSubmission(id, run.id);
    await db.syncRun.update({ where: { id: run.id }, data: { status: result.status === 'PROCESSED' || result.status === 'ALREADY_PROCESSED' ? 'SUCCEEDED' : result.status === 'FAILED' ? 'FAILED' : 'PARTIAL', fetchedCount: 1, processedCount: result.status === 'PROCESSED' ? 1 : 0, reviewCount: result.status === 'NEEDS_REVIEW' ? 1 : 0, failedCount: result.status === 'FAILED' ? 1 : 0, finishedAt: new Date() } });
    await db.auditLog.create({ data: { userId: admin.id, action: 'SOURCE_SUBMISSION_RESOLVED', entity: 'SourceSubmission', entityId: id, details: { reason: input.reason, stage: input.stage ?? null, role: input.role ?? null, counsellorId: input.counsellorId ?? null, evaluatorUserId: input.evaluatorUserId ?? null, outcome: result.status } } });
    return NextResponse.json(result);
  } catch (error) { return accessErrorResponse(error); }
}
