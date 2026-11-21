import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireRole } from '@/server/auth';
import { createGoogleOAuthClient, GOOGLE_OAUTH_SCOPES, GOOGLE_OAUTH_STATE_COOKIE, googleOAuthConfiguration } from '@/integrations/google-sheets/oauth';

export async function GET(request: Request) {
  try {
    await requireRole(['ADMIN']);
    const config = googleOAuthConfiguration();
    const state = randomBytes(32).toString('base64url');
    const authorizationUrl = createGoogleOAuthClient().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: true,
      scope: GOOGLE_OAUTH_SCOPES,
      state,
      login_hint: config.expectedEmail,
    });
    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: new URL(request.url).protocol === 'https:',
      sameSite: 'lax',
      path: '/api/integrations/google-sheets/oauth/callback',
      maxAge: 600,
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Google account connection could not start.';
    return NextResponse.redirect(new URL(`/google-sheets?connection_error=${encodeURIComponent(message)}`, process.env.APP_ORIGIN || new URL(request.url).origin));
  }
}
