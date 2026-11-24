import { describe, expect, it } from 'vitest';
import { detectExplicitStage, detectSequenceStage, normalizeEvaluatorRole, parseGoogleSheetValues } from '../src/integrations/google-sheets/normalize';
import { decryptGoogleRefreshToken, encryptGoogleRefreshToken, GOOGLE_OAUTH_SCOPES, GOOGLE_SHEETS_READ_SCOPE, hasGoogleSheetsReadScope } from '../src/integrations/google-sheets/oauth';
import { authorizeGoogleSheetsCron } from '../src/server/google-sheets-cron-auth';

describe('Google Sheets cron endpoint authentication', () => {
  const secret = 'test-cron-secret-with-at-least-32-characters';

  it('accepts the configured bearer token', () => {
    expect(authorizeGoogleSheetsCron(`Bearer ${secret}`, secret)).toEqual({ ok: true });
  });

  it('rejects a missing authorization header with HTTP 401 metadata', () => {
    expect(authorizeGoogleSheetsCron(null, secret)).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects an invalid bearer token with HTTP 401 metadata', () => {
    expect(authorizeGoogleSheetsCron('Bearer wrong-secret', secret)).toMatchObject({ ok: false, status: 401 });
  });

  it('fails closed with HTTP 500 metadata if the server secret is not configured', () => {
    expect(authorizeGoogleSheetsCron(`Bearer ${secret}`, '')).toMatchObject({ ok: false, status: 500 });
  });
});

describe('Google Sheets source normalization', () => {
  it('uses the compact second header row and preserves source fields and outcomes', () => {
    const values = [
      ['Audit Date & Time', 'Auditor Role', 'Evaluator', 'Counsellor Name', 'Counsellor Email', 'Call ID', '1A description', 'Score (Decimal)', 'Audit ID', 'Raw Response (JSON)'],
      ['Audit Date & Time', 'Auditor Role', 'Evaluator', 'Counsellor Name', 'Counsellor Email', 'Call ID', '1A Outcome', 'Score (Decimal)', 'Audit ID', 'Raw Response (JSON)'],
      ['2026-11-03T06:42:10.252Z', 'QA', 'Shaheen', 'Alex Demo', 'alex@example.com', 123, 'Fail', 0.5, 'source-1', JSON.stringify({ params: { '1A': 'fail' } })],
    ];
    const parsed = parseGoogleSheetValues(values);
    expect(parsed.sheetHeaderRow).toBe(2);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({ auditId: 'source-1', role: 'QA', evaluatorName: 'Shaheen', evaluatorEmail: '' });
    expect(parsed.rows[0].responses['1A']).toBe('FAIL');
    expect(parsed.rows[0].raw['Audit ID']).toBe('source-1');
    expect(parsed.rows[0].errors).not.toContain('A valid evaluator work email is required.');
  });

  it('normalizes role labels without using evaluator name as identity', () => {
    expect(normalizeEvaluatorRole('Trainer')).toBe('TRAINER');
    expect(normalizeEvaluatorRole('QA')).toBe('QA');
    expect(normalizeEvaluatorRole('Unknown')).toBeNull();
  });

  it('keeps separate source submissions that share a Call ID', () => {
    const headers = ['Audit Date & Time', 'Auditor Role', 'Evaluator', 'Email Address', 'Counsellor Name', 'Counsellor Email', 'Call ID', '1A Outcome', 'Audit ID'];
    const parsed = parseGoogleSheetValues([
      headers,
      ['2026-11-03T06:42:10Z', 'Trainer', 'Asha', 'asha@company.test', 'Alex Demo', 'alex@example.com', 'same-call', 'Fail', 'submission-1'],
      ['2026-11-03T07:42:10Z', 'QA', 'Asha', 'asha@company.test', 'Alex Demo', 'alex@example.com', 'same-call', 'Pass', 'submission-2'],
    ]);
    expect(parsed.rows.map(row => row.auditId)).toEqual(['submission-1', 'submission-2']);
    expect(parsed.rows.map(row => row.evaluatorEmail)).toEqual(['asha@company.test', 'asha@company.test']);
  });

  it('keeps the original spreadsheet row number on cursor-based reads', () => {
    const headers = ['Audit Date & Time', 'Auditor Role', 'Evaluator', 'Counsellor Name', 'Counsellor Email', '1A Outcome', 'Audit ID'];
    const parsed = parseGoogleSheetValues([headers, ['2026-11-03T06:42:10Z', 'QA', 'Dimple', 'Jatin', 'jatin@example.com', 'Pass', 'submission-81']], { sourceDataStartRow: 81 });
    expect(parsed.rows[0].sourceRowReference).toBe('81');
  });
});

