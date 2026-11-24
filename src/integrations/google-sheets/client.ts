import { db } from '@/lib/prisma';
import { decryptGoogleRefreshToken, googleOAuthConfiguration, createGoogleOAuthClient, GOOGLE_SHEETS_CREDENTIAL_ID } from './oauth';
import { GoogleSheetsIntegrationError, googleFailure } from './errors';
import { parseGoogleA1Range, readFullGoogleSheet, readIncrementalGoogleSheet } from './ranges';

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
  parseGoogleA1Range(range);
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
  if (saved.accountEmail.toLowerCase() !== config.expectedEmail) throw new GoogleSheetsIntegrationError('The stored Google account does not match GOOGLE_EXPECTED_ACCOUNT_EMAIL. Verify production configuration and connect the intended account there.', 'GOOGLE_CONNECTED_ACCOUNT_MISMATCH', 409);
  const refreshToken = decryptSavedRefreshToken(saved);
  const auth = createGoogleOAuthClient();
  auth.setCredentials({ refresh_token: refreshToken });
  await refreshGoogleAccessToken(auth);
  const sheetName = config.range.includes('!') ? config.range.slice(0, config.range.indexOf('!')).replace(/^'/, '').replace(/'$/, '') : config.range;
  return readFullGoogleSheet({ ...config, sheetName }, range => readGoogleSheetRange(auth, config.spreadsheetId, range));
}

function decryptSavedRefreshToken(saved: { refreshTokenCiphertext: string; encryptionIv: string; encryptionTag: string }) {
  let token: string;
  try { token = decryptGoogleRefreshToken(saved); }
  catch { throw new GoogleSheetsIntegrationError('The stored Google credential could not be decrypted. Verify the production AUTH_SECRET matches the one used when this account was connected.', 'GOOGLE_CREDENTIAL_DECRYPTION_FAILED', 500); }
  if (!token.trim()) throw new GoogleSheetsIntegrationError('The database contains a Google connection record without a refresh token. Reconnect the account from the deployed Admin page.', 'GOOGLE_REFRESH_TOKEN_MISSING', 503);
  return token;
}

async function refreshGoogleAccessToken(auth: ReturnType<typeof createGoogleOAuthClient>) {
  const response = await requestWithRetry(() => auth.getAccessToken().then(data => ({ data })), 'oauth_token_exchange');
  if (!response.data.token) throw new GoogleSheetsIntegrationError('Google did not issue an access token for the stored refresh token.', 'GOOGLE_ACCESS_TOKEN_MISSING', 502);
}

async function readGoogleSheetRange(auth: ReturnType<typeof createGoogleOAuthClient>, spreadsheetId: string, range: string) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;
  const response = await requestWithRetry<{ values?: unknown[][] }>(() => auth.request({
    url,
    method: 'GET',
    params: { valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' },
  }));
  return response.data.values ?? [];
}

function retryable(error: unknown) {
  const value = error as { code?: string; response?: { status?: number } };
  const status = value.response?.status;
  return status === undefined || status === 408 || status === 429 || status >= 500 || ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH'].includes(value.code ?? '');
}

async function requestWithRetry<T>(request: () => Promise<{ data: T }>, stage: 'oauth_token_exchange' | 'sheets_api' = 'sheets_api') {
  const configured = Number(process.env.GOOGLE_SYNC_MAX_RETRIES ?? 3);
  const maxRetries = Number.isFinite(configured) ? Math.max(0, Math.min(5, configured)) : 3;
  for (let attempt = 0; ; attempt++) {
    try { return await request(); }
    catch (error) {
      const value = error as { code?: string; response?: { status?: number } };
      const failure = googleFailure(error, stage);
      const diagnostics = failure?.diagnostics ?? { stage, httpStatus: value.response?.status ?? null, googleError: null, googleDescription: null };
      if (attempt >= maxRetries || !retryable(error)) {
        console.error('[google-sheets-sync] Google request failed', { attempt: attempt + 1, ...diagnostics });
        if (failure) throw failure;
        const code = typeof value.code === 'string' ? value.code : 'UNKNOWN';
        if (['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'ECONNREFUSED'].includes(code)) {
          throw new GoogleSheetsIntegrationError('Could not reach Google. The sync can be retried.', 'GOOGLE_NETWORK_FAILURE', 503, diagnostics);
        }
        throw new GoogleSheetsIntegrationError('The Google request failed without a readable HTTP error response. Review the safe server diagnostic for its request stage and status.', 'GOOGLE_REQUEST_FAILED', 502, diagnostics);
      }
      console.warn('[google-sheets-sync] Retrying transient Google request', { attempt: attempt + 1, ...diagnostics });
      await new Promise(resolve => setTimeout(resolve, Math.min(4000, 400 * (2 ** attempt))));
    }
  }
}

/** Reads just the rows after the persisted cursor; callers periodically request a full reconciliation. */
export async function fetchConfiguredGoogleSheetSince(cursorRow: number) {
  const config = googleSheetsConfiguration();
  const connections = await db.$queryRaw<Array<{ accountEmail: string; refreshTokenCiphertext: string; encryptionIv: string; encryptionTag: string }>>`SELECT "accountEmail", "refreshTokenCiphertext", "encryptionIv", "encryptionTag" FROM "GoogleSheetsCredential" WHERE "id" = ${GOOGLE_SHEETS_CREDENTIAL_ID} LIMIT 1`;
  const saved = connections[0];
  if (!saved) throw new Error('Connect the authorized Google account from the Admin Google Sheets page before syncing.');
  if (saved.accountEmail.toLowerCase() !== config.expectedEmail) throw new GoogleSheetsIntegrationError('The stored Google account does not match GOOGLE_EXPECTED_ACCOUNT_EMAIL. Verify production configuration and connect the intended account there.', 'GOOGLE_CONNECTED_ACCOUNT_MISMATCH', 409);
  const auth = createGoogleOAuthClient();
  auth.setCredentials({ refresh_token: decryptSavedRefreshToken(saved) });
  await refreshGoogleAccessToken(auth);
  const sheetName = config.range.includes('!') ? config.range.slice(0, config.range.indexOf('!')).replace(/^'/, '').replace(/'$/, '') : config.range;
  return readIncrementalGoogleSheet({ ...config, sheetName }, cursorRow, range => readGoogleSheetRange(auth, config.spreadsheetId, range));
}
