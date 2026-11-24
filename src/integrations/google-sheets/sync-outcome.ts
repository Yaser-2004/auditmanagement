export type GoogleSyncRunOutcome = {
  status: string;
  failedCount: number;
  errorMessage?: string | null;
};

export function googleSyncHttpStatus(run: GoogleSyncRunOutcome) {
  if (run.errorMessage?.includes('another Google Sheets sync is still running')) return 409;
  if (run.status === 'FAILED' || run.failedCount > 0) return 503;
  if (run.status === 'PARTIAL') return 207;
  return 200;
}

export function googleSyncMessage(run: GoogleSyncRunOutcome) {
  return run.errorMessage ?? (run.status === 'SUCCEEDED' ? 'Sync completed successfully.' : 'Sync completed with items requiring attention.');
}
