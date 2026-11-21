import {PrismaClient} from '@prisma/client';
import {PARAMETERS} from '../src/domain/parameters';
import {hash} from 'bcryptjs';
const db=new PrismaClient();
async function main(){for(const [id,name,maxMarks,priority] of PARAMETERS){const section=id[0]==='8'?'Fatal Errors':id[0]==='9'?'Zero Tolerance Points':`Section ${id[0]}`;await db.auditParameter.upsert({where:{id},update:{name,maxMarks,priority,section},create:{id,name,maxMarks,priority,section}});}const email=process.env.BOOTSTRAP_ADMIN_EMAIL,password=process.env.BOOTSTRAP_ADMIN_PASSWORD;if(email&&password&&password.length>=12){const passwordHash=await hash(password,12);await db.user.upsert({where:{email:email.toLowerCase()},update:{name:'Administrator',passwordHash,role:'ADMIN',active:true},create:{email:email.toLowerCase(),name:'Administrator',passwordHash,role:'ADMIN'}});console.info(`Ensured administrator account ${email.toLowerCase()}.`);}else console.warn('Admin not seeded: set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD (12+ characters).');console.info(`Seeded ${PARAMETERS.length} parameter definitions.`);}
main().finally(()=>db.$disconnect());
