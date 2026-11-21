export type Role='ADMIN'|'TRAINER'|'AUDITOR'|'COUNSELLOR'|'MANAGER';
export type Stage='T1'|'Q1'|'Q2'|'T2'|'Q3'|'Q4';
export type Assignment={userId:string|null;cycleId:string;counsellorId:string|null;teamId:string|null;access:'VIEW'|'UPLOAD';active?:boolean};
export function canUploadStage(role:Role,stage:Stage){return (role==='TRAINER'&&(stage==='T1'||stage==='T2'))||(role==='AUDITOR'&&(stage==='Q1'||stage==='Q2'||stage==='Q3'||stage==='Q4'));}
export function canAccessCounsellor(userId:string,role:Role,cycleId:string,counsellorId:string,teamId:string|null,assignments:Assignment[],mode:'VIEW'|'UPLOAD'='VIEW',ownCounsellorId?:string|null){
 if(role==='ADMIN')return true;
 if(role==='COUNSELLOR')return mode==='VIEW'&&ownCounsellorId===counsellorId;
 if(mode==='UPLOAD'&&role!=='TRAINER'&&role!=='AUDITOR')return false;
 return assignments.some(a=>a.active!==false&&a.userId===userId&&a.cycleId===cycleId&&(a.counsellorId===counsellorId||(role==='MANAGER'&&a.teamId!==null&&a.teamId===teamId))&&(mode==='VIEW'||a.access==='UPLOAD'));
}
export function scopedCounsellors(userId:string,role:Role,cycleId:string,assignments:Assignment[]){if(role==='ADMIN')return null;return assignments.filter(a=>a.userId===userId&&a.cycleId===cycleId).map(a=>a.counsellorId).filter((x):x is string=>Boolean(x));}
