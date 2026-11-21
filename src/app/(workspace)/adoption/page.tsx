import {requirePageRole,auditScope} from '@/server/auth';
import {db} from '@/lib/prisma';
import {rebuildMappedMetrics} from '@/server/cumulative-defects';
import {PROPOSED_ADOPTION_CHECKPOINTS} from '@/domain/metrics';
import FilterableTable, { type GridRow } from '@/components/filterable-table';

const metricKeys=['A1','A2','A3','A4'] as const;
const metricFields={A1:['a1Numerator','a1Denominator','a1Percentage','a1Status'],A2:['a2Numerator','a2Denominator','a2Percentage','a2Status'],A3:['a3Numerator','a3Denominator','a3Percentage','a3Status'],A4:['a4Numerator','a4Denominator','a4Percentage','a4Status']} as const;
function metricValue(row:any,key:typeof metricKeys[number]){const[n,d,p,s]=metricFields[key];return{numerator:row[n] as number|null,denominator:row[d] as number|null,percentage:row[p]===null?null:Number(row[p]),status:row[s] as string};}
function showMetric(value:ReturnType<typeof metricValue>){if(value.status==='CALCULATED')return`${value.percentage?.toFixed(1)}%`;if(value.status==='NO_DEFECTS')return'N/A (0/0 defects)';if(value.status==='CHECKPOINT_NOT_REACHED')return'Awaiting checkpoint';return'Not configured';}
function showCount(value:ReturnType<typeof metricValue>){return value.numerator===null||value.denominator===null?'—':`${value.numerator} / ${value.denominator}`;}
function showSummary(value:any,a:ReturnType<typeof metricValue>,b:ReturnType<typeof metricValue>){if(value!==null)return`${Number(value).toFixed(1)}%`;if(a.status==='CHECKPOINT_NOT_REACHED'||b.status==='CHECKPOINT_NOT_REACHED')return'Awaiting checkpoint';if(a.status==='NO_DEFECTS'||b.status==='NO_DEFECTS')return'N/A (no defects)';return'—';}

