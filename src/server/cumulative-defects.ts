import {db} from '@/lib/prisma';
import {advanceDefectRegister,type DefectRecord,type Answer} from '@/domain/rules';
import {calculateCheckpointMetric,calculatePerformanceSummary,PROPOSED_ADOPTION_CHECKPOINTS,type AdoptionMetricKey} from '@/domain/metrics';
import {STAGES} from '@/domain/parameters';
import type {Stage} from '@prisma/client';

/** Replays cycle audits chronologically; immutable per-audit snapshots are only inserted when absent. */
export async function rebuildCumulativeDefects(cycleId:string,counsellorId:string,appendRevision=false){
 const audits=await db.audit.findMany({where:{cycleId,counsellorId,isCurrent:true},orderBy:[{auditDate:'asc'},{submittedAt:'asc'},{id:'asc'}],include:{results:true}});
 let register:DefectRecord[]=[];
 const ledger=await db.cumulativeDefect.findMany({where:{cycleId,counsellorId}});
 const byParameter=new Map(ledger.map(x=>[x.parameterId,x]));
 const priorSnapshots=await db.adoptionSnapshot.findMany({where:{cycleId,counsellorId},select:{revision:true}});
 const revision=appendRevision?Math.max(-1,...priorSnapshots.map(x=>x.revision))+1:0;
 for(const audit of audits){
  const answers:Answer[]=audit.results.map(r=>({parameterId:r.parameterId,status:r.status}));
  const snap=advanceDefectRegister(register,answers);register=snap.register;
  for(const d of register){const prior=byParameter.get(d.parameterId);const saved=prior?await db.cumulativeDefect.update({where:{id:prior.id},data:{status:d.state,everRectified:d.everRectified,latestAuditId:audit.id}}):await db.cumulativeDefect.create({data:{counsellorId,cycleId,parameterId:d.parameterId,status:d.state,everRectified:d.everRectified,firstAuditId:audit.id,latestAuditId:audit.id}});byParameter.set(d.parameterId,saved);}
  for(const ev of snap.events){const defect=byParameter.get(ev.parameterId)!;await db.defectEvent.createMany({data:[{defectId:defect.id,auditId:audit.id,eventType:ev.type,auditDate:audit.auditDate,revision}],skipDuplicates:true});}
  await db.adoptionSnapshot.createMany({data:[{counsellorId,cycleId,auditId:audit.id,checkpoint:audit.stage,numerator:snap.numerator,denominator:snap.denominator,percentage:snap.percentage,newDefects:snap.newDefects,continuingDefects:snap.continuingDefects,rectifiedDefects:snap.rectifiedDefects,recurringDefects:snap.recurringDefects,revision}],skipDuplicates:true});
 }
 const currentParameters=new Set(register.map(d=>d.parameterId));
 for(const old of ledger)if(!currentParameters.has(old.parameterId))await db.cumulativeDefect.update({where:{id:old.id},data:{status:'SUPERSEDED'}});
}

/** Calculates A1–A4 from the configured audit checkpoints' cumulative snapshots. */
export async function rebuildMappedMetrics(cycleId:string,counsellorIds:string[]){
 const config=await db.auditConfiguration.findFirst({where:{key:'ADOPTION_METRIC_CHECKPOINTS'},orderBy:{version:'desc'}});
 const mapping={...PROPOSED_ADOPTION_CHECKPOINTS,...(config?.value as Partial<Record<AdoptionMetricKey,Stage>>|undefined)};
 const mappingConfirmed=Boolean(config?.confirmed);
 for(const counsellorId of [...new Set(counsellorIds)]){
  const[audits,snapshots]=await Promise.all([
   db.audit.findMany({where:{cycleId,counsellorId,isCurrent:true},orderBy:[{auditDate:'desc'},{submittedAt:'desc'},{id:'desc'}],select:{id:true,stage:true}}),
   db.adoptionSnapshot.findMany({where:{cycleId,counsellorId},orderBy:{revision:'desc'}}),
  ]);
  const metrics={} as Record<AdoptionMetricKey,ReturnType<typeof calculateCheckpointMetric>>;
  for(const key of ['A1','A2','A3','A4'] as const){const checkpoint=mapping[key]??null;const audit=checkpoint?audits.find(a=>a.stage===checkpoint):undefined;const checkpointIndex=checkpoint?STAGES.indexOf(checkpoint):-1;const sequenceReady=checkpointIndex>=0&&STAGES.slice(0,checkpointIndex+1).every(stage=>audits.some(a=>a.stage===stage));const snapshot=audit&&sequenceReady?snapshots.find(s=>s.auditId===audit.id):undefined;metrics[key]=calculateCheckpointMetric(checkpoint,snapshot?{numerator:snapshot.numerator,denominator:snapshot.denominator}:null);}
  const summary=calculatePerformanceSummary(metrics);
  const data={definitions:{mapping,mappingConfirmed,version:config?.version??0,metrics},a1Numerator:metrics.A1.numerator,a1Denominator:metrics.A1.denominator,a1Percentage:metrics.A1.percentage,a1Status:metrics.A1.status,a2Numerator:metrics.A2.numerator,a2Denominator:metrics.A2.denominator,a2Percentage:metrics.A2.percentage,a2Status:metrics.A2.status,a3Numerator:metrics.A3.numerator,a3Denominator:metrics.A3.denominator,a3Percentage:metrics.A3.percentage,a3Status:metrics.A3.status,a4Numerator:metrics.A4.numerator,a4Denominator:metrics.A4.denominator,a4Percentage:metrics.A4.percentage,a4Status:metrics.A4.status,avg1:summary.avg1,avg2:summary.avg2,delta:summary.delta,status:summary.status};
  await db.performanceMetric.upsert({where:{counsellorId_cycleId:{counsellorId,cycleId}},create:{counsellorId,cycleId,...data},update:data});
 }
}