describe('Google Sheets OAuth read-only scope', () => {
  it('requests spreadsheets.readonly without spreadsheet write access', () => {
    expect(GOOGLE_OAUTH_SCOPES).toContain(GOOGLE_SHEETS_READ_SCOPE);
    expect(GOOGLE_OAUTH_SCOPES).not.toContain('https://www.googleapis.com/auth/spreadsheets');
  });

  it('verifies the consent response granted the required read-only scope', () => {
    expect(hasGoogleSheetsReadScope(`openid email ${GOOGLE_SHEETS_READ_SCOPE}`)).toBe(true);
    expect(hasGoogleSheetsReadScope('openid email')).toBe(false);
    expect(hasGoogleSheetsReadScope('https://www.googleapis.com/auth/spreadsheets')).toBe(false);
  });
});

describe('Google OAuth token protection', () => {
  it('encrypts refresh tokens at rest and decrypts them with the app secret', () => {
    const prior = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = 'unit-test-secret-with-at-least-32-characters';
    try {
      const encrypted = encryptGoogleRefreshToken('refresh-token-example');
      expect(encrypted.refreshTokenCiphertext).not.toContain('refresh-token-example');
      expect(decryptGoogleRefreshToken(encrypted)).toBe('refresh-token-example');
    } finally {
      if (prior === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = prior;
    }
  });
});

describe('per-counsellor sequence stage detection', () => {
  it('starts a cycle only on Trainer and walks the approved role sequence', () => {
    const expected = [
      ['TRAINER', [], 'T1'], ['QA', ['T1'], 'Q1'], ['QA', ['T1', 'Q1'], 'Q2'],
      ['TRAINER', ['T1', 'Q1', 'Q2'], 'T2'], ['QA', ['T1', 'Q1', 'Q2', 'T2'], 'Q3'],
      ['QA', ['T1', 'Q1', 'Q2', 'T2', 'Q3'], 'Q4'],
    ] as const;
    for (const [role, prior, stage] of expected) expect(detectSequenceStage(role, [...prior])).toEqual({ status: 'ASSIGN', stage });
    expect(detectSequenceStage('QA', null).status).toBe('NEEDS_REVIEW');
  });

  it('flags an out-of-order role instead of guessing a stage', () => {
    expect(detectSequenceStage('TRAINER', ['T1', 'Q1'])).toMatchObject({ status: 'NEEDS_REVIEW' });
    expect(detectSequenceStage('QA', ['T1', 'Q1', 'Q2', 'T2', 'Q3', 'Q4'])).toEqual({ status: 'NEEDS_REVIEW', reason: 'The previous cycle is complete; a new cycle must begin with Trainer T1.' });
  });

  it('keeps interleaved counsellors independent and starts a new cycle only after Q4', () => {
    const alex = ['T1', 'Q1', 'Q2'] as const;
    const rahul = ['T1'] as const;
    expect(detectSequenceStage('TRAINER', [...alex])).toEqual({ status: 'ASSIGN', stage: 'T2' });
    expect(detectSequenceStage('QA', [...rahul])).toEqual({ status: 'ASSIGN', stage: 'Q1' });
    const complete = ['T1', 'Q1', 'Q2', 'T2', 'Q3', 'Q4'] as const;
    expect(detectSequenceStage('TRAINER', [...complete])).toEqual({ status: 'ASSIGN', stage: 'T1' });
    expect(detectSequenceStage('QA', [...complete]).status).toBe('NEEDS_REVIEW');
  });

  it('holds a missing stage or incompatible explicit role for review', () => {
    expect(detectSequenceStage('TRAINER', ['T1', 'Q1'])).toMatchObject({ status: 'NEEDS_REVIEW', reason: expect.stringContaining('Q2') });
    expect(detectExplicitStage('QA', 'T1', [])).toMatchObject({ status: 'NEEDS_REVIEW' });
    expect(detectExplicitStage('QA', 'Q2', ['T1'])).toMatchObject({ status: 'NEEDS_REVIEW', reason: expect.stringContaining('Q1') });
  });
});
