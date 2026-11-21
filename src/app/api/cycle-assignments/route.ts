import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/prisma';
import { requireRole, accessErrorResponse } from '@/server/auth';

const schema = z.object({
  cycleId: z.string().optional(), userId: z.string().min(1), counsellorId: z.string().optional(),
  teamId: z.string().optional(), access: z.enum(['VIEW', 'UPLOAD']).default('VIEW'),
});

export async function POST(req: Request) {
  try {
    const admin = await requireRole(['ADMIN']);
    const input = schema.parse(await req.json());
    const [cycle, user, counsellor, team] = await Promise.all([
      input.cycleId ? db.auditCycle.findUnique({ where: { id: input.cycleId } }) : null,
      db.user.findUnique({ where: { id: input.userId } }),
      input.counsellorId ? db.counsellor.findUnique({ where: { id: input.counsellorId } }) : null,
      input.teamId ? db.team.findUnique({ where: { id: input.teamId } }) : null,
    ]);
    if ((input.cycleId && !cycle) || !user || (input.counsellorId && !counsellor) || (input.teamId && !team)) return NextResponse.json({ error: 'Cycle, user, counsellor or team was not found.' }, { status: 404 });
    if (!user.active) return NextResponse.json({ error: 'Only active users can be assigned.' }, { status: 400 });
    if (user.role !== 'MANAGER' || input.access !== 'VIEW' || (!input.counsellorId && !input.teamId)) return NextResponse.json({ error: 'Only managers may receive view-only access to a counsellor or team. Trainer and QA records are scoped to the registered evaluator email.' }, { status: 400 });
    if (input.teamId && input.counsellorId) return NextResponse.json({ error: 'Choose either a counsellor or a team for this manager assignment.' }, { status: 400 });
    const assignment = await db.$transaction(async tx => {
      const same = await tx.cycleAssignment.findFirst({ where: { cycleId: input.cycleId ?? null, userId: user.id, counsellorId: input.counsellorId ?? null, teamId: input.teamId ?? null, active: true } });
      if (same) throw new Error('That active cycle assignment already exists.');
      const created = await tx.cycleAssignment.create({ data: { cycleId: input.cycleId || null, userId: user.id, counsellorId: input.counsellorId || null, teamId: input.teamId || null, access: input.access, assignedById: admin.id } });
      await tx.auditLog.create({ data: { userId: admin.id, action: 'MANAGER_VIEW_SCOPE_CREATED', entity: 'CycleAssignment', entityId: created.id, details: { ...input, role: user.role } } });
      return created;
    });
    return NextResponse.json({ id: assignment.id }, { status: 201 });
  } catch (e) { return accessErrorResponse(e); }
}

export async function DELETE(req: Request) {
  try {
    const admin = await requireRole(['ADMIN']);
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Assignment id is required.' }, { status: 400 });
    const assignment = await db.cycleAssignment.update({ where: { id }, data: { active: false, endedAt: new Date() } });
    await db.auditLog.create({ data: { userId: admin.id, action: 'CYCLE_ASSIGNMENT_REMOVED', entity: 'CycleAssignment', entityId: id, details: { cycleId: assignment.cycleId, userId: assignment.userId, counsellorId: assignment.counsellorId, teamId: assignment.teamId, historicalAssignmentPreserved: true } } });
    return NextResponse.json({ ok: true });
  } catch (e) { return accessErrorResponse(e); }
}
