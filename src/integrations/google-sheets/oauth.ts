import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';

export const GOOGLE_SHEETS_CREDENTIAL_ID = 'default';
export const GOOGLE_OAUTH_STATE_COOKIE = 'ls_google_oauth_state';
export const GOOGLE_OAUTH_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
];

export function googleOAuthConfiguration() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const appOrigin = process.env.APP_ORIGIN?.trim();
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim()
    || (appOrigin ? new URL('/api/integrations/google-sheets/oauth/callback', appOrigin).toString() : '');
  const expectedEmail = (process.env.GOOGLE_EXPECTED_ACCOUNT_EMAIL || 'yaser.siddiquee@gmail.com').trim().toLowerCase();
  if (!clientId || !clientSecret) throw new Error('Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in the server environment.');
  if (!redirectUri) throw new Error('Set APP_ORIGIN or GOOGLE_OAUTH_REDIRECT_URI for Google OAuth.');
  if (!expectedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(expectedEmail)) throw new Error('GOOGLE_EXPECTED_ACCOUNT_EMAIL must be a valid email address.');
  return { clientId, clientSecret, redirectUri, expectedEmail };
}

export function createGoogleOAuthClient() {
  const config = googleOAuthConfiguration();
  return new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);
}

function encryptionKey() {
  const secret = process.env.AUTH_SECRET || '';
  if (secret.length < 32) throw new Error('AUTH_SECRET must contain at least 32 characters to protect Google credentials.');
  return scryptSync(secret, 'learningshala-google-sheets-refresh-token-v1', 32);
}

export function encryptGoogleRefreshToken(refreshToken: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(refreshToken, 'utf8'), cipher.final()]);
  return { refreshTokenCiphertext: ciphertext.toString('base64'), encryptionIv: iv.toString('base64'), encryptionTag: cipher.getAuthTag().toString('base64') };
}

export function decryptGoogleRefreshToken(value: { refreshTokenCiphertext: string; encryptionIv: string; encryptionTag: string }) {
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(value.encryptionIv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.encryptionTag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(value.refreshTokenCiphertext, 'base64')), decipher.final()]).toString('utf8');
}
