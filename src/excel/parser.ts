import * as XLSX from 'xlsx';
import {createHash} from 'node:crypto';
import {PARAMETERS} from '../domain/parameters';

const norm=(s:string)=>s.toLowerCase().trim().replace(/[^a-z0-9]/g,'');
const aliases:Record<string,string[]>={
  counsellorName:['counsellor','counselor','name of counsellor','counsellor name','counselor name'],
  counsellorEmail:['counsellor email','counselor email','email','email id'],
  auditor:['audit done by','name of qa','auditor','qa name','trainer name','evaluator'],
  auditDate:['audit date','date of audit','audit date & time'],
  callDate:['call date'],callId:['call id','callid'],callLink:['call link'],
  team:['team','team head','team name','th email'],manager:['tl','reporting manager','manager','tl email'],
  liveScore:['live score','total achieved','score decimal'],totalMarks:['total marks','total applicable max'],
  callDuration:['call duration','duration'],callType:['call type'],remarks:['remarks','comments','critical feedback'],
};
export type Parsed={rowNumber:number;raw:Record<string,unknown>;mapped:Record<string,unknown>;responses:Record<string,string>;errors:string[]};
function parseDate(v:unknown){if(v instanceof Date)return v;if(typeof v==='number')return XLSX.SSF.parse_date_code(v)?new Date(XLSX.SSF.parse_date_code(v)!.y,XLSX.SSF.parse_date_code(v)!.m-1,XLSX.SSF.parse_date_code(v)!.d):new Date(NaN);const s=String(v??'').trim();const m=s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);if(m){const [,d,mo,y,h='0',mi='0',sec='0']=m;return new Date(+y,+mo-1,+d,+h,+mi,+sec);}return new Date(s);}
function status(v:unknown):string{const s=String(v??'').trim().toUpperCase().replace(/[.\s_-]/g,'');if(['PASS','P'].includes(s))return'PASS';if(['PARTIAL','PART'].includes(s))return'PARTIAL';if(['FAIL','F'].includes(s))return'FAIL';if(['NA','NOTAPPLICABLE'].includes(s))return'NA';return'';}
export function parseWorkbook(bytes:Buffer){const hash=createHash('sha256').update(bytes).digest('hex');const wb=XLSX.read(bytes,{type:'buffer',cellDates:true});const sheetName=wb.SheetNames[0],sheet=wb.Sheets[sheetName];if(!sheet)throw new Error('Workbook has no worksheet.');const matrix=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,defval:null,raw:false});if(matrix.length<2)throw new Error('Workbook must have a header and at least one data row.');
  // Audit Tracker V4 exports two header rows: descriptive names then compact IDs.
  const first=matrix[0].map(x=>String(x??'')),second=matrix[1].map(x=>String(x??''));const compact=second.some(x=>/^\d[ABCDEFGH][ _-]?(Marks|Outcome)$/i.test(x));const headers=compact?second:first,descriptive=compact?first:first;const rowsStart=compact?2:1;const rows:Parsed[]=[];
  for(let i=rowsStart;i<matrix.length;i++){const cells=matrix[i];if(!cells.some(x=>x!==null&&String(x).trim()!==''))continue;const raw:Record<string,unknown>={};headers.forEach((h,j)=>{if(h)raw[h]=cells[j]??null;if(descriptive[j]&&descriptive[j]!==h)raw[descriptive[j]]=cells[j]??null;});const mapped:Record<string,unknown>={},responses:Record<string,string>={},errors:string[]=[];const find=(names:string[])=>{const idx=headers.findIndex(h=>names.map(norm).includes(norm(h)));return idx<0?undefined:cells[idx];};for(const [field,names]of Object.entries(aliases)){const value=find([field,...names]);if(value!==undefined&&value!==null&&String(value).trim()!=='')mapped[field]=value;}
    // Raw Response is the canonical source of parameter statuses in this export.
    const rawResponse=find(['Raw Response (JSON)']);let payload:any=null;if(rawResponse){try{payload=typeof rawResponse==='string'?JSON.parse(rawResponse):rawResponse;}catch{errors.push('Raw Response (JSON) is not valid JSON.');}}
    const params=payload?.params&&typeof payload.params==='object'?payload.params:{};for(const [id]of PARAMETERS){let value=params[id];if(value===undefined){const ix=headers.findIndex(h=>norm(h)===norm(`${id} Outcome`));if(ix>=0)value=cells[ix];}if(value===undefined&&payload?.fatals&&id.startsWith('8')){const v=payload.fatals[id];if(typeof v==='boolean')value=v?'Fail':'Pass';}if(value===undefined&&payload?.ztps&&id.startsWith('9')){const v=payload.ztps[id];if(typeof v==='boolean')value=v?'Fail':'Pass';}if(value===undefined||value===null||String(value).trim()==='')continue;const normalized=status(value);if(!normalized)errors.push(`${id}: invalid evaluation value.`);else responses[id]=normalized;}
    const email=String(mapped.counsellorEmail??'').trim();if(!mapped.counsellorName)errors.push('Missing required field: counsellor name.');if(!email)errors.push('Missing required field: counsellor email.');else if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))errors.push('Invalid counsellor email.');if(!mapped.auditor)errors.push('Missing required field: evaluator / auditor.');const auditDate=parseDate(mapped.auditDate);if(!mapped.auditDate||Number.isNaN(auditDate.getTime()))errors.push('Missing or invalid audit date.');else mapped.auditDate=auditDate.toISOString();if(mapped.callDate){const cd=parseDate(mapped.callDate);if(Number.isNaN(cd.getTime()))errors.push('Invalid call date.');else mapped.callDate=cd.toISOString();}if(!Object.keys(responses).length)errors.push('No valid parameter responses found. Expected Outcome columns or a Raw Response (JSON) column.');rows.push({rowNumber:i+1,raw,mapped,responses,errors});}
  return{hash,rows,headers,sheet:sheetName};}
