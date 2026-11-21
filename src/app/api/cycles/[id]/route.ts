import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/prisma';
import { requireRole, accessErrorResponse } from '@/server/auth';

const schema = z.object({ name:z.string().trim().min(2).max(100).optional(), startsAt:z.string().date().optional(), endsAt:z.string().date().optional(), status:z.enum(['DRAFT','ACTIVE','IN_PROGRESS','COMPLETED','CLOSED']).optional(), reason:z.string().trim().max(500).optional() });

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}) {
  try {
    const admin=await requireRole(['ADMIN']),{id}=await params,input=schema.parse(await request.json());
    const prior=await db.auditCycle.findUnique({where:{id}});
    if(!prior)return NextResponse.json({error:'Cycle not found.'},{status:404});
    if(prior.counsellorId)return NextResponse.json({error:'Automatic counsellor cycles are controlled by synchronized submissions and cannot be manually edited.'},{status:409});
    if((prior.status==='CLOSED'||prior.status==='COMPLETED')&&input.status&&input.status!==prior.status&&!(input.status==='ACTIVE'&&input.reason?.trim()))return NextResponse.json({error:'A completed or closed legacy cycle can only be reopened as ACTIVE with a recorded reason.'},{status:400});
    const startsAt=input.startsAt?new Date(`${input.startsAt}T00:00:00.000Z`):prior.startsAt;
    const endsAt=input.endsAt?new Date(`${input.endsAt}T23:59:59.999Z`):prior.endsAt;
    if(endsAt&&endsAt<startsAt)return NextResponse.json({error:'End date must be on or after start date.'},{status:400});
    const cycle=await db.auditCycle.update({where:{id},data:{...(input.name?{name:input.name}:{}),...(input.startsAt?{startsAt}:{}),...(input.endsAt?{endsAt}:{}),...(input.status?{status:input.status}:{})}});
    await db.auditLog.create({data:{userId:admin.id,action:input.status==='ACTIVE'&&prior.status!=='ACTIVE'?'CYCLE_REOPENED':'CYCLE_UPDATED',entity:'AuditCycle',entityId:id,details:{from:prior.status,to:cycle.status,reason:input.reason||null,changes:input}}});
    return NextResponse.json({ok:true,status:cycle.status});
  } catch(error) { return accessErrorResponse(error); }
}
