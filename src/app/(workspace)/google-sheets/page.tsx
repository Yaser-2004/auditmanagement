import { requirePageRole } from '@/server/auth';
import { db } from '@/lib/prisma';
import { googleSheetsConfigurationStatus } from '@/integrations/google-sheets/client';
import GoogleSheetsAdmin from '@/components/google-sheets-admin';

export default async function GoogleSheetsPage({ searchParams }: { searchParams: Promise<{ connection?: string; connection_error?: string }> }) {
  await requirePageRole(['ADMIN']);
  const query = await searchParams;
  const configuration = await googleSheetsConfigurationStatus();
  const [counsellorsCount, activeCycles, completedCycles, incompleteCycles, submissions, processedEntries, pendingReview, failedSyncs, lastSuccess, cycles, runs, reviews, counsellors, evaluators] = await Promise.all([
    db.counsellor.count(),
    db.auditCycle.count({ where: { counsellorId: { not: null }, status: 'IN_PROGRESS' } }),
    db.auditCycle.count({ where: { counsellorId: { not: null }, status: 'COMPLETED' } }),
    db.auditCycle.count({ where: { counsellorId: { not: null }, status: 'IN_PROGRESS' } }),
    db.sourceSubmission.count(),
    db.sourceSubmission.count({ where: { status: 'PROCESSED' } }),
    db.sourceSubmission.count({ where: { status: 'NEEDS_REVIEW' } }),
    db.syncRun.count({ where: { OR: [{ status: 'FAILED' }, { failedCount: { gt: 0 } }] } }),
    db.syncRun.findFirst({ where: { status: 'SUCCEEDED' }, orderBy: { finishedAt: 'desc' }, select: { finishedAt: true } }),
    db.auditCycle.findMany({ where: { counsellorId: { not: null } }, take: 200, orderBy: [{ startsAt: 'desc' }, { cycleNumber: 'desc' }], include: { counsellor: { select: { name: true, email: true } }, audits: { where: { isCurrent: true }, select: { stage: true } } } }),
    db.syncRun.findMany({ take: 30, orderBy: { startedAt: 'desc' }, include: { errors: { take: 5, orderBy: { createdAt: 'desc' }, select: { message: true, sourceRowReference: true, createdAt: true } } } }),
    db.sourceSubmission.findMany({ where: { status: { in: ['NEEDS_REVIEW', 'FAILED', 'RECEIVED'] } }, take: 100, orderBy: { fetchedAt: 'desc' } }),
    db.counsellor.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, email: true } }),
    db.user.findMany({ where: { active: true, role: { in: ['TRAINER', 'AUDITOR'] } }, orderBy: { name: 'asc' }, select: { id: true, name: true, email: true, role: true } }),
  ]);
  return <GoogleSheetsAdmin
    configuration={configuration}
    connectionResult={query.connection === 'connected' ? 'connected' : query.connection_error ?? null}
    stats={{ counsellors: counsellorsCount, activeCycles, completedCycles, incompleteCycles, submissions, processedEntries, pendingReview, failedSyncs, lastSuccess: lastSuccess?.finishedAt?.toISOString() ?? null }}
    cycles={cycles.filter(c => c.counsellor).map(c => ({ id: c.id, name: c.name, cycleNumber: c.cycleNumber, status: c.status, startsAt: c.startsAt.toISOString(), completedAt: c.completedAt?.toISOString() ?? null, counsellor: c.counsellor!, audits: c.audits }))}
    runs={runs.map(r => ({ id: r.id, status: r.status, startedAt: r.startedAt.toISOString(), fetchedCount: r.fetchedCount, processedCount: r.processedCount, duplicateCount: r.duplicateCount, reviewCount: r.reviewCount, failedCount: r.failedCount, errorMessage: r.errorMessage, errors: r.errors }))}
    reviews={reviews.map(r => ({ ...r, fetchedAt: r.fetchedAt.toISOString(), processedAt: r.processedAt?.toISOString() ?? null, auditDate: r.auditDate?.toISOString() ?? null }))}
    counsellors={counsellors}
    evaluators={evaluators}
  />;
}
