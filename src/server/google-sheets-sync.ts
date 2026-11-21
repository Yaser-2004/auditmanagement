import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/prisma';
import { PARAMETERS } from '@/domain/parameters';
import { defaultScoring, scoreAudit, type Answer } from '@/domain/rules';
import { STAGE_WORKFLOW, validateStageTiming } from '@/domain/workflow';
import { rebuildCumulativeDefects, rebuildMappedMetrics } from '@/server/cumulative-defects';
import { fetchConfiguredGoogleSheet, fetchConfiguredGoogleSheetSince, googleSheetsConfiguration } from '@/integrations/google-sheets/client';
import { normalizeStoredPayload, parseGoogleSheetValues, detectExplicitStage, detectSequenceStage, type EvaluatorRole, type SheetSubmission } from '@/integrations/google-sheets/normalize';

const knownParameters = new Set<string>(PARAMETERS.map(([id]) => id));
const weights = Object.fromEntries(PARAMETERS.map(([id, , max]) => [id, Number(max)]));
const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const value = (row: Record<string, unknown>, aliases: string[]) => {
  const wanted = new Set(aliases.map(key));
  const name = Object.keys(row).find(k => wanted.has(key(k)));
  return name ? row[name] : undefined;
};
const numberValue = (row: Record<string, unknown>, aliases: string[]) => {
  const n = Number(value(row, aliases));
  return Number.isFinite(n) ? n : null;
};
const asJson = (raw: Record<string, unknown>) => raw as Prisma.InputJsonObject;
const stageMode = () => (process.env.GOOGLE_STAGE_DETECTION_MODE || 'SEQUENCE').toUpperCase() === 'EXPLICIT' ? 'EXPLICIT' : 'SEQUENCE';

type PersistedRow = SheetSubmission & { id: string; status: 'RECEIVED' | 'PROCESSED' | 'NEEDS_REVIEW' | 'FAILED' | 'IGNORED'; cycleId: string | null; counsellorId: string | null };
type ProcessResult = { status: 'PROCESSED' | 'NEEDS_REVIEW' | 'FAILED' | 'ALREADY_PROCESSED'; auditId?: string; cycleId?: string; counsellorId?: string; message?: string };

async function persistFetchedRow(row: SheetSubmission, source: { spreadsheetId: string; sheetName: string }, runId: string) {
  const sourceAuditId = row.auditId || `MISSING-${row.hash}`;
  const existing = await db.sourceSubmission.findUnique({ where: { sourceAuditId } });
  if (existing) {
    if (existing.payloadHash === row.hash) {
      await db.sourceSubmission.update({ where: { id: existing.id }, data: { fetchedAt: new Date(), sourceRowReference: row.sourceRowReference, sourceSheetName: source.sheetName, sourceSpreadsheetId: source.spreadsheetId, lastSyncRunId: runId, ...(existing.status === 'FAILED' ? { status: 'RECEIVED' } : {}) } });
      return { duplicate: true, submissionId: existing.id, queued: existing.status === 'FAILED' || existing.status === 'RECEIVED', needsReview: false };
    }
    await db.$transaction(async tx => {
      await tx.sourceSubmissionRevision.create({ data: { sourceSubmissionId: existing.id, revision: existing.revision, payload: existing.payload as Prisma.InputJsonValue, payloadHash: existing.payloadHash } });
      await tx.sourceSubmission.update({ where: { id: existing.id }, data: { payload: asJson(row.raw), payloadHash: row.hash, sourceRowReference: row.sourceRowReference, sourceSheetName: source.sheetName, sourceSpreadsheetId: source.spreadsheetId, revision: { increment: 1 }, fetchedAt: new Date(), lastSyncRunId: runId, status: 'NEEDS_REVIEW', errorMessage: 'The source row changed after it was first fetched. The existing audit was preserved; review the new source revision before applying any correction.' } });
      await tx.syncError.create({ data: { syncRunId: runId, sourceSubmissionId: existing.id, sourceRowReference: row.sourceRowReference, message: 'Source Audit ID already exists with changed content; preserved a revision and queued Admin review.' } });
    });
    return { duplicate: false, submissionId: existing.id, queued: false, changed: true, needsReview: true };
  }
  const status = row.errors.length ? 'NEEDS_REVIEW' : 'RECEIVED';
  const errorMessage = row.errors.length ? row.errors.join(' ') : null;
  const submission = await db.sourceSubmission.create({ data: {
    sourceAuditId, sourceSpreadsheetId: source.spreadsheetId, sourceSheetName: source.sheetName,
    sourceRowReference: row.sourceRowReference, payload: asJson(row.raw), payloadHash: row.hash,
    sourceStageText: row.stageText, sourceRoleText: row.roleText, normalizedRole: row.role,
    evaluatorName: row.evaluatorName || null, evaluatorEmail: row.evaluatorEmail || null,
    counsellorEmail: row.counsellorEmail || null, counsellorName: row.counsellorName || null,
    auditDate: row.auditDate, status, errorMessage, lastSyncRunId: runId,
  } });
  if (errorMessage) await db.syncError.create({ data: { syncRunId: runId, sourceSubmissionId: submission.id, sourceRowReference: row.sourceRowReference, message: errorMessage } });
  return { duplicate: false, submissionId: submission.id, queued: status === 'RECEIVED', needsReview: status === 'NEEDS_REVIEW' };
}

