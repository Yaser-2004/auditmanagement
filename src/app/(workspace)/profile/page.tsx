import { requirePageRole } from '@/server/auth';
import { db } from '@/lib/prisma';

export default async function Profile() {
  const user=await requirePageRole(['ADMIN','MANAGER','TRAINER','AUDITOR','COUNSELLOR']);
  const [assignments,enrollments,allCycles,profile,ownedAudits]=await Promise.all([
    db.cycleAssignment.findMany({where:{userId:user.id},include:{cycle:true,counsellor:{select:{name:true}},team:{select:{name:true}}},orderBy:{assignedAt:'desc'}}),
    user.role==='COUNSELLOR'?db.cycleCounsellor.findMany({where:{counsellor:{userId:user.id}},include:{cycle:true,counsellor:{select:{name:true}}},orderBy:{enrolledAt:'desc'}}):Promise.resolve([]),
    user.role==='ADMIN'?db.auditCycle.findMany({orderBy:{startsAt:'desc'}}):Promise.resolve([]),
    user.role==='COUNSELLOR'?db.counsellor.findUnique({where:{userId:user.id},select:{employeeId:true,team:{select:{name:true}},manager:true}}):Promise.resolve(null),
    user.role==='TRAINER'||user.role==='AUDITOR'?db.audit.findMany({where:{evaluatorEmail:{equals:user.email,mode:'insensitive'},isCurrent:true},distinct:['cycleId'],include:{cycle:true},orderBy:{auditDate:'desc'}}):Promise.resolve([]),
  ]);
  return <div className="content"><div className="title">My profile</div><section className="panel"><div><b>{user.name}</b></div><p className="sub">{user.email} · {user.role}{user.employeeId?` · Employee ID ${user.employeeId}`:''}</p>{profile&&<p className="sub">{profile.team?.name||'No team'}{profile.manager?` · Reports to ${profile.manager}`:''}</p>}<div className="panel-title">Assigned cycles and access</div>{user.role==='ADMIN'&&<p className="sub">Administrator access applies to all cycles and counsellors.</p>}{user.role==='COUNSELLOR'&&enrollments.length>0&&<div className="overflow"><table className="table"><thead><tr><th>CYCLE</th><th>STATUS</th><th>COUNSELLOR</th><th>ENROLLMENT</th></tr></thead><tbody>{enrollments.map(a=><tr key={a.id}><td>{a.cycle.name}</td><td>{a.active?a.cycle.status:'Participation ended'}</td><td>{a.counsellor.name}</td><td>{a.active?'Active':'Historical'}</td></tr>)}</tbody></table></div>}
  {ownedAudits.length>0&&<div className="overflow"><table className="table"><thead><tr><th>CYCLE</th><th>STATUS</th><th>SUBMITTED AS</th><th>STAGE</th><th>DATE</th></tr></thead><tbody>{ownedAudits.map(a=><tr key={a.id}><td>{a.cycle.name}</td><td>{a.cycle.status}</td><td>{a.evaluatorRole||user.role}</td><td>{a.stage}</td><td>{a.auditDate.toLocaleDateString()}</td></tr>)}</tbody></table></div>}
  {assignments.length>0&&<div className="overflow"><table className="table"><thead><tr><th>CYCLE SCOPE</th><th>STATUS</th><th>COUNSELLOR</th><th>TEAM</th><th>ACCESS</th><th>ASSIGNMENT</th></tr></thead><tbody>{assignments.map(a=><tr key={a.id}><td>{a.cycle?.name||'All automatic cycles'}</td><td>{a.cycle?.status||'Scope-wide'}</td><td>{a.counsellor?.name||'All in scope'}</td><td>{a.team?.name||'—'}</td><td>{a.access}</td><td>{a.active?'Current':'Ended'}</td></tr>)}</tbody></table></div>}
  {!assignments.length&&!enrollments.length&&!ownedAudits.length&&user.role!=='ADMIN'&&<p className="sub">No audit cycles or submissions are currently associated with your account.</p>}{allCycles.length>0&&<p className="sub">Cycles in the system: {allCycles.map(x=>`${x.name} (${x.status})`).join(' · ')}</p>}</section></div>;
}
