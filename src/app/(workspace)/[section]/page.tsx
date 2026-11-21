import { notFound, redirect } from 'next/navigation';
import { requirePageRole, auditScope } from '@/server/auth';
import { db } from '@/lib/prisma';
import AdoptionCheckpointConfig from '@/components/adoption-checkpoint-config';
import UserManagement from '@/components/user-management';
import TeamManager from '@/components/team-manager';
import { PROPOSED_ADOPTION_CHECKPOINTS } from '@/domain/metrics';
import FilterableTable from '@/components/filterable-table';

const labels: Record<string,string> = { counsellors:'Counsellors', reports:'Reports', settings:'Adoption settings', users:'User management', teams:'Teams' };

export default async function Section({ params }: { params: Promise<{section:string}> }) {
  const { section } = await params;
  if (section === 'assignments') redirect('/google-sheets');
  if (!labels[section]) notFound();
  const user = await requirePageRole(['ADMIN','MANAGER','TRAINER','AUDITOR','COUNSELLOR']);
  if (['settings','users','teams'].includes(section) && user.role !== 'ADMIN') redirect('/dashboard');

  if (section === 'settings') {
    const config = await db.auditConfiguration.findFirst({ where: { key:'ADOPTION_METRIC_CHECKPOINTS' }, orderBy: { version:'desc' } });
    const mapping = { ...PROPOSED_ADOPTION_CHECKPOINTS, ...(config?.value as Partial<Record<keyof typeof PROPOSED_ADOPTION_CHECKPOINTS,string>>|undefined) };
    return <div className="content"><div className="title">Adoption settings</div><p className="sub">A1–A4 checkpoint mapping is configured here. New cycles start automatically from valid Trainer submissions.</p><AdoptionCheckpointConfig canManage initial={mapping} isConfirmed={Boolean(config?.confirmed)}/></div>;
  }

  if (section === 'teams') {
    const teams = await db.team.findMany({ orderBy:{name:'asc'}, select:{id:true,name:true,head:true} });
    return <TeamManager teams={teams}/>;
  }

  if (section === 'users') {
    const [users,teams,counsellors,assignments] = await Promise.all([
      db.user.findMany({ orderBy:{name:'asc'}, select:{id:true,name:true,email:true,role:true,active:true,employeeId:true,phone:true,mustChangePassword:true} }),
      db.team.findMany({ orderBy:{name:'asc'}, select:{id:true,name:true} }),
      db.counsellor.findMany({ where:{active:true}, orderBy:{name:'asc'}, select:{id:true,name:true,email:true} }),
      db.cycleAssignment.findMany({ orderBy:{assignedAt:'desc'}, include:{cycle:{select:{name:true}},user:{select:{id:true,name:true,role:true}},counsellor:{select:{id:true,name:true}},team:{select:{id:true,name:true}}} }),
    ]);
    return <UserManagement users={users} teams={teams} counsellors={counsellors} assignments={assignments.map(a=>({...a,assignedAt:a.assignedAt.toISOString()}))}/>;
  }

  if (section === 'counsellors') {
    const auditWhere = await auditScope(user);
    let where: any = user.role === 'ADMIN' ? {} : { OR:[{audits:{some:auditWhere}},{cycleAssignments:{some:{userId:user.id,active:true}}}] };
    if (user.role === 'COUNSELLOR') {
      const profile = await db.counsellor.findUnique({ where:{userId:user.id}, select:{id:true} });
      where = profile ? {id:profile.id} : {id:'__no_access__'};
    }
    const list = await db.counsellor.findMany({ where, take:100, include:{team:true}, orderBy:{name:'asc'} });
    const counts = await Promise.all(list.map(c=>db.audit.count({where:user.role==='ADMIN'?{counsellorId:c.id,isCurrent:true}:{AND:[{counsellorId:c.id},auditWhere]}})));
    const rows=list.map((c,i)=>({id:c.id,name:c.name,email:c.email,employeeId:c.employeeId||'—',team:c.team?.name||'—',manager:c.manager||'—',active:c.active?'Active':'Inactive',audits:counts[i]}));
    return <div className="content"><div className="page-heading"><div><div className="title">{user.role==='COUNSELLOR'?'My profile':'Counsellors'}</div><p className="sub">Counsellor records in your authorized scope. New profiles can be created from valid source submissions.</p></div></div><section className="panel"><FilterableTable rows={rows} columns={[{key:'name',label:'NAME'},{key:'email',label:'OFFICIAL EMAIL'},{key:'employeeId',label:'EMPLOYEE ID'},{key:'team',label:'TEAM'},{key:'manager',label:'MANAGER'},{key:'audits',label:'AUDITS',type:'number'},{key:'active',label:'STATUS',type:'status'}]} searchKeys={['name','email','employeeId','team','manager']} filters={[{key:'team',label:'team',options:[...new Set(rows.map(r=>r.team).filter(t=>t!=='—'))].sort()},{key:'active',label:'status',options:['Active','Inactive']}]} emptyTitle="No counsellors in this scope" emptyText="Counsellor records appear after enrollment or an accepted submission." pageSize={15}/></section></div>;
  }

  const audits = await db.audit.findMany({ where:await auditScope(user), take:1000, include:{cycle:{select:{name:true}},counsellor:{select:{name:true,team:{select:{name:true}}}}}, orderBy:{auditDate:'desc'} });
  const groups = new Map<string,{cycle:string;counsellor:string;team:string|null;count:number;scoreTotal:number;scored:number;stages:Record<string,number>}>();
  for (const audit of audits) {
    const id=`${audit.cycleId}:${audit.counsellorId}`;
    const group=groups.get(id)||{cycle:audit.cycle.name,counsellor:audit.counsellor.name,team:audit.counsellor.team?.name||null,count:0,scoreTotal:0,scored:0,stages:{}};
    group.count++; group.stages[audit.stage]=(group.stages[audit.stage]||0)+1;
    if(audit.scorePercent!==null){group.scoreTotal+=Number(audit.scorePercent);group.scored++;}
    groups.set(id,group);
  }
  const reportRows=[...groups.entries()].map(([id,g])=>({id,cycle:g.cycle,counsellor:g.counsellor,team:g.team||'—',audits:g.count,T1:g.stages.T1||0,Q1:g.stages.Q1||0,Q2:g.stages.Q2||0,T2:g.stages.T2||0,Q3:g.stages.Q3||0,Q4:g.stages.Q4||0,average:g.scored?`${(g.scoreTotal/g.scored).toFixed(1)}%`:'N/A'}));
  return <div className="content"><div className="page-heading"><div><div className="title">{user.role==='COUNSELLOR'?'My audit history':'Reports'}</div><p className="sub">Audit performance within your authorized counsellor scope.</p></div></div><section className="panel"><FilterableTable rows={reportRows} columns={[{key:'cycle',label:'CYCLE'},{key:'counsellor',label:'COUNSELLOR'},{key:'team',label:'TEAM'},{key:'audits',label:'AUDITS',type:'number'},...['T1','Q1','Q2','T2','Q3','Q4'].map(stage=>({key:stage,label:stage,type:'number' as const})),{key:'average',label:'AVERAGE SCORE'}]} searchKeys={['cycle','counsellor','team']} filters={[{key:'team',label:'team',options:[...new Set(reportRows.map(row=>row.team).filter(team=>team!=='—'))].sort()},{key:'cycle',label:'cycle',options:[...new Set(reportRows.map(row=>row.cycle))].sort()}]} pageSize={15} emptyTitle="No reports in this scope" emptyText="Reports will appear when audits are accepted."/></section></div>;
}