async function setReview(id: string, runId: string, message: string, counsellorId?: string | null, cycleId?: string | null) {
  await db.$transaction(async tx => {
    await tx.sourceSubmission.update({ where: { id }, data: { status: 'NEEDS_REVIEW', errorMessage: message, processedAt: null, ...(counsellorId !== undefined ? { counsellorId } : {}), ...(cycleId !== undefined ? { cycleId } : {}) } });
    await tx.syncError.create({ data: { syncRunId: runId, sourceSubmissionId: id, message } });
  });
  return { status: 'NEEDS_REVIEW' as const, message };
}

export async function processSourceSubmission(id: string, runId: string): Promise<ProcessResult> {
  const source = await db.sourceSubmission.findUnique({ where: { id }, include:{audit:{select:{id:true}}} });
  if (!source) return { status: 'FAILED', message: 'Source submission was not found.' };
  if (source.status === 'PROCESSED' || source.audit) return { status: 'ALREADY_PROCESSED', auditId: source.audit?.id, cycleId: source.cycleId ?? undefined, counsellorId: source.counsellorId ?? undefined };
  if (source.status === 'IGNORED') return { status: 'NEEDS_REVIEW', message: 'This source submission was excluded by an Admin.' };

  const row = normalizeStoredPayload(source.payload as Record<string, unknown>);
  const errors = [...row.errors];
  const roleText = source.resolvedRole || row.roleText;
  const role = (source.resolvedRole === 'TRAINER' || source.resolvedRole === 'QA' ? source.resolvedRole : row.role) as EvaluatorRole | null;
  const evaluator = source.resolvedEvaluatorUserId
    ? await db.user.findUnique({ where: { id: source.resolvedEvaluatorUserId } })
    : row.evaluatorEmail ? await db.user.findFirst({ where: { email: { equals: row.evaluatorEmail, mode: 'insensitive' } } }) : null;
  if (source.resolvedRole) for (let i = errors.length - 1; i >= 0; i--) if (errors[i].includes('Auditor Role')) errors.splice(i, 1);
  if (!role) errors.push(`Auditor Role “${roleText || '(blank)'}” must resolve to Trainer or QA.`);
  const counsellor = source.resolvedCounsellorId
    ? await db.counsellor.findUnique({ where: { id: source.resolvedCounsellorId } })
    : row.counsellorEmail ? await db.counsellor.findFirst({ where: { email: { equals: row.counsellorEmail, mode: 'insensitive' } } }) : null;
  if ((!row.counsellorEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.counsellorEmail)) && source.resolvedCounsellorId) {
    for (let i = errors.length - 1; i >= 0; i--) if (errors[i].includes('Counsellor Email')) errors.splice(i, 1);
  }
  if (source.resolvedCounsellorId && counsellor) {
    for (let i = errors.length - 1; i >= 0; i--) if (errors[i].includes('Counsellor Name')) errors.splice(i, 1);
    if (!counsellor.active) errors.push('The selected counsellor profile is inactive.');
  }
  if (counsellor && !source.resolvedCounsellorId && row.counsellorName.trim() !== counsellor.name) errors.push('The name differs from the existing counsellor profile for this email. Review the identity before processing.');
  if (errors.length) return setReview(id, runId, [...new Set(errors)].join(' '), counsellor?.id ?? undefined, undefined);
  if (!row.auditDate || !role) return setReview(id, runId, 'Audit date and a valid Trainer or QA role are required.', counsellor?.id ?? undefined, undefined);
  const auditDate = row.auditDate;

  // Cycle identity uses the counsellor email. Evaluator identity is retained when supplied but is optional.
  const resolvedCounsellor = counsellor ?? await db.counsellor.create({ data: { name: row.counsellorName, email: row.counsellorEmail } });
  let committed: { auditId: string; cycleId: string; completed: boolean } | null = null;
  let reviewMessage: string | null = null;
  try {
    committed = await db.$transaction(async tx => {
      await tx.$queryRaw`WITH lock_guard AS (SELECT pg_advisory_xact_lock(hashtextextended(${resolvedCounsellor.id}, 0))) SELECT 1::int AS locked FROM lock_guard`;
      const activeCycle = await tx.auditCycle.findFirst({ where: { counsellorId: resolvedCounsellor.id, status: 'IN_PROGRESS', completedAt: null }, orderBy: { cycleNumber: 'desc' } });
      const priorAudits = activeCycle ? await tx.audit.findMany({ where: { cycleId: activeCycle.id, counsellorId: resolvedCounsellor.id, isCurrent: true }, orderBy: [{ auditDate: 'asc' }, { submittedAt: 'asc' }], select: { id: true, stage: true, auditDate: true } }) : [];
      const priorStages = activeCycle ? priorAudits.map(a => a.stage) : null;
      const decision = source.resolvedStage
        ? detectExplicitStage(role, source.resolvedStage, priorStages)
        : stageMode() === 'EXPLICIT'
          ? detectExplicitStage(role, row.stageText, priorStages)
          : detectSequenceStage(role, priorStages);
      if (decision.status === 'NEEDS_REVIEW') { reviewMessage = decision.reason; return null; }
      const stage = decision.stage;
      if (activeCycle && priorAudits.some(a => a.stage === stage)) { reviewMessage = `Stage ${stage} already has an accepted audit in this cycle. The new source submission is preserved for Admin review.`; return null; }
      const timing = validateStageTiming(stage, auditDate, priorAudits.at(-1)?.auditDate ?? null);
      if (timing) {
        const rule = STAGE_WORKFLOW[stage];
        const previous = priorAudits.at(-1);
        if (previous && rule.previous) {
          const scheduledAt = new Date(previous.auditDate.getTime() + rule.minimumDaysAfter * 86_400_000);
          await tx.sLAViolation.create({ data: { cycleId: activeCycle!.id, counsellorId: resolvedCounsellor.id, ruleVersion: 1, status: 'MINIMUM_INTERVAL_BREACH', scheduledAt, submittedAt: auditDate, delayHours: (auditDate.getTime() - scheduledAt.getTime()) / 3_600_000 } });
        }
        reviewMessage = timing;
        return null;
      }
      const cycleNumber = activeCycle?.cycleNumber ?? ((await tx.auditCycle.aggregate({ where: { counsellorId: resolvedCounsellor.id }, _max: { cycleNumber: true } }))._max.cycleNumber ?? 0) + 1;
      const cycle = activeCycle ?? await tx.auditCycle.create({ data: { counsellorId: resolvedCounsellor.id, cycleNumber, name: `Cycle ${cycleNumber}`, startsAt: auditDate, endsAt: null, status: 'IN_PROGRESS' } });
      if (!activeCycle) await tx.cycleCounsellor.upsert({ where: { cycleId_counsellorId: { cycleId: cycle.id, counsellorId: resolvedCounsellor.id } }, create: { cycleId: cycle.id, counsellorId: resolvedCounsellor.id }, update: { active: true, removedAt: null } });
      const answers: Answer[] = Object.entries(row.responses).filter(([id]) => knownParameters.has(id)).map(([parameterId, status]) => ({ parameterId, status }));
      const score = scoreAudit(answers, weights, defaultScoring);
      const audit = await tx.audit.create({ data: {
        counsellorId: resolvedCounsellor.id, cycleId: cycle.id, stage, auditor: row.evaluatorName,
        auditDate, callDate: row.callDate, callId: row.callId, callLink: row.callLink,
        liveScore: numberValue(row.raw, ['Total Achieved']), totalMarks: numberValue(row.raw, ['Total Applicable Max']),
        calculatedScore: score.score, scorePercent: score.percent, sourceHash: source.payloadHash,
        businessKey: `sheets:${source.sourceAuditId}`, uploadedById: null, importId: null, sourceSubmissionId: source.id,
        sourceRow: asJson(row.raw), details: asJson(row.raw), evaluatorEmail: row.evaluatorEmail || evaluator?.email || null,
        evaluatorRole: role, sourceAuditId: source.sourceAuditId,
        disputeStatus: String(value(row.raw, ['Dispute Status']) ?? '') || null,
        revisedScore: numberValue(row.raw, ['Revised Score (Decimal)']),
        results: { create: answers.map(a => ({ parameterId: a.parameterId, status: a.status, rawValue: String(a.status) })) },
      } });
      const completed = stage === 'Q4';
      await tx.sourceSubmission.update({ where: { id: source.id }, data: { status: 'PROCESSED', errorMessage: null, processedAt: new Date(), detectedStage: stage, normalizedRole: role, evaluatorEmail: row.evaluatorEmail || evaluator?.email || null, counsellorId: resolvedCounsellor.id, cycleId: cycle.id } });
      if (completed) await tx.auditCycle.update({ where: { id: cycle.id }, data: { status: 'COMPLETED', completedAt: row.auditDate, endsAt: row.auditDate } });
      return { auditId: audit.id, cycleId: cycle.id, completed };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 30000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2002' || error.code === 'P2034')) {
      return setReview(id, runId, 'Another submission changed this counsellor’s cycle at the same time. The source row is preserved; review or retry it.', resolvedCounsellor.id);
    }
    throw error;
  }
  if (!committed && reviewMessage) return setReview(id, runId, reviewMessage, resolvedCounsellor.id);
  if (!committed) return setReview(id, runId, 'The submission could not be assigned to a cycle.', resolvedCounsellor.id);
  try {
    await rebuildCumulativeDefects(committed.cycleId, resolvedCounsellor.id);
    await rebuildMappedMetrics(committed.cycleId, [resolvedCounsellor.id]);
  } catch (error) {
    const message = `Audit was saved, but derived metrics need a retry: ${error instanceof Error ? error.message : String(error)}`;
    await db.syncError.create({ data: { syncRunId: runId, sourceSubmissionId: id, sourceRowReference: source.sourceRowReference, message } });
    return { status: 'PROCESSED', auditId: committed.auditId, cycleId: committed.cycleId, counsellorId: resolvedCounsellor.id, message };
  }
  return { status: 'PROCESSED', auditId: committed.auditId, cycleId: committed.cycleId, counsellorId: resolvedCounsellor.id };
}

