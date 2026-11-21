import { requirePageRole } from '@/server/auth';
import { db } from '@/lib/prisma';

export default async function LegacyImports() {
  const user = await requirePageRole(['ADMIN','TRAINER','AUDITOR']);
  const imports = await db.auditImport.findMany({ where:user.role==='ADMIN'?{}:{userId:user.id}, take:100, orderBy:{createdAt:'desc'}, include:{user:{select:{name:true,email:true}},cycle:{select:{name:true}}} });
  return <div className="content"><div className="title">Legacy Excel import history</div><div className="notice">Manual Excel uploads are disabled. New evaluations arrive from the configured Google Sheet. Existing import history is retained for reference.</div><section className="panel" style={{marginTop:16}}><div className="panel-title">Historical imports</div>{imports.length?<div className="overflow"><table className="table"><thead><tr>{user.role==='ADMIN'&&<th>UPLOADER</th>}<th>FILE</th><th>CYCLE</th><th>STAGE</th><th>STATUS</th><th>ROWS</th><th>IMPORTED</th><th>REJECTED</th><th>DATE</th></tr></thead><tbody>{imports.map(i=><tr key={i.id}>{user.role==='ADMIN'&&<td>{i.user.name}</td>}<td>{i.fileName}</td><td>{i.cycle.name}</td><td>{i.stage}</td><td>{i.status}</td><td>{i.totalRows}</td><td>{i.successRows}</td><td>{i.failedRows}</td><td>{i.createdAt.toLocaleDateString()}</td></tr>)}</tbody></table></div>:<p className="sub">No legacy imports.</p>}</section></div>;
}