export default async function Adoption(){
 const user=await requirePageRole(['ADMIN','MANAGER','COUNSELLOR']);
 // Existing imports may predate this calculation service, so refresh the derived rows without changing snapshots.
 const[ audits,assignments ]=await Promise.all([db.audit.findMany({where:await auditScope(user),select:{cycleId:true,counsellorId:true}}),user.role==='ADMIN'?Promise.resolve([]):db.cycleAssignment.findMany({where:{userId:user.id},select:{cycleId:true,counsellorId:true,teamId:true}})]);
 const groups=new Map<string,{cycleId:string;counsellorId:string}>();
 for(const audit of audits)groups.set(`${audit.cycleId}:${audit.counsellorId}`,audit);
 for(const assignment of assignments){if(!assignment.cycleId)continue;if(assignment.counsellorId)groups.set(`${assignment.cycleId}:${assignment.counsellorId}`,{cycleId:assignment.cycleId,counsellorId:assignment.counsellorId});if(assignment.teamId){const teamCounsellors=await db.counsellor.findMany({where:{teamId:assignment.teamId},select:{id:true}});for(const counsellor of teamCounsellors)groups.set(`${assignment.cycleId}:${counsellor.id}`,{cycleId:assignment.cycleId,counsellorId:counsellor.id});}}
 for(const group of groups.values())await rebuildMappedMetrics(group.cycleId,[group.counsellorId]);
 const pairs=[...groups.values()].map(g=>({cycleId:g.cycleId,counsellorId:g.counsellorId}));
 const scoped= user.role==='ADMIN'?{}:pairs.length?{OR:pairs}:{id:'__no_access__'};
 const[defects,snapshots,metrics,config,counsellors,cycles]=await Promise.all([
  db.cumulativeDefect.findMany({where:{AND:[scoped,{status:{not:"SUPERSEDED"}}]},take:300,include:{counsellor:true,cycle:true},orderBy:{updatedAt:'desc'}}),
  db.adoptionSnapshot.findMany({where:scoped,take:200,include:{counsellor:true,cycle:true},orderBy:{createdAt:'desc'}}),
  db.performanceMetric.findMany({where:scoped,take:200,orderBy:{createdAt:'desc'}}),
  db.auditConfiguration.findFirst({where:{key:'ADOPTION_METRIC_CHECKPOINTS'},orderBy:{version:'desc'}}),
  db.counsellor.findMany({select:{id:true,name:true}}),
  db.auditCycle.findMany({select:{id:true,name:true}}),
 ]);
 const counsellorNames=new Map(counsellors.map(x=>[x.id,x.name]));
 const cycleNames=new Map(cycles.map(x=>[x.id,x.name]));
 const mapping={...PROPOSED_ADOPTION_CHECKPOINTS,...(config?.value as Partial<Record<typeof metricKeys[number],string>>|undefined)};
 const confirmed=Boolean(config?.confirmed);
 const adoptionRows:GridRow[]=metrics.map(row=>{
  const values=Object.fromEntries(metricKeys.map(k=>[k,metricValue(row,k)])) as Record<typeof metricKeys[number],ReturnType<typeof metricValue>>;
  const summary=(value:any,a:ReturnType<typeof metricValue>,b:ReturnType<typeof metricValue>)=>showSummary(value,a,b);
  const delta=row.delta===null?showSummary(null,values.A1,values.A2)==='Awaiting checkpoint'||showSummary(null,values.A3,values.A4)==='Awaiting checkpoint'?'Awaiting checkpoint':showSummary(null,values.A1,values.A2)==='N/A (no defects)'||showSummary(null,values.A3,values.A4)==='N/A (no defects)'?'N/A (no defects)':'—':`${Number(row.delta)>0?'+':''}${Number(row.delta).toFixed(1)} pp`;
  return {id:row.id,href:`/adoption/${row.counsellorId}/${row.cycleId}`,counsellor:counsellorNames.get(row.counsellorId)||row.counsellorId,cycle:cycleNames.get(row.cycleId)||row.cycleId,A1:showMetric(values.A1),A1Count:showCount(values.A1),A2:showMetric(values.A2),A2Count:showCount(values.A2),Avg1:summary(row.avg1,values.A1,values.A2),A3:showMetric(values.A3),A3Count:showCount(values.A3),A4:showMetric(values.A4),A4Count:showCount(values.A4),Avg2:summary(row.avg2,values.A3,values.A4),Delta:delta};
 });
 return <div className="content">
  <div className="title">Adoption Analysis</div>
  <p className="sub">A1–A4 show cumulative adoption at the configured checkpoint for each counsellor and cycle. Checkpoint snapshots remain historical records.</p>
  <div className="notice">{confirmed?'Official mapping':'Proposed mapping (pending business confirmation)'}: {metricKeys.map(k=>`${k} → ${mapping[k]||'Unassigned'}`).join(' · ')}. Change the mapping in Settings.</div>
  <section className="panel" style={{marginTop:16}}>
   <div className="panel-title">Adoption metrics by counsellor and cycle</div>
   <div className="panel-sub">Each A value shows rectified unique defects / total unique defects at its configured checkpoint. Zero defects are N/A; checkpoints not yet reached remain pending.</div>
   <FilterableTable rows={adoptionRows} columns={[{key:'counsellor',label:'COUNSELLOR'},{key:'cycle',label:'CYCLE'},{key:'A1',label:`A1 · ${mapping.A1}`,type:'status'},{key:'A1Count',label:'A1 COUNT'},{key:'A2',label:`A2 · ${mapping.A2}`,type:'status'},{key:'A2Count',label:'A2 COUNT'},{key:'Avg1',label:'AVG1'},{key:'A3',label:`A3 · ${mapping.A3}`,type:'status'},{key:'A3Count',label:'A3 COUNT'},{key:'A4',label:`A4 · ${mapping.A4}`,type:'status'},{key:'A4Count',label:'A4 COUNT'},{key:'Avg2',label:'AVG2'},{key:'Delta',label:'DELTA'}]} searchKeys={['counsellor','cycle']} filters={[{key:'cycle',label:'cycle',options:[...new Set(adoptionRows.map(r=>String(r.cycle??'')))].sort()}]} emptyTitle="No adoption metrics" emptyText="Metrics appear once the configured checkpoints have been reached." pageSize={10}/>
   {!metrics.length&&<p className="sub">Adoption metrics will appear after audits are imported.</p>}
   <p className="sub">Avg1 = (A1 + A2) / 2 · Avg2 = (A3 + A4) / 2 · Delta = Avg2 − Avg1. Summary values appear only when both component metrics are calculable.</p>
  </section>
  <section className="panel" style={{marginTop:16}}><div className="panel-title">Current defect register</div><FilterableTable rows={defects.map(d=>({id:d.id,counsellor:d.counsellor.name,cycle:d.cycle.name,parameterId:d.parameterId,status:d.status,everRectified:d.everRectified?'Yes':'No',firstAuditId:d.firstAuditId,latestAuditId:d.latestAuditId}))} columns={[{key:'counsellor',label:'COUNSELLOR'},{key:'cycle',label:'CYCLE'},{key:'parameterId',label:'PARAMETER ID'},{key:'status',label:'CURRENT STATUS',type:'status'},{key:'everRectified',label:'EVER RECTIFIED'},{key:'firstAuditId',label:'FIRST AUDIT'},{key:'latestAuditId',label:'LATEST AUDIT'}]} searchKeys={['counsellor','cycle','parameterId','status']} filters={[{key:'cycle',label:'cycle',options:[...new Set(defects.map(d=>d.cycle.name))].sort()},{key:'status',label:'status',options:[...new Set(defects.map(d=>d.status))].sort()}]} pageSize={10} emptyTitle="No defects identified" emptyText="The current register will appear as audits identify defects."/></section>
  <section className="panel" style={{marginTop:16}}><div className="panel-title">Historical audit checkpoints</div><FilterableTable rows={snapshots.map(s=>({id:s.id,date:s.createdAt.toISOString(),counsellor:s.counsellor.name,cycle:s.cycle.name,checkpoint:s.checkpoint,revision:s.revision,newDefects:s.newDefects,continuing:s.continuingDefects,rectified:s.rectifiedDefects,recurring:s.recurringDefects,uniqueTotal:s.denominator,adoption:s.percentage===null?'N/A':`${s.percentage}% (${s.numerator}/${s.denominator})`}))} columns={[{key:'date',label:'DATE SAVED',type:'date'},{key:'counsellor',label:'COUNSELLOR'},{key:'cycle',label:'CYCLE'},{key:'checkpoint',label:'CHECKPOINT',type:'status'},{key:'revision',label:'REVISION',type:'number'},{key:'newDefects',label:'NEW',type:'number'},{key:'continuing',label:'CONTINUING',type:'number'},{key:'rectified',label:'RECTIFIED',type:'number'},{key:'recurring',label:'RECURRING',type:'number'},{key:'uniqueTotal',label:'UNIQUE TOTAL',type:'number'},{key:'adoption',label:'CUMULATIVE ADOPTION'}]} searchKeys={['counsellor','cycle','checkpoint']} filters={[{key:'checkpoint',label:'checkpoint',options:['T1','Q1','Q2','T2','Q3','Q4']},{key:'cycle',label:'cycle',options:[...new Set(snapshots.map(s=>s.cycle.name))].sort()}]} dateKey="date" pageSize={10} emptyTitle="No checkpoint history" emptyText="Historical snapshots appear as audits are processed."/></section>
 </div>;
}
