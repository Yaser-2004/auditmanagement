import { db } from '@/lib/prisma';
import { decryptGoogleRefreshToken, googleOAuthConfiguration, createGoogleOAuthClient, GOOGLE_SHEETS_CREDENTIAL_ID } from './oauth';
import { googleSheetHeaderRow } from './normalize';

export type GoogleSheetsConfiguration = {
  spreadsheetId: string;
  range: string;
  stageMode: 'SEQUENCE' | 'EXPLICIT';
  expectedEmail: string;
};

export function googleSheetsConfiguration(): GoogleSheetsConfiguration {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  const range = process.env.GOOGLE_SHEETS_RANGE?.trim();
  const mode = (process.env.GOOGLE_STAGE_DETECTION_MODE || 'SEQUENCE').trim().toUpperCase();
  if (!spreadsheetId || !range) throw new Error('Set GOOGLE_SHEETS_SPREADSHEET_ID and GOOGLE_SHEETS_RANGE.');
  const oauth = googleOAuthConfiguration();
  if (mode !== 'SEQUENCE' && mode !== 'EXPLICIT') throw new Error('GOOGLE_STAGE_DETECTION_MODE must be SEQUENCE or EXPLICIT.');
  return { spreadsheetId, range, stageMode: mode, expectedEmail: oauth.expectedEmail };
}

export async function googleSheetsConfigurationStatus() {
  const mode = (process.env.GOOGLE_STAGE_DETECTION_MODE || 'SEQUENCE').trim().toUpperCase();
  let accountEmail: string | null = null;
  try {
    const connections = await db.$queryRaw<Array<{ accountEmail: string }>>`SELECT "accountEmail" FROM "GoogleSheetsCredential" WHERE "id" = ${GOOGLE_SHEETS_CREDENTIAL_ID} LIMIT 1`;
    accountEmail = connections[0]?.accountEmail ?? null;
  } catch {
    // This keeps the setup page usable before the OAuth credential migration is deployed.
  }
  const hasOAuthClient = Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() && process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim());
  const hasSpreadsheetId = Boolean(process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim());
  const hasRange = Boolean(process.env.GOOGLE_SHEETS_RANGE?.trim());
  const expectedEmail = (process.env.GOOGLE_EXPECTED_ACCOUNT_EMAIL || 'yaser.siddiquee@gmail.com').trim().toLowerCase();
  const connected = Boolean(accountEmail && accountEmail.toLowerCase() === expectedEmail);
  return {
    configured: hasOAuthClient && hasSpreadsheetId && hasRange && connected,
    hasSpreadsheetId,
    hasRange,
    hasOAuthClient,
    connected,
    accountEmail,
    stageMode: mode === 'EXPLICIT' ? 'EXPLICIT' : 'SEQUENCE',
  };
}

