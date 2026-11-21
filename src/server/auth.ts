import {cookies} from 'next/headers';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {NextResponse} from 'next/server';
import {redirect} from 'next/navigation';
import type {Prisma,RoleName,Stage} from '@prisma/client';
import {db} from '@/lib/prisma';
import {canAccessCounsellor,canUploadStage as roleCanUploadStage,type Assignment} from '@/domain/access';

const SESSION_SECONDS=8*60*60;
const secret=()=>process.env.AUTH_SECRET||'';
export type SessionUser={id:string;email:string;name:string;role:RoleName;active:boolean;mustChangePassword:boolean;employeeId:string|null;phone:string|null};
export class AccessError extends Error{constructor(message:string,readonly status=403){super(message);this.name='AccessError';}}
export function accessErrorResponse(error:unknown){if(error instanceof AccessError)return NextResponse.json({error:error.message},{status:error.status});return NextResponse.json({error:error instanceof Error?error.message:'Request failed.'},{status:400});}
export async function session():Promise<SessionUser|null>{
 const value=(await cookies()).get('ls_session')?.value;
 if(!value||secret().length<32)return null;
 const [id,expires,signature]=value.split('.');
 if(!id||!expires||!signature||!/^\d+$/.test(expires)||Number(expires)<Date.now())return null;
 const expected=createHmac('sha256',secret()).update(`${id}.${expires}`).digest('hex');
 if(expected.length!==signature.length||!timingSafeEqual(Buffer.from(expected),Buffer.from(signature)))return null;
 return db.user.findUnique({where:{id},select:{id:true,email:true,name:true,role:true,active:true,mustChangePassword:true,employeeId:true,phone:true}}).then(user=>user?.active?user:null);
}
export async function requireRole(roles:RoleName[]){const user=await session();if(!user)throw new AccessError('Please sign in again.',401);if(user.mustChangePassword)throw new AccessError('Set your password before using the application.',403);if(!roles.includes(user.role))throw new AccessError('You do not have permission to perform this action.',403);return user;}
export async function requirePageRole(roles:RoleName[]){const user=await session();if(!user)redirect('/login');if(user.mustChangePassword)redirect('/change-password');if(!roles.includes(user.role))redirect('/unauthorized');return user;}
export function signSession(id:string){if(secret().length<32)throw new Error('AUTH_SECRET must contain at least 32 characters.');const expires=String(Date.now()+SESSION_SECONDS*1000),base=`${id}.${expires}`;return`${base}.${createHmac('sha256',secret()).update(base).digest('hex')}`;}
export const sessionMaxAge=SESSION_SECONDS;
export function canUploadStage(role:RoleName,stage:Stage){return roleCanUploadStage(role,stage);}

