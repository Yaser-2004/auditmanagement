import { timingSafeEqual } from 'node:crypto';

export type CronAuthorization = { ok: true } | { ok: false; status: 401 | 500; error: string };

/** Checks the cron bearer token without exposing the configured secret to client code. */
export function authorizeGoogleSheetsCron(authorization: string | null, configuredSecret = process.env.GOOGLE_SYNC_CRON_SECRET): CronAuthorization {
  const secret = configuredSecret?.trim() ?? '';
  if (!secret) return { ok: false, status: 500, error: 'Scheduled sync is not configured: GOOGLE_SYNC_CRON_SECRET is missing.' };

  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  const supplied = Buffer.from(match?.[1] ?? '', 'utf8');
  const expected = Buffer.from(secret, 'utf8');
  // Compare equal-length buffers even for malformed tokens, then include the length
  // check in the result. timingSafeEqual itself requires buffers of equal length.
  const candidate = Buffer.alloc(expected.length);
  supplied.copy(candidate, 0, 0, expected.length);
  const equal = timingSafeEqual(expected, candidate);
  if (!match || supplied.length !== expected.length || !equal) {
    return { ok: false, status: 401, error: 'Unauthorized scheduled sync request.' };
  }
  return { ok: true };
}