export async function fetchConfiguredGoogleSheet() {
  const config = googleSheetsConfiguration();
  const connections = await db.$queryRaw<Array<{ accountEmail: string; refreshTokenCiphertext: string; encryptionIv: string; encryptionTag: string }>>`SELECT "accountEmail", "refreshTokenCiphertext", "encryptionIv", "encryptionTag" FROM "GoogleSheetsCredential" WHERE "id" = ${GOOGLE_SHEETS_CREDENTIAL_ID} LIMIT 1`;
  const saved = connections[0];
  if (!saved) throw new Error('Connect the authorized Google account from the Admin Google Sheets page before syncing.');
  if (saved.accountEmail.toLowerCase() !== config.expectedEmail) throw new Error(`The connected Google account is ${saved.accountEmail}; reconnect as ${config.expectedEmail}.`);
  const refreshToken = decryptGoogleRefreshToken(saved);
  const auth = createGoogleOAuthClient();
  auth.setCredentials({ refresh_token: refreshToken });
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}/values/${encodeURIComponent(config.range)}`;
  const response = await requestWithRetry<{ values?: unknown[][] }>(() => auth.request({
    url,
    method: 'GET',
    params: { valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' },
  }));
  const sheetName = config.range.includes('!') ? config.range.slice(0, config.range.indexOf('!')).replace(/^'/, '').replace(/'$/, '') : config.range;
  const rangeParts = rangePartsForIncrementalRead(config.range);
  return { values: response.data.values ?? [], spreadsheetId: config.spreadsheetId, sheetName, range: config.range, stageMode: config.stageMode, sourceStartRow: rangeParts?.firstRow ?? 1, endRow: rangeParts ? rangeParts.firstRow + (response.data.values?.length ?? 0) - 1 : response.data.values?.length ?? 0, incrementalSupported: Boolean(rangeParts) };
}

type RangeParts = { prefix: string; startColumn: string; endColumn: string; firstRow: number; lastRow: number | null };
function rangePartsForIncrementalRead(range: string): RangeParts | null {
  const bang = range.lastIndexOf('!');
  const prefix = bang >= 0 ? range.slice(0, bang + 1) : '';
  const cells = (bang >= 0 ? range.slice(bang + 1) : range).replace(/\$/g, '');
  const match = cells.match(/^([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/i);
  if (!match) return null;
  return { prefix, startColumn: match[1].toUpperCase(), endColumn: (match[3] ?? match[1]).toUpperCase(), firstRow: Number(match[2] || 1), lastRow: match[4] ? Number(match[4]) : null };
}

function retryable(error: unknown) {
  const value = error as { code?: string; response?: { status?: number } };
  const status = value.response?.status;
  return status === undefined || status === 408 || status === 429 || status >= 500 || ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH'].includes(value.code ?? '');
}

async function requestWithRetry<T>(request: () => Promise<{ data: T }>) {
  const configured = Number(process.env.GOOGLE_SYNC_MAX_RETRIES ?? 3);
  const maxRetries = Number.isFinite(configured) ? Math.max(0, Math.min(5, configured)) : 3;
  for (let attempt = 0; ; attempt++) {
    try { return await request(); }
    catch (error) {
      const value = error as { code?: string; message?: string; response?: { status?: number } };
      if (attempt >= maxRetries || !retryable(error)) {
        if (attempt > 0) throw new Error(`Google Sheets API request failed after ${attempt + 1} attempts: ${value.message ?? String(error)}`);
        throw error;
      }
      console.warn('[google-sheets-sync] Retrying transient Sheets API request', { attempt: attempt + 1, status: value.response?.status ?? null, code: value.code ?? null });
      await new Promise(resolve => setTimeout(resolve, Math.min(4000, 400 * (2 ** attempt))));
    }
  }
}

/** Reads just the rows after the persisted cursor; callers periodically request a full reconciliation. */
export async function fetchConfiguredGoogleSheetSince(cursorRow: number) {
  const config = googleSheetsConfiguration();
  const range = rangePartsForIncrementalRead(config.range);
  if (!range) return { ...(await fetchConfiguredGoogleSheet()), incrementalSupported: false, sourceDataStartRow: undefined };
  const connections = await db.$queryRaw<Array<{ accountEmail: string; refreshTokenCiphertext: string; encryptionIv: string; encryptionTag: string }>>`SELECT "accountEmail", "refreshTokenCiphertext", "encryptionIv", "encryptionTag" FROM "GoogleSheetsCredential" WHERE "id" = ${GOOGLE_SHEETS_CREDENTIAL_ID} LIMIT 1`;
  const saved = connections[0];
  if (!saved) throw new Error('Connect the authorized Google account from the Admin Google Sheets page before syncing.');
  if (saved.accountEmail.toLowerCase() !== config.expectedEmail) throw new Error(`The connected Google account is ${saved.accountEmail}; reconnect as ${config.expectedEmail}.`);
  const auth = createGoogleOAuthClient();
  auth.setCredentials({ refresh_token: decryptGoogleRefreshToken(saved) });
  const headerEndRow = Math.min(range.firstRow + 5, range.lastRow ?? range.firstRow + 5);
  const headerRange = `${range.prefix}${range.startColumn}${range.firstRow}:${range.endColumn}${headerEndRow}`;
  // The full scan cursor already includes the selected header row (including
  // multi-row Form headers), so the next physical row is the correct append point.
  const sourceDataStartRow = Math.max(cursorRow + 1, range.firstRow + 1);
  const readRange = `${range.prefix}${range.startColumn}${sourceDataStartRow}:${range.endColumn}${range.lastRow ?? ''}`;
  const sheetName = config.range.includes('!') ? config.range.slice(0, config.range.indexOf('!')).replace(/^'/, '').replace(/'$/, '') : config.range;
  if (range.lastRow !== null && sourceDataStartRow > range.lastRow) {
    const response = await requestWithRetry<{ values?: unknown[][] }>(() => auth.request({
      url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}/values/${encodeURIComponent(headerRange)}`,
      method: 'GET', params: { valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' },
    }));
    const header = googleSheetHeaderRow(response.data.values ?? []);
    return { values: [header], spreadsheetId: config.spreadsheetId, sheetName, range: config.range, stageMode: config.stageMode, sourceStartRow: range.firstRow, sourceDataStartRow, endRow: cursorRow, incrementalSupported: true };
  }
  const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}/values:batchGet`;
  const response = await requestWithRetry<{ valueRanges?: { values?: unknown[][] }[] }>(() => auth.request({
    url: batchUrl,
    method: 'GET',
    params: { ranges: [headerRange, readRange], valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' },
  }));
  const valueRanges = response.data.valueRanges ?? [];
  const header = googleSheetHeaderRow(valueRanges[0]?.values ?? []);
  const newRows = valueRanges[1]?.values ?? [];
  return { values: [header, ...newRows], spreadsheetId: config.spreadsheetId, sheetName, range: config.range, stageMode: config.stageMode, sourceStartRow: range.firstRow, sourceDataStartRow, endRow: newRows.length ? sourceDataStartRow + newRows.length - 1 : cursorRow, incrementalSupported: true };
}
