import { createHash } from 'node:crypto';
import { PARAMETERS, type Stage, type Status } from '../../domain/parameters';

export type EvaluatorRole = 'TRAINER' | 'QA';
export type SheetSubmission = {
  auditId: string;
  sourceRowReference: string;
  auditDate: Date | null;
  roleText: string;
  role: EvaluatorRole | null;
  evaluatorName: string;
  evaluatorEmail: string;
  counsellorName: string;
  counsellorEmail: string;
  callId: string | null;
  callDate: Date | null;
  callLink: string | null;
  callDuration: string | null;
  callType: string | null;
  stageText: string | null;
  responses: Record<string, Status>;
  errors: string[];
  raw: Record<string, unknown>;
  hash: string;
};

const compact = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const fieldAliases: Record<string, string[]> = {
  auditId: ['Audit ID', 'Source Audit ID'],
  auditDate: ['Audit Date & Time', 'Audit Date', 'Timestamp'],
  role: ['Auditor Role', 'Evaluator Role'],
  evaluatorName: ['Evaluator', 'Evaluator Name', 'Auditor'],
  evaluatorEmail: ['Evaluator Email', 'Email Address', 'Evaluator Work Email'],
  counsellorName: ['Counsellor Name', 'Counselor Name'],
  counsellorEmail: ['Counsellor Email', 'Counselor Email'],
  callId: ['Call ID'],
  callDate: ['Call Date'],
  callLink: ['Call Link'],
  callDuration: ['Call Duration'],
  callType: ['Call Type'],
  stage: ['Audit Stage', 'Stage'],
};

export function googleSheetHeaderRowIndex(rows: unknown[][]): number {
  const candidates = rows.slice(0, 6).map((row, index) => ({
    row,
    index,
    keys: new Set(row.map(compact)),
  })).filter(x => [...fieldAliases.auditId].some(k => x.keys.has(compact(k))) && [...fieldAliases.counsellorEmail].some(k => x.keys.has(compact(k))));
  if (!candidates.length) throw new Error('Could not find a header row containing Audit ID and Counsellor Email.');
  const score = (row: unknown[]) => row.filter(v => /^\d+[a-z]\s*(marks|outcome)$/i.test(String(v ?? '').trim())).length;
  return candidates.sort((a, b) => score(b.row) - score(a.row) || a.index - b.index)[0].index;
}

function dateValue(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const text = String(value ?? '').trim();
  if (!text) return null;
  const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(?:\s*(AM|PM))?)?$/i);
  if (dmy) {
    let hour = Number(dmy[4] ?? 0);
    const ampm = dmy[8]?.toUpperCase();
    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
    const result = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]), hour, Number(dmy[5] ?? 0), Number(dmy[6] ?? 0));
    return Number.isNaN(result.getTime()) ? null : result;
  }
  const result = new Date(text);
  return Number.isNaN(result.getTime()) ? null : result;
}

export function normalizeEvaluatorRole(value: unknown): EvaluatorRole | null {
  const role = compact(value);
  if (['trainer', 'traineraudit', 'trainerinteraction'].includes(role)) return 'TRAINER';
  if (['qa', 'quality', 'qualityaudit', 'qaauditor', 'qualityauditor'].includes(role)) return 'QA';
  return null;
}

function normalizeStatus(value: unknown): Status | null {
  const status = compact(value);
  if (['pass', 'p'].includes(status)) return 'PASS';
  if (['partial', 'part'].includes(status)) return 'PARTIAL';
  if (['fail', 'f'].includes(status)) return 'FAIL';
  if (['na', 'notapplicable'].includes(status)) return 'NA';
  return null;
}

function cell(row: unknown[], headers: string[], aliases: string[]): unknown {
  const wanted = new Set(aliases.map(compact));
  const index = headers.findIndex(header => wanted.has(compact(header)));
  return index < 0 ? undefined : row[index];
}

