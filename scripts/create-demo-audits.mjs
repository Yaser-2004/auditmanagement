import * as XLSX from 'xlsx';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const out=join(process.cwd(),'test-workbooks');
const meta=['Audit Date & Time','Auditor Role','Evaluator','Counsellor Name','Counsellor Email','TL Email','TH Email','Call Date','Call Duration','Call Type','Second Voice Seen','Organic Source','Pitched University','Suitable Program','Suitable Specialization','Pitched Program','Pitched Specialization','Learner Experience','Call ID','Call Link','Critical Feedback'];
const ids=['1A','1B','1C','1D','1E','2A','2B','2C','2D','2E','2F','3A','3B','3C','3D','3E','3F','4A','4B','4C','4D','4E','4F','5A','5B','5C','5D','5E','6A','6B','6C','6D','6E','6F','7A','7B','7C','7D','7E','7F'];
const fatal=['8A','8B','8C','8D'],ztp=['9A','9B','9C'];
const stages=[
 {stage:'T1',date:'12/10/2026 10:00:00',role:'Trainer',call:'DEMO-T1-001',params:{'1A':'fail','3A':'fail','1B':'partial','1E':'na'}},
 {stage:'Q1',date:'13/10/2026 10:00:00',role:'QA',call:'DEMO-Q1-001',params:{'1A':'pass','3A':'pass','1B':'partial','1E':'na'}},
 {stage:'Q2',date:'15/10/2026 10:00:00',role:'QA',call:'DEMO-Q2-001',params:{'1A':'fail','3A':'fail','1B':'pass'}},
 {stage:'T2',date:'19/10/2026 10:00:00',role:'Trainer',call:'DEMO-T2-001',params:{'1A':'fail','3A':'pass','4A':'fail'}},
 {stage:'Q3',date:'20/10/2026 10:00:00',role:'QA',call:'DEMO-Q3-001',params:{'1A':'pass','3A':'pass','4A':'fail'}},
 {stage:'Q4',date:'22/10/2026 10:00:00',role:'QA',call:'DEMO-Q4-001',params:{'1A':'fail','3A':'pass','4A':'pass'}},
];
const compact=[...meta,...ids.map(x=>`${x} Marks`),...fatal.map(x=>`${x} Outcome`),...ztp.map(x=>`${x} Outcome`),...ids.map(x=>`${x} Outcome`),'Total Achieved','Total Applicable Max','Score (Decimal)','Remarks','Defect Codes','Adoption %','Audit ID','Dispute Status','Revised Score (Decimal)','Raw Response (JSON)','Errors & Suggestions'];
const descriptive=[...meta,...ids.map(x=>`${x} - Marks`),...fatal.map(x=>`${x} - Outcome`),...ztp.map(x=>`${x} - Outcome`),...ids.map(x=>`${x} - Outcome`),'Total Achieved','Total Applicable Max','Score (Decimal)','Remarks','Defect Codes','Adoption %','Audit ID','Dispute Status','Revised Score (Decimal)','Raw Response (JSON)','Errors & Suggestions'];
function makeRow(s){const params=s.params,fatals=Object.fromEntries(fatal.map(x=>[x,false])),ztps=Object.fromEntries(ztp.map(x=>[x,false]));const raw=JSON.stringify({params,fatals,ztps,notes:{}});const data=[s.date,s.role,s.role==='Trainer'?'Demo Trainer':'Demo QA','Alex Demo','alex.demo@example.com','teamlead@example.com','teamhead@example.com',s.date.slice(0,10),'00:10:00','Outbound','No','Demo','Demo University','MBA','Management','MBA','Management','Experienced',s.call,'',''];const markValues=ids.map(id=>params[id]==='pass'?'1':params[id]==='partial'?'0':params[id]==='fail'?'0':'N-A');data.push(...markValues,...fatal.map(()=>'Pass'),...ztp.map(()=>'Pass'),...ids.map(id=>{const v=params[id];return v==='na'?'N-A':v?v[0].toUpperCase()+v.slice(1):null;}),null,null,null,'Demo training record',null,null,s.call,null,null,raw,null);return data;}
await mkdir(out,{recursive:true});
for(const s of stages){const wb=XLSX.utils.book_new();const ws=XLSX.utils.aoa_to_sheet([descriptive,compact,makeRow(s)]);XLSX.utils.book_append_sheet(wb,ws,'MainSheet');const bytes=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});await writeFile(join(out,`demo-${s.stage.toLowerCase()}.xlsx`),bytes);}
console.log(`Created ${stages.length} stage-specific demo workbooks in ${out}`);
