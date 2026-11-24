import { describe, expect, it } from 'vitest';
import { googleConfigurationFailure, googleFailure } from '../src/integrations/google-sheets/errors';

describe('Google Sheets OAuth and API failure reporting', () => {
  it('identifies invalid_grant and retains safe Google response diagnostics', () => {
    const failure = googleFailure({ response: { status: 400, data: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } } }, 'oauth_token_exchange');
    expect(failure).toMatchObject({ code: 'GOOGLE_REFRESH_TOKEN_REJECTED', httpStatus: 401, diagnostics: { stage: 'oauth_token_exchange', httpStatus: 400, googleError: 'invalid_grant', googleDescription: 'Token has been expired or revoked.' } });
  });

  it('identifies invalid_client without exposing a supplied secret in the safe response details', () => {
    const failure = googleFailure({ response: { status: 401, data: { error: 'invalid_client', error_description: 'client_secret=top-secret was rejected' } } }, 'oauth_token_exchange');
    expect(failure?.code).toBe('GOOGLE_OAUTH_CLIENT_REJECTED');
    expect(JSON.stringify(failure?.diagnostics)).not.toContain('top-secret');
  });

  it('distinguishes a spreadsheet permission failure from an OAuth refresh failure', () => {
    const failure = googleFailure({ response: { status: 403, data: { error: { status: 'PERMISSION_DENIED', message: 'Caller does not have access.' } } } }, 'sheets_api');
    expect(failure).toMatchObject({ code: 'GOOGLE_SHEETS_ACCESS_DENIED', httpStatus: 403, diagnostics: { stage: 'sheets_api', httpStatus: 403, googleError: 'PERMISSION_DENIED' } });
  });

  it('reports missing OAuth configuration and missing production refresh-token storage separately', () => {
    expect(googleConfigurationFailure(new Error('Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in the server environment.'))).toMatchObject({ code: 'GOOGLE_OAUTH_CONFIGURATION_MISSING', httpStatus: 500 });
    expect(googleConfigurationFailure(new Error('Connect the authorized Google account from the Admin Google Sheets page before syncing.'))).toMatchObject({ code: 'GOOGLE_ACCOUNT_NOT_CONNECTED', httpStatus: 503 });
  });
});