/** Applies an Admin-approved source correction to the existing audit checkpoint, preserving the prior audit version. */
export async function applySourceCorrection(id: string, runId: string): Promise<ProcessResult> {
  const source = await db.sourceSubmission.findUnique({ where:{id}, include:{audit:{include:{results:true}}} });
  const prior = source?.audit;
  if (!source || !prior || !prior.isCurrent) return { status:'FAILED', message:'A current normalized audit is required for source correction.' };
  const row = normalizeStoredPayload(source.payload as Record<string,unknown>);
  const role = (source.resolvedRole==='TRAINER'||source.resolvedRole==='QA'?source.resolvedRole:row.role) as EvaluatorRole|null;
  const evaluator = source.resolvedEvaluatorUserId ? await db.user.findUnique({where:{id:source.resolvedEvaluatorUserId}}) : row.evaluatorEmail ? await db.user.findFirst({where:{email:{equals:row.evaluatorEmail,mode:'insensitive'}}}) : null;
  const counsellor = source.resolvedCounsellorId ? await db.counsellor.findUnique({where:{id:source.resolvedCounsellorId}}) : row.counsellorEmail ? await db.counsellor.findFirst({where:{email:{equals:row.counsellorEmail,mode:'insensitive'}}}) : null;
  const errors=[...row.errors];
  if(source.resolvedRole)for(let i=errors.length-1;i>=0;i--)if(errors[i].includes('Auditor Role'))errors.splice(i,1);
  if(source.resolvedCounsellorId)for(let i=errors.length-1;i>=0;i--)if(errors[i].includes('Counsellor Email')||errors[i].includes('Counsellor Name'))errors.splice(i,1);
  if(!role)errors.push('The corrected submission needs a valid Trainer or QA role.');
  if(!counsellor?.active||counsellor.id!==prior.counsellorId)errors.push('A correction cannot move an audit to a different counsellor.');
  if(role&&((prior.stage==='T1'||prior.stage==='T2')?role!=='TRAINER':role!=='QA'))errors.push(`The corrected role is not compatible with the existing ${prior.stage} checkpoint.`);
  if(row.stageText){const stage=row.stageText.trim().toUpperCase();if(stage!==prior.stage)errors.push(`A correction cannot move the audit from ${prior.stage} to ${stage}.`);}
  if(errors.length)return setReview(id,runId,[...new Set(errors)].join(' '),prior.counsellorId,prior.cycleId);
  const answers:Answer[]=Object.entries(row.responses).filter(([parameterId])=>knownParameters.has(parameterId)).map(([parameterId,status])=>({parameterId,status}));
  const score=scoreAudit(answers,weights,defaultScoring);
  let corrected: { id:string };
  try {
    corrected=await db.$transaction(async tx=>{
      await tx.$queryRaw`WITH lock_guard AS (SELECT pg_advisory_xact_lock(hashtextextended(${prior.counsellorId}, 0))) SELECT 1::int AS locked FROM lock_guard`;
      const current=await tx.audit.findUnique({where:{id:prior.id},select:{id:true,isCurrent:true}});
      if(!current?.isCurrent)throw new Error('The audit was changed while the correction was under review. Refresh and review again.');
      const nextBusinessKey=`sheets:${source.sourceAuditId}:revision:${source.revision}:correction:${runId}`;
      // Audit.sourceSubmissionId is unique. Detach the superseded version before
      // linking the corrected version to the same immutable source row.
      await tx.audit.update({where:{id:prior.id},data:{isCurrent:false,supersededAt:new Date(),businessKey:`superseded:${prior.id}:${source.revision}`,sourceSubmissionId:null}});
      const next=await tx.audit.create({data:{
        counsellorId:prior.counsellorId,cycleId:prior.cycleId,stage:prior.stage,auditor:row.evaluatorName||evaluator?.name||'Unknown evaluator',
        auditDate:prior.auditDate,callDate:row.callDate,callId:row.callId,callLink:row.callLink,
        liveScore:numberValue(row.raw,['Total Achieved']),totalMarks:numberValue(row.raw,['Total Applicable Max']),
        calculatedScore:score.score,scorePercent:score.percent,sourceHash:source.payloadHash,businessKey:nextBusinessKey,
        uploadedById:null,importId:null,sourceSubmissionId:source.id,sourceRow:asJson(row.raw),details:asJson(row.raw),
        evaluatorEmail:row.evaluatorEmail||evaluator?.email||null,evaluatorRole:role,sourceAuditId:source.sourceAuditId,
        disputeStatus:String(value(row.raw,['Dispute Status'])??'')||null,revisedScore:numberValue(row.raw,['Revised Score (Decimal)']),
        results:{create:answers.map(a=>({parameterId:a.parameterId,status:a.status,rawValue:String(a.status)}))},
      }});
      await tx.audit.update({where:{id:prior.id},data:{supersededById:next.id}});
      await tx.sourceSubmission.update({where:{id},data:{status:'PROCESSED',processedAt:new Date(),errorMessage:null,evaluatorEmail:row.evaluatorEmail||evaluator?.email||null,counsellorId:prior.counsellorId,cycleId:prior.cycleId,detectedStage:prior.stage,normalizedRole:role}});
      await tx.auditLog.create({data:{action:'GOOGLE_SHEET_AUDIT_CORRECTED',entity:'Audit',entityId:next.id,details:{priorAuditId:prior.id,sourceAuditId:source.sourceAuditId,revision:source.revision,reason:source.resolutionReason||'Admin-approved source correction'}}});
      return next;
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,maxWait:10000,timeout:30000});
  } catch(error) {
    const message=error instanceof Error?error.message:String(error);
    return setReview(id,runId,message,prior.counsellorId,prior.cycleId);
  }
  try {
    await rebuildCumulativeDefects(prior.cycleId,prior.counsellorId,true);
    await rebuildMappedMetrics(prior.cycleId,[prior.counsellorId]);
  } catch(error) {
    // The correction is already committed. Keep it processed and make the
    // failed recalculation visible for retry instead of presenting it as an
    // uncommitted correction that could be applied twice.
    await db.syncError.create({data:{syncRunId:runId,sourceSubmissionId:id,message:`Correction saved; metric recalculation failed: ${error instanceof Error?error.message:String(error)}`}});
  }
  return {status:'PROCESSED',auditId:corrected.id,cycleId:prior.cycleId,counsellorId:prior.counsellorId};
}

