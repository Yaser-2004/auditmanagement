type UnknownRecord = Record<string, unknown>;

export type GoogleFailureDiagnostics = {
  stage: 'oauth_token_exchange' | 'sheets_api';
  httpStatus: number | null;
  googleError: string | null;
  googleDescription: string | null;
};

export class GoogleSheetsIntegrationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus: number,
    readonly diagnostics: GoogleFailureDiagnostics | null = null,
  ) {
    super(message);
    this.name = 'GoogleSheetsIntegrationError';
  }
}

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? value as UnknownRecord : null;
}

function safeText(value: unknown, max = 300): string | null {
  if (typeof value !== 'string') return null;
  return value
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/\bya29\.[A-Za-z0-9._-]+/g, '[REDACTED_GOOGLE_TOKEN]')
    .replace(/\b1\/\/[A-Za-z0-9._-]+/g, '[REDACTED_GOOGLE_TOKEN]')
    .replace(/(access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|authorization)(\s*[=:]\s*)[^\s,"']+/gi, '$1$2[REDACTED]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, max);
}

function responseFrom(error: unknown): { status: number | null; data: unknown } {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth++) {
    const item = record(current);
    const response = record(item?.response);
    if (response) {
      const rawStatus = response.status ?? response.statusCode;
      const status = typeof rawStatus === 'number' ? rawStatus : null;
      return { status, data: response.data };
    }
    const rawStatus = item?.status ?? item?.statusCode;
    if (typeof rawStatus === 'number') return { status: rawStatus, data: item?.data };
    current = item?.cause;
  }
  return { status: null, data: null };
}

function errorFields(data: unknown) {
  let body = record(data);
  if (!body && typeof data === 'string') {
    try { body = record(JSON.parse(data)); } catch { body = null; }
  }
  const nested = record(body?.error);
  const errorValue = typeof body?.error === 'string'
    ? body.error
    : typeof nested?.status === 'string'
      ? nested.status
      : typeof nested?.code === 'string'
        ? nested.code
        : null;
  const description = typeof body?.error_description === 'string'
    ? body.error_description
    : typeof nested?.message === 'string'
      ? nested.message
      : typeof body?.message === 'string'
        ? body.message
        : null;
  return { googleError: safeText(errorValue, 100), googleDescription: safeText(description) };
}

export function googleFailure(error: unknown, stage: GoogleFailureDiagnostics['stage']): GoogleSheetsIntegrationError | null {
  const { status, data } = responseFrom(error);
  const fields = errorFields(data);
  const errorCode = fields.googleError?.toLowerCase() ?? '';
  const diagnostics: GoogleFailureDiagnostics = { stage, httpStatus: status, ...fields };

  if (errorCode === 'invalid_grant') {
    return new GoogleSheetsIntegrationError('Google rejected the stored refresh token (invalid_grant). Reconnect the Google account from the deployed production app.', 'GOOGLE_REFRESH_TOKEN_REJECTED', 401, diagnostics);
  }
  if (errorCode === 'invalid_client' || errorCode === 'unauthorized_client') {
    return new GoogleSheetsIntegrationError('Google rejected the configured OAuth client. Verify GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in the production environment.', 'GOOGLE_OAUTH_CLIENT_REJECTED', 500, diagnostics);
  }
  if (errorCode === 'invalid_scope') {
    return new GoogleSheetsIntegrationError('Google rejected the OAuth scopes. Verify the authorized app requests the Sheets read-only scope, then reconnect the account if its grant predates that scope.', 'GOOGLE_OAUTH_SCOPE_REJECTED', 500, diagnostics);
  }
  if (status === 401) {
    return new GoogleSheetsIntegrationError('Google authentication failed. Check the production OAuth client and reconnect the authorized account if needed.', 'GOOGLE_AUTHENTICATION_FAILED', 401, diagnostics);
  }
  if (status === 403) {
    return new GoogleSheetsIntegrationError('Google denied access to the spreadsheet. Verify sharing with the connected account and the Sheets read-only scope.', 'GOOGLE_SHEETS_ACCESS_DENIED', 403, diagnostics);
  }
  if (status === 404) {
    return new GoogleSheetsIntegrationError('Google could not find the configured spreadsheet or range. Verify GOOGLE_SHEETS_SPREADSHEET_ID and GOOGLE_SHEETS_RANGE.', 'GOOGLE_SHEET_NOT_FOUND', 404, diagnostics);
  }
  if (status === 429 || (status !== null && status >= 500)) {
    return new GoogleSheetsIntegrationError('Google temporarily rejected the request. The sync can be retried.', 'GOOGLE_TEMPORARY_FAILURE', 503, diagnostics);
  }
  if (status !== null) {
    const responseStatus = status >= 400 && status < 500 ? status : 502;
    return new GoogleSheetsIntegrationError(`Google rejected the ${stage === 'oauth_token_exchange' ? 'OAuth token exchange' : 'Sheets API request'} (HTTP ${status}).`, 'GOOGLE_REQUEST_REJECTED', responseStatus, diagnostics);
  }

  const item = record(error);
  const networkCode = typeof item?.code === 'string' ? item.code : '';
  if (['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'ECONNREFUSED'].includes(networkCode)) {
    return new GoogleSheetsIntegrationError('Could not reach Google. The sync can be retried.', 'GOOGLE_NETWORK_FAILURE', 503, diagnostics);
  }
  return null;
}

export function googleConfigurationFailure(error: unknown): GoogleSheetsIntegrationError | null {
  if (error instanceof GoogleSheetsIntegrationError) return error;
  const message = error instanceof Error ? error.message : '';
  if (/Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET/.test(message)) {
    return new GoogleSheetsIntegrationError('Google OAuth client credentials are missing in the server environment.', 'GOOGLE_OAUTH_CONFIGURATION_MISSING', 500);
  }
  if (/Set GOOGLE_SHEETS_SPREADSHEET_ID and GOOGLE_SHEETS_RANGE/.test(message)) {
    return new GoogleSheetsIntegrationError('Google Sheets spreadsheet configuration is missing in the server environment.', 'GOOGLE_SHEETS_CONFIGURATION_MISSING', 500);
  }
  if (/Set APP_ORIGIN or GOOGLE_OAUTH_REDIRECT_URI/.test(message)) {
    return new GoogleSheetsIntegrationError('Google OAuth redirect configuration is missing in the server environment.', 'GOOGLE_OAUTH_REDIRECT_MISSING', 500);
  }
  if (/Connect the authorized Google account/.test(message)) {
    return new GoogleSheetsIntegrationError('No Google refresh token is stored in the database used by this deployment. Connect Google from the deployed Admin page.', 'GOOGLE_ACCOUNT_NOT_CONNECTED', 503);
  }
  if (/AUTH_SECRET|authenticate data|Unsupported state or unable to authenticate/i.test(message)) {
    return new GoogleSheetsIntegrationError('The stored Google credential could not be decrypted. Verify the production AUTH_SECRET matches the one used when the account was connected.', 'GOOGLE_CREDENTIAL_DECRYPTION_FAILED', 500);
  }
  return null;
}