export async function assertCycleAccess(user:SessionUser,cycleId:string,mode:'VIEW'|'UPLOAD'='VIEW'){
 if(user.role==='ADMIN')return;
 if(user.role==='COUNSELLOR'&&mode==='VIEW'){
  const profile=await db.counsellor.findUnique({where:{userId:user.id},select:{id:true}});
  if(profile&&await db.cycleCounsellor.findFirst({where:{cycleId,counsellorId:profile.id,active:true},select:{id:true}}))return;
  throw new AccessError('This audit cycle is not assigned to your account.');
 }
 const assignments=await db.cycleAssignment.findMany({where:{cycleId,userId:user.id,active:true},select:{access:true,counsellorId:true,teamId:true}});
 if(!assignments.some(a=>a.counsellorId!==null||a.teamId!==null))throw new AccessError('This audit cycle is not assigned to your account.');
 if(mode==='UPLOAD'&&user.role!=='TRAINER'&&user.role!=='AUDITOR')throw new AccessError('Your role cannot upload audit data.');
 if(mode==='UPLOAD'&&!assignments.some(a=>a.access==='UPLOAD'&&a.counsellorId!==null))throw new AccessError('You do not have upload access for this cycle.');
}
export async function assertCounsellorAccess(user:SessionUser,cycleId:string,counsellorId:string,mode:'VIEW'|'UPLOAD'='VIEW'){
 if(user.role==='ADMIN')return;
 const participant=await db.cycleCounsellor.findFirst({where:{cycleId,counsellorId,active:true},select:{id:true}});
 if(!participant)throw new AccessError('This counsellor is not enrolled in the selected audit cycle.');
 if(user.role==='COUNSELLOR'){
  const profile=await db.counsellor.findUnique({where:{userId:user.id},select:{id:true}});
  if(mode==='VIEW'&&profile?.id===counsellorId)return;
  throw new AccessError('This counsellor is not assigned to your account.');
 }
 const assignments=await db.cycleAssignment.findMany({where:{cycleId,userId:user.id,active:true},select:{userId:true,cycleId:true,access:true,counsellorId:true,teamId:true,active:true}});
 const counsellor=await db.counsellor.findUnique({where:{id:counsellorId},select:{teamId:true}});
 const allowed=canAccessCounsellor(user.id,user.role,cycleId,counsellorId,counsellor?.teamId??null,assignments as Assignment[],mode);
 if(!allowed)throw new AccessError('This counsellor is not assigned to you for the selected cycle.');
 if(mode==='UPLOAD'&&user.role!=='TRAINER'&&user.role!=='AUDITOR')throw new AccessError('Your role cannot upload audit data.');
}
export async function assignedCycles(user:SessionUser){
 if(user.role==='ADMIN')return db.auditCycle.findMany({orderBy:{startsAt:'desc'}});
 if(user.role==='COUNSELLOR'){
  const profile=await db.counsellor.findUnique({where:{userId:user.id},select:{id:true}});
  const rows=profile?await db.cycleCounsellor.findMany({where:{counsellorId:profile.id},select:{cycleId:true}}):[];
  return db.auditCycle.findMany({where:{id:{in:[...new Set(rows.map(x=>x.cycleId))]}},orderBy:{startsAt:'desc'}});
 }
 if(user.role==='TRAINER'||user.role==='AUDITOR'){
  const rows=await db.audit.findMany({where:{isCurrent:true,evaluatorEmail:{equals:user.email,mode:'insensitive'}},distinct:['cycleId'],select:{cycleId:true}});
  return db.auditCycle.findMany({where:{id:{in:rows.map(x=>x.cycleId)}},orderBy:{startsAt:'desc'}});
 }
 const rows=await db.cycleAssignment.findMany({where:{userId:user.id,active:true},select:{cycleId:true}});
 return db.auditCycle.findMany({where:{OR:[{id:{in:[...new Set(rows.map(x=>x.cycleId).filter((x):x is string=>Boolean(x)))]}},{audits:{some:await auditScope(user)}}]},orderBy:{startsAt:'desc'}});
}
export async function auditScope(user:SessionUser):Promise<Prisma.AuditWhereInput>{
 if(user.role==='ADMIN')return{isCurrent:true};
 if(user.role==='COUNSELLOR'){
  const profile=await db.counsellor.findUnique({where:{userId:user.id},select:{id:true}});
  return profile?{isCurrent:true,counsellorId:profile.id,cycle:{participants:{some:{counsellorId:profile.id}}}}:{id:'__no_access__'};
 }
 if(user.role==='TRAINER'||user.role==='AUDITOR')return{isCurrent:true,evaluatorEmail:{equals:user.email,mode:'insensitive'}};
 const rows=await db.cycleAssignment.findMany({where:{userId:user.id,active:true},select:{cycleId:true,counsellorId:true,teamId:true}});
 const clauses:Prisma.AuditWhereInput[]=[];
 for(const row of rows){
  if(row.counsellorId)clauses.push({...(row.cycleId?{cycleId:row.cycleId}:{}),counsellorId:row.counsellorId});
  else if(row.teamId)clauses.push({...(row.cycleId?{cycleId:row.cycleId}:{}),counsellor:{teamId:row.teamId}});
 }
 return clauses.length?{isCurrent:true,OR:clauses}:{isCurrent:true,id:'__no_access__'};
}
export async function logAccessEvent(userId:string,action:string,entity:string,entityId:string|null,details:Prisma.InputJsonValue={}){await db.auditLog.create({data:{userId,action,entity,entityId,details}});}