export async function synchronizeGoogleSheet(trigger: 'MANUAL' | 'SCHEDULED' = 'MANUAL') {
  const run = await db.syncRun.create({ data: { status: 'RUNNING' } });
  const leaseToken = randomUUID();
  let leaseAcquired = false;
  try {
    await db.syncError.create({ data: { syncRunId: run.id, message: `Sync triggered by ${trigger.toLowerCase()} invocation.` } });
    const config = googleSheetsConfiguration();
    const sheetName = config.range.includes('!') ? config.range.slice(0, config.range.indexOf('!')).replace(/^'/, '').replace(/'$/, '') : config.range;
    const lease = await db.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "GoogleSheetsSyncState" ("id", "spreadsheetId", "sheetName", "cursorRow", "updatedAt", "leaseToken", "leaseExpiresAt")
      VALUES ('GOOGLE_SHEETS_MAIN', ${config.spreadsheetId}, ${sheetName}, 0, NOW(), ${leaseToken}, NOW() + INTERVAL '30 minutes')
      ON CONFLICT ("id") DO UPDATE SET
        "cursorRow" = CASE WHEN "GoogleSheetsSyncState"."spreadsheetId" <> EXCLUDED."spreadsheetId" OR "GoogleSheetsSyncState"."sheetName" <> EXCLUDED."sheetName" THEN 0 ELSE "GoogleSheetsSyncState"."cursorRow" END,
        "lastReconciledAt" = CASE WHEN "GoogleSheetsSyncState"."spreadsheetId" <> EXCLUDED."spreadsheetId" OR "GoogleSheetsSyncState"."sheetName" <> EXCLUDED."sheetName" THEN NULL ELSE "GoogleSheetsSyncState"."lastReconciledAt" END,
        "spreadsheetId" = EXCLUDED."spreadsheetId", "sheetName" = EXCLUDED."sheetName",
        "updatedAt" = NOW(), "leaseToken" = EXCLUDED."leaseToken", "leaseExpiresAt" = EXCLUDED."leaseExpiresAt"
      WHERE "GoogleSheetsSyncState"."leaseExpiresAt" IS NULL OR "GoogleSheetsSyncState"."leaseExpiresAt" < NOW()
      RETURNING "id"
    `;
    if (!lease.length) {
      const message = 'This sync was skipped because another Google Sheets sync is still running.';
      await db.$transaction([
        db.syncError.create({ data: { syncRunId: run.id, message } }),
        db.syncRun.update({ where: { id: run.id }, data: { status: 'PARTIAL', finishedAt: new Date(), errorMessage: message } }),
      ]);
      return await db.syncRun.findUniqueOrThrow({ where: { id: run.id } });
    }
    leaseAcquired = true;
    const [state] = await db.$queryRaw<Array<{ cursorRow: number; lastReconciledAt: Date | null }>>`SELECT "cursorRow", "lastReconciledAt" FROM "GoogleSheetsSyncState" WHERE "id" = 'GOOGLE_SHEETS_MAIN' AND "leaseToken" = ${leaseToken}`;
    const intervalMinutes = Number(process.env.GOOGLE_SYNC_RECONCILE_MINUTES ?? 60);
    const reconcileMinutes = Number.isFinite(intervalMinutes) ? Math.max(5, Math.min(24 * 60, intervalMinutes)) : 60;
    const reconcileDue = !state || state.cursorRow <= 0 || !state.lastReconciledAt || Date.now() - state.lastReconciledAt.getTime() >= reconcileMinutes * 60_000;
    const source = reconcileDue
      ? await fetchConfiguredGoogleSheet()
      : await fetchConfiguredGoogleSheetSince(state.cursorRow);
    const incrementalDataStart = 'sourceDataStartRow' in source && typeof source.sourceDataStartRow === 'number' ? source.sourceDataStartRow : undefined;
    const parsed = parseGoogleSheetValues(source.values, incrementalDataStart
      ? { sourceDataStartRow: incrementalDataStart }
      : { sourceStartRow: source.sourceStartRow ?? 1 });
    const rows = parsed.rows;
    let duplicateCount = 0, prevalidatedReviewCount = 0;
    const received = new Set<string>();
    for (const row of rows) {
      const saved = await persistFetchedRow(row, { spreadsheetId: source.spreadsheetId, sheetName: source.sheetName }, run.id);
      if (saved.duplicate) duplicateCount++;
      if (saved.needsReview) prevalidatedReviewCount++;
      if (saved.queued) received.add(saved.submissionId);
    }
    const retryableSubmissions = await db.sourceSubmission.findMany({
      where: { sourceSpreadsheetId: source.spreadsheetId, sourceSheetName: source.sheetName, status: { in: ['RECEIVED', 'FAILED'] } },
      select: { id: true },
    });
    for (const submission of retryableSubmissions) received.add(submission.id);
    await db.syncRun.update({ where: { id: run.id }, data: { fetchedCount: rows.length, duplicateCount } });
    const firstDataRow = incrementalDataStart ?? source.sourceStartRow + parsed.sheetHeaderRow;
    const endRow = Math.max(source.endRow, ...rows.map(row => Number(row.sourceRowReference) || 0), state?.cursorRow ?? 0);
    await db.syncError.create({ data: { syncRunId: run.id, message: `${reconcileDue || !source.incrementalSupported ? 'Full reconciliation' : 'Incremental'} scan: ${rows.length} candidate row(s), source rows ${rows.length ? `${firstDataRow}–${endRow}` : 'no new rows'}; ${duplicateCount} existing submission ID(s) ignored.` } });
    const records: Array<{ id: string; row: SheetSubmission }> = [];
    for (const id of received) {
      const record = await db.sourceSubmission.findUnique({ where: { id } });
      if (record) records.push({ id, row: normalizeStoredPayload(record.payload as Record<string, unknown>) });
    }
    records.sort((a, b) => a.row.counsellorEmail.localeCompare(b.row.counsellorEmail) || (a.row.auditDate?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.row.auditDate?.getTime() ?? Number.MAX_SAFE_INTEGER));
    const tied = new Set<string>();
    for (let i = 1; i < records.length; i++) {
      const previous = records[i - 1], current = records[i];
      if (previous.row.counsellorEmail && previous.row.counsellorEmail === current.row.counsellorEmail && previous.row.auditDate?.getTime() === current.row.auditDate?.getTime()) {
        tied.add(previous.id); tied.add(current.id);
      }
    }
    let processedCount = 0, reviewCount = prevalidatedReviewCount, failedCount = 0;
    for (const record of records) {
      let result: ProcessResult;
      if (tied.has(record.id)) result = await setReview(record.id, run.id, 'Two submissions for this counsellor have the same source timestamp, so their sequence is ambiguous.', undefined);
      else {
        try { result = await processSourceSubmission(record.id, run.id); }
        catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await db.sourceSubmission.update({ where: { id: record.id }, data: { status: 'FAILED', errorMessage: message } });
          await db.syncError.create({ data: { syncRunId: run.id, sourceSubmissionId: record.id, sourceRowReference: record.row.sourceRowReference, message } });
          result = { status: 'FAILED', message };
        }
      }
      if (result.status === 'PROCESSED' || result.status === 'ALREADY_PROCESSED') processedCount++;
      else if (result.status === 'NEEDS_REVIEW') reviewCount++;
      else failedCount++;
    }
    const status = failedCount || reviewCount ? (processedCount || reviewCount ? 'PARTIAL' : 'FAILED') : 'SUCCEEDED';
    const result = await db.$transaction(async tx => {
      await tx.$executeRaw`
        UPDATE "GoogleSheetsSyncState" SET "cursorRow" = GREATEST("cursorRow", ${endRow}),
          "lastReconciledAt" = CASE WHEN ${reconcileDue || !source.incrementalSupported} THEN NOW() ELSE "lastReconciledAt" END,
          "updatedAt" = NOW()
        WHERE "id" = 'GOOGLE_SHEETS_MAIN' AND "leaseToken" = ${leaseToken}
      `;
      return tx.syncRun.update({ where: { id: run.id }, data: { status, finishedAt: new Date(), processedCount, reviewCount, failedCount } });
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.syncRun.update({ where: { id: run.id }, data: { status: 'FAILED', finishedAt: new Date(), errorMessage: message, failedCount: { increment: 1 } } });
    await db.syncError.create({ data: { syncRunId: run.id, message } });
    throw new Error(`Google Sheets sync failed: ${message}`);
  } finally {
    if (leaseAcquired) {
      await db.$executeRaw`UPDATE "GoogleSheetsSyncState" SET "leaseToken" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = NOW() WHERE "id" = 'GOOGLE_SHEETS_MAIN' AND "leaseToken" = ${leaseToken}`;
    }
  }
}
