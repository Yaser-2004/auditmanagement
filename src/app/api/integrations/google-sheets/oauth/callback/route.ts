import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { db } from '@/lib/prisma';
import { requireRole } from '@/server/auth';
import { createGoogleOAuthClient, encryptGoogleRefreshToken, googleOAuthConfiguration, GOOGLE_OAUTH_STATE_COOKIE, GOOGLE_SHEETS_CREDENTIAL_ID, hasGoogleSheetsReadScope } from '@/integrations/google-sheets/oauth';

const settingsPath = '/google-sheets';

function redirect(request: Request, query: string) {
  const base = process.env.APP_ORIGIN || new URL(request.url).origin;
  return NextResponse.redirect(new URL(`${settingsPath}${query}`, base));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const jar = await cookies();
  const stateCookie = jar.get(GOOGLE_OAUTH_STATE_COOKIE)?.value;
  const returnedState = url.searchParams.get('state');
  const responseCookies = { name: GOOGLE_OAUTH_STATE_COOKIE, options: { httpOnly: true, secure: url.protocol === 'https:', sameSite: 'lax' as const, path: '/api/integrations/google-sheets/oauth/callback', maxAge: 0 } };
  if (!stateCookie || !returnedState || stateCookie !== returnedState) {
    const response = redirect(request, '?connection_error=state_mismatch');
    response.cookies.set(responseCookies.name, '', responseCookies.options);
    return response;
  }
  if (url.searchParams.has('error')) {
    const response = redirect(request, '?connection_error=google_consent_denied');
    response.cookies.set(responseCookies.name, '', responseCookies.options);
    return response;
  }

  try {
    const admin = await requireRole(['ADMIN']);
    const code = url.searchParams.get('code');
    if (!code) throw new Error('Google did not return an authorization code.');
    const config = googleOAuthConfiguration();
    const auth = createGoogleOAuthClient();
    const { tokens } = await auth.getToken(code);
    if (!tokens.id_token) throw new Error('Google did not return a verified account identity. The existing connection was left unchanged.');
    if (!hasGoogleSheetsReadScope(tokens.scope)) throw new Error('Google did not grant the required read-only Sheets permission. The existing connection was left unchanged; reconnect and approve Google Sheets read-only access.');
    if (!tokens.refresh_token) throw new Error('Google did not return an offline refresh token. The existing connection was left unchanged; retry the consent flow.');
    const ticket = await auth.verifyIdToken({ idToken: tokens.id_token, audience: config.clientId });
    const identity = ticket.getPayload();
    const email = identity?.email?.trim().toLowerCase();
    if (!identity?.email_verified || !email) throw new Error('Google did not verify the authorized account email.');
    if (email !== config.expectedEmail) throw new Error(`Sign in with ${config.expectedEmail} to connect the response sheet.`);
    const encrypted = encryptGoogleRefreshToken(tokens.refresh_token);
    await db.$executeRaw`INSERT INTO "GoogleSheetsCredential" ("id", "accountEmail", "refreshTokenCiphertext", "encryptionIv", "encryptionTag", "createdAt", "updatedAt") VALUES (${GOOGLE_SHEETS_CREDENTIAL_ID}, ${email}, ${encrypted.refreshTokenCiphertext}, ${encrypted.encryptionIv}, ${encrypted.encryptionTag}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT ("id") DO UPDATE SET "accountEmail" = EXCLUDED."accountEmail", "refreshTokenCiphertext" = EXCLUDED."refreshTokenCiphertext", "encryptionIv" = EXCLUDED."encryptionIv", "encryptionTag" = EXCLUDED."encryptionTag", "updatedAt" = CURRENT_TIMESTAMP`;
    await db.auditLog.create({ data: { userId: admin.id, action: 'GOOGLE_SHEETS_ACCOUNT_CONNECTED', entity: 'GoogleSheetsCredential', entityId: GOOGLE_SHEETS_CREDENTIAL_ID, details: { accountEmail: email } } });
    const response = redirect(request, '?connection=connected');
    response.cookies.set(responseCookies.name, '', responseCookies.options);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Google account connection failed.';
    const response = redirect(request, `?connection_error=${encodeURIComponent(message)}`);
    response.cookies.set(responseCookies.name, '', responseCookies.options);
    return response;
  }
}
