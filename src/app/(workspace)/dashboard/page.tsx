import Link from 'next/link';
import { db } from '@/lib/prisma';
import { assignedCycles, auditScope, requirePageRole } from '@/server/auth';
import { PROPOSED_ADOPTION_CHECKPOINTS } from '@/domain/metrics';
import { AdoptionInsightChart, CycleProgressTable, RecentAuditTable, StageCoverageChart } from '@/components/dashboard-analytics';
import type { GridRow } from '@/components/filterable-table';

const stages = ['T1', 'Q1', 'Q2', 'T2', 'Q3', 'Q4'] as const;

export default async function Dashboard() {
  const user = await requirePageRole(['ADMIN', 'MANAGER', 'TRAINER', 'AUDITOR', 'COUNSELLOR']);
  const scope = await auditScope(user);
  const [audits, cycles] = await Promise.all([
    db.audit.findMany({ where: scope, orderBy: { auditDate: 'desc' }, take: 1000, include: { cycle: { select: { name: true } }, counsellor: { select: { id: true, name: true, email: true, employeeId: true, team: { select: { name: true } } } } } }),
    assignedCycles(user),
  ]);
  const cycleById = new Map(cycles.map(cycle => [cycle.id, cycle]));
  const grouped = new Map<string, { cycleId: string; counsellorId: string; counsellor: string; email: string; employeeId: string; team: string; cycle: string; stages: Set<string>; latest: Date }>();
  for (const audit of audits) {
    const key = `${audit.cycleId}:${audit.counsellorId}`;
    const row = grouped.get(key) ?? { cycleId: audit.cycleId, counsellorId: audit.counsellorId, counsellor: audit.counsellor.name, email: audit.counsellor.email, employeeId: audit.counsellor.employeeId ?? '—', team: audit.counsellor.team?.name ?? '—', cycle: audit.cycle.name, stages: new Set<string>(), latest: audit.auditDate };
    row.stages.add(audit.stage);
    if (audit.auditDate > row.latest) row.latest = audit.auditDate;
    grouped.set(key, row);
  }
  const cycleProgress: GridRow[] = [...grouped.values()].map(row => {
    const nextStage = stages.find(stage => !row.stages.has(stage)) ?? '';
    const complete = stages.filter(stage => row.stages.has(stage)).length;
    const cycle = cycleById.get(row.cycleId);
    return { id: `${row.cycleId}:${row.counsellorId}`, counsellor: row.counsellor, email: row.email, employeeId: row.employeeId, team: row.team, cycle: row.cycle, ...Object.fromEntries(stages.map(stage => [stage, row.stages.has(stage) ? 'Received' : 'Missing'])), progress: Math.round(complete / stages.length * 100), status: complete === stages.length ? 'Complete' : cycle?.status === 'COMPLETED' || cycle?.status === 'CLOSED' ? 'Closed · incomplete' : 'In progress', nextStage, latest: row.latest.toISOString() };
  });
  const metricPairs = [...grouped.values()].map(row => ({ cycleId: row.cycleId, counsellorId: row.counsellorId }));
  const pairFilter = user.role === 'ADMIN' ? {} : metricPairs.length ? { OR: metricPairs } : { id: '__no_access__' };
  const metricRoles = ['ADMIN', 'MANAGER', 'COUNSELLOR'].includes(user.role);
  const [counsellorCount, activeCycles, completedCycles, submissions, pendingReview, duplicateSum, failedSyncs, lastSync, defects, snapshots, metrics, syncAlerts, lateAlerts] = user.role === 'ADMIN' ? await Promise.all([
    db.counsellor.count(), db.auditCycle.count({ where: { status: { in: ['ACTIVE', 'IN_PROGRESS'] } } }), db.auditCycle.count({ where: { status: 'COMPLETED' } }),
    db.sourceSubmission.count(), db.sourceSubmission.count({ where: { status: 'NEEDS_REVIEW' } }), db.syncRun.aggregate({ _sum: { duplicateCount: true } }).then(x => x._sum.duplicateCount ?? 0),
    db.syncRun.count({ where: { OR: [{ status: 'FAILED' }, { failedCount: { gt: 0 } }] } }), db.syncRun.findFirst({ where: { status: 'SUCCEEDED' }, orderBy: { finishedAt: 'desc' }, select: { finishedAt: true } }),
    db.cumulativeDefect.findMany({ where: { AND: [pairFilter, { status: { not: 'SUPERSEDED' } }] }, select: { status: true } }), db.adoptionSnapshot.findMany({ where: pairFilter, orderBy: { createdAt: 'desc' }, take: 1000, select: { cycleId: true, counsellorId: true, newDefects: true, continuingDefects: true, rectifiedDefects: true, recurringDefects: true } }),
    db.performanceMetric.findMany({ where: pairFilter, orderBy: { createdAt: 'desc' }, take: 1000, select: { cycleId: true, counsellorId: true, avg1: true, avg2: true } }),
    db.syncRun.findMany({ where: { OR: [{ status: 'FAILED' }, { duplicateCount: { gt: 0 } }] }, orderBy: { startedAt: 'desc' }, take: 5, select: { id: true, status: true, startedAt: true, duplicateCount: true, failedCount: true, errorMessage: true } }),
    db.sLAViolation.findMany({ where: { status: { in: ['LATE', 'OVERDUE', 'DELAYED'] } }, orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, status: true, cycleId: true, counsellorId: true, delayHours: true } }),
  ]) : [0, 0, 0, 0, 0, 0, 0, null, metricRoles ? await db.cumulativeDefect.findMany({ where: { AND: [pairFilter, { status: { not: 'SUPERSEDED' } }] }, select: { status: true } }) : [], metricRoles ? await db.adoptionSnapshot.findMany({ where: pairFilter, orderBy: { createdAt: 'desc' }, take: 1000, select: { cycleId: true, counsellorId: true, newDefects: true, continuingDefects: true, rectifiedDefects: true, recurringDefects: true } }) : [], metricRoles ? await db.performanceMetric.findMany({ where: pairFilter, orderBy: { createdAt: 'desc' }, take: 1000, select: { cycleId: true, counsellorId: true, avg1: true, avg2: true } }) : [], [], []];

  const incompleteCycles = new Set([...grouped.values()].filter(row => row.stages.size < stages.length).map(row => row.cycleId)).size;
  const totalDefects = defects.length;
  const rectified = defects.filter(defect => defect.status === 'RECTIFIED').length;
  const adoptionRate = totalDefects ? rectified / totalDefects * 100 : null;
  const latestSnapshots = new Map<string, typeof snapshots[number]>();
  for (const snapshot of snapshots) { const key = `${snapshot.cycleId}:${snapshot.counsellorId}`; if (!latestSnapshots.has(key)) latestSnapshots.set(key, snapshot); }
  const defectTotals = [...latestSnapshots.values()].reduce((sum, row) => ({ newDefects: sum.newDefects + row.newDefects, continuing: sum.continuing + row.continuingDefects, rectified: sum.rectified + row.rectifiedDefects, recurring: sum.recurring + row.recurringDefects }), { newDefects: 0, continuing: 0, rectified: 0, recurring: 0 });
  const stageCoverage = stages.map(stage => ({ stage, accepted: audits.filter(audit => audit.stage === stage).length }));
  const byMetricCycle = new Map<string, { label: string; avg1: number | null; avg2: number | null }>();
  for (const metric of metrics) {
    const key = `${metric.cycleId}:${metric.counsellorId}`;
    if (!byMetricCycle.has(key)) byMetricCycle.set(key, { label: `${grouped.get(key)?.counsellor ?? 'Counsellor'} · ${cycleById.get(metric.cycleId)?.name ?? 'Cycle'}`, avg1: metric.avg1 === null ? null : Number(metric.avg1), avg2: metric.avg2 === null ? null : Number(metric.avg2) });
  }
  const adoptionTrend = [...byMetricCycle.values()].slice(0, 12).map(row => ({ period: row.label.length > 20 ? `${row.label.slice(0, 18)}…` : row.label, avg1: row.avg1, avg2: row.avg2 }));
  const recentRows: GridRow[] = audits.slice(0, 100).map(audit => ({ id: audit.id, counsellor: audit.counsellor.name, email: audit.counsellor.email, employeeId: audit.counsellor.employeeId ?? '', team: audit.counsellor.team?.name ?? '—', evaluator: audit.auditor || '—', evaluatorEmail: audit.evaluatorEmail ?? '', cycle: audit.cycle.name, stage: audit.stage, auditDate: audit.auditDate.toISOString(), score: audit.scorePercent === null ? null : Number(audit.scorePercent) }));
  const alerts: { title: string; detail: string; href: string }[] = [];
  for (const row of cycleProgress.filter(item => item.status !== 'Complete').slice(0, 5)) alerts.push({ title: `Missing ${row.nextStage || 'audit stage'}`, detail: `${row.counsellor} · ${row.cycle}`, href: '/audits' });
  for (const sync of syncAlerts) alerts.push({ title: sync.duplicateCount ? `${sync.duplicateCount} duplicate submission(s)` : `${sync.failedCount} failed submission(s)`, detail: `${sync.startedAt.toLocaleString()} · ${sync.errorMessage ?? sync.status}`, href: '/google-sheets' });
  for (const violation of lateAlerts) alerts.push({ title: `Recorded ${violation.status.toLowerCase()} audit`, detail: `${violation.counsellorId ?? 'Counsellor'} · ${violation.delayHours === null ? 'delay recorded' : `${Number(violation.delayHours).toFixed(1)}h delay`}`, href: '/reports' });

  return <div className="content">
    <div className="page-heading"><div><div className="title">{user.role === 'ADMIN' || user.role === 'MANAGER' ? 'Management overview' : user.role === 'COUNSELLOR' ? 'My performance overview' : 'My submitted audit overview'}</div><div className="sub">{user.role === 'ADMIN' ? 'Audit quality, adoption and source synchronization at a glance.' : `Showing records within ${user.name}’s authorized scope.`}</div></div>{user.role === 'ADMIN' && <Link className="btn primary" href="/google-sheets">Open Google Sheets sync</Link>}</div>
    <div className="grid metrics dashboard-metrics">
      {user.role === 'ADMIN' ? [['Total counsellors', counsellorCount], ['Active cycles', activeCycles], ['Completed cycles', completedCycles], ['Incomplete cycles', incompleteCycles], ['Submissions received', submissions], ['Accepted audits', audits.length], ['Pending review', pendingReview], ['Duplicates', duplicateSum], ['Failed syncs', failedSyncs]].map(([label, value]) => <div className="metric" key={String(label)}><span className="eyebrow">{label}</span><strong>{value}</strong></div>) : [['Assigned cycles', cycles.length], ['Audits in scope', audits.length], ['Incomplete counsellor cycles', incompleteCycles]].map(([label, value]) => <div className="metric" key={String(label)}><span className="eyebrow">{label}</span><strong>{value}</strong></div>)}
    </div>
    {user.role === 'ADMIN' && <div className="notice" style={{ marginTop: 12 }}>Last successful Google Sheets sync: {lastSync?.finishedAt?.toLocaleString() ?? 'Not yet synchronized'}.</div>}
    {metricRoles && <>
      <div className="grid metrics adoption-metrics">{[['New defects', defectTotals.newDefects], ['Continuing defects', defectTotals.continuing], ['Rectified', defectTotals.rectified], ['Recurring', defectTotals.recurring], ['Unique defects', totalDefects], ['Cumulative adoption', adoptionRate === null ? 'N/A' : `${adoptionRate.toFixed(1)}%`]].map(([label, value]) => <div className="metric" key={String(label)}><span className="eyebrow">{label}</span><strong>{value}</strong></div>)}</div>
      {user.role === 'ADMIN' && <div className="notice">Proposed adoption checkpoints: {Object.entries(PROPOSED_ADOPTION_CHECKPOINTS).map(([metric, stage]) => `${metric} → ${stage}`).join(' · ')}. Review in Adoption settings.</div>}
    </>}
    <div className="dashboard-grid"><StageCoverageChart data={stageCoverage}/><section className="panel alert-panel"><div className="panel-heading"><div><div className="panel-title">Operational alerts</div><div className="panel-sub">Missing stages and recorded synchronization or timing issues</div></div><span className="status-badge status-neutral">{alerts.length}</span></div>{alerts.length ? <div className="alert-list">{alerts.slice(0, 8).map((alert, index) => <Link className="alert-row" href={alert.href} key={`${alert.title}-${index}`}><span className="alert-mark" aria-hidden="true">!</span><span><b>{alert.title}</b><small>{alert.detail}</small></span></Link>)}</div> : <div className="empty-state compact"><b>No active alerts</b><p>No missing stages or recorded sync issues in this view.</p></div>}</section></div>
    {metricRoles && <AdoptionInsightChart data={adoptionTrend}/>}
    <section className="panel dashboard-section"><div className="panel-heading"><div><div className="panel-title">Counsellor cycle progress</div><div className="panel-sub">Six expected submissions per counsellor cycle; stage status is based on accepted audit records.</div></div></div><CycleProgressTable rows={cycleProgress}/></section>
    <section className="panel dashboard-section"><div className="panel-heading"><div><div className="panel-title">Recent audit submissions</div><div className="panel-sub">Search and filter the most recent accepted records in your scope.</div></div><Link className="text-link" href="/audits">View audit management</Link></div><RecentAuditTable rows={recentRows}/></section>
  </div>;
}