export function parseGoogleSheetValues(values: unknown[][], options: { sourceDataStartRow?: number; sourceStartRow?: number } = {}): { sheetHeaderRow: number; rows: SheetSubmission[] } {
  const headerRowIndex = googleSheetHeaderRowIndex(values);
  const headers = values[headerRowIndex].map(v => String(v ?? '').trim());
  const sourceDataStartRow = options.sourceDataStartRow ?? (options.sourceStartRow ?? 1) + headerRowIndex + 1;
  const rows: SheetSubmission[] = [];
  for (let i = headerRowIndex + 1; i < values.length; i++) {
    const cells = values[i];
    if (!cells?.some(value => value !== null && String(value).trim() !== '')) continue;
    const raw: Record<string, unknown> = {};
    headers.forEach((header, column) => { if (header) raw[header] = cells[column] ?? null; });
    const get = (name: keyof typeof fieldAliases) => cell(cells, headers, fieldAliases[name]);
    const errors: string[] = [];
    const auditId = String(get('auditId') ?? '').trim();
    const auditDate = dateValue(get('auditDate'));
    const roleText = String(get('role') ?? '').trim();
    const role = normalizeEvaluatorRole(roleText);
    const evaluatorName = String(get('evaluatorName') ?? '').trim();
    const evaluatorEmail = String(get('evaluatorEmail') ?? '').trim().toLowerCase();
    const counsellorName = String(get('counsellorName') ?? '').trim();
    const counsellorEmail = String(get('counsellorEmail') ?? '').trim().toLowerCase();
    const callDate = dateValue(get('callDate'));
    if (!auditId) errors.push('Audit ID is required.');
    if (!auditDate) errors.push('Audit Date & Time is missing or invalid.');
    if (!role) errors.push(`Auditor Role “${roleText || '(blank)'}” is not Trainer or QA.`);
    if (!evaluatorName) errors.push('Evaluator is required.');
    // Evaluator email is optional for now; cycle ownership is resolved only by counsellor email.
    if (!counsellorName) errors.push('Counsellor Name is required.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(counsellorEmail)) errors.push('A valid Counsellor Email is required.');
    const rawResponse = cell(cells, headers, ['Raw Response (JSON)']);
    let sourcePayload: any = null;
    if (rawResponse !== undefined && rawResponse !== null && String(rawResponse).trim()) {
      try { sourcePayload = typeof rawResponse === 'string' ? JSON.parse(rawResponse) : rawResponse; }
      catch { errors.push('Raw Response (JSON) is malformed.'); }
    }
    const responses: Record<string, Status> = {};
    const params = sourcePayload?.params && typeof sourcePayload.params === 'object' ? sourcePayload.params : {};
    for (const [id] of PARAMETERS) {
      let value = params[id];
      if (value === undefined) value = cell(cells, headers, [`${id} Outcome`]);
      if (value === undefined && id.startsWith('8') && typeof sourcePayload?.fatals?.[id] === 'boolean') value = sourcePayload.fatals[id] ? 'Fail' : 'Pass';
      if (value === undefined && id.startsWith('9') && typeof sourcePayload?.ztps?.[id] === 'boolean') value = sourcePayload.ztps[id] ? 'Fail' : 'Pass';
      if (value === undefined || value === null || String(value).trim() === '') continue;
      const normalized = normalizeStatus(value);
      if (normalized) responses[id] = normalized;
      else errors.push(`${id} has an invalid outcome.`);
    }
    if (!Object.keys(responses).length) errors.push('No valid parameter outcomes were found.');
    const stageText = String(get('stage') ?? '').trim() || null;
    const payloadHash = createHash('sha256').update(JSON.stringify(raw)).digest('hex');
    rows.push({
      auditId, sourceRowReference: String(sourceDataStartRow + i - headerRowIndex - 1), auditDate, roleText, role, evaluatorName, evaluatorEmail, counsellorName, counsellorEmail,
      callId: String(get('callId') ?? '').trim() || null, callDate, callLink: String(get('callLink') ?? '').trim() || null,
      callDuration: String(get('callDuration') ?? '').trim() || null, callType: String(get('callType') ?? '').trim() || null,
      stageText, responses, errors, raw, hash: payloadHash,
    });
  }
  return { sheetHeaderRow: headerRowIndex + 1, rows };
}

export function googleSheetHeaderRow(values: unknown[][]): unknown[] {
  return values[googleSheetHeaderRowIndex(values)];
}

export function normalizeStoredPayload(payload: Record<string, unknown>): SheetSubmission {
  const headers = Object.keys(payload);
  const values = Object.values(payload);
  return parseGoogleSheetValues([headers, values]).rows[0];
}

export const STAGE_SEQUENCE: readonly Stage[] = ['T1', 'Q1', 'Q2', 'T2', 'Q3', 'Q4'];
const stageRole: Record<Stage, EvaluatorRole> = { T1: 'TRAINER', Q1: 'QA', Q2: 'QA', T2: 'TRAINER', Q3: 'QA', Q4: 'QA' };
export type SequenceDecision = { status: 'ASSIGN'; stage: Stage } | { status: 'NEEDS_REVIEW'; reason: string };

export function normalizeStage(value: unknown): Stage | null {
  const stage = compact(value).toUpperCase();
  return STAGE_SEQUENCE.find(candidate => candidate === stage) ?? null;
}

/** Determines the next stage from this counsellor's own accepted cycle history. */
export function detectSequenceStage(role: EvaluatorRole, priorStages: Stage[] | null): SequenceDecision {
  if (priorStages === null || priorStages.length === 0) {
    return role === 'TRAINER' ? { status: 'ASSIGN', stage: 'T1' } : { status: 'NEEDS_REVIEW', reason: 'A QA submission cannot start a cycle; the counsellor needs a valid T1 first.' };
  }
  if (priorStages.some((stage, index) => STAGE_SEQUENCE[index] !== stage)) {
    return { status: 'NEEDS_REVIEW', reason: 'The counsellor cycle history is not a valid prefix of the expected stage sequence.' };
  }
  const next = STAGE_SEQUENCE[priorStages.length];
  if (!next) return role === 'TRAINER'
    ? { status: 'ASSIGN', stage: 'T1' }
    : { status: 'NEEDS_REVIEW', reason: 'The previous cycle is complete; a new cycle must begin with Trainer T1.' };
  if (stageRole[next] !== role) return { status: 'NEEDS_REVIEW', reason: `The next expected stage is ${next}, which requires ${stageRole[next]}; received ${role}.` };
  return { status: 'ASSIGN', stage: next };
}

export function detectExplicitStage(role: EvaluatorRole, stageText: unknown, priorStages: Stage[] | null): SequenceDecision {
  const stage = normalizeStage(stageText);
  if (!stage) return { status: 'NEEDS_REVIEW', reason: 'The explicit Audit Stage is missing or invalid.' };
  if (stageRole[stage] !== role) return { status: 'NEEDS_REVIEW', reason: `Stage ${stage} is incompatible with role ${role}.` };
  const expected = detectSequenceStage(role, priorStages);
  if (expected.status === 'NEEDS_REVIEW') return expected;
  if (expected.stage !== stage) return { status: 'NEEDS_REVIEW', reason: `Stage ${stage} is out of order; ${expected.stage} is expected next.` };
  return { status: 'ASSIGN', stage };
}
