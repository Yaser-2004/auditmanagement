import { describe, expect, it } from 'vitest';
import { committedGoogleSheetCursor, parseGoogleA1Range, readFullGoogleSheet, readIncrementalGoogleSheet } from '../src/integrations/google-sheets/ranges';
import { googleSyncHttpStatus, googleSyncMessage } from '../src/integrations/google-sheets/sync-outcome';

const config = { spreadsheetId: 'sheet-123', range: "'MainSheet'!A1:ZZ", sheetName: 'MainSheet', stageMode: 'SEQUENCE' as const };
const headerRows = [
  ['Audit ID', 'Counsellor Email', '1A description'],
  ['Audit ID', 'Counsellor Email', '1A Outcome'],
];

describe('Google Sheets A1 range fetching', () => {
  it('reads an initial full range and reports its physical end row', async () => {
    const requested: string[] = [];
    const result = await readFullGoogleSheet(config, async range => {
      requested.push(range);
      return [...headerRows, ['source-1', 'alex@example.com', 'Fail'], ['source-2', 'alex@example.com', 'Pass']];
    });
    expect(requested).toEqual(["'MainSheet'!A1:ZZ"]);
    expect(result).toMatchObject({ sourceStartRow: 1, endRow: 4, incrementalSupported: true });
  });

  it('reads header and incremental data as two valid independent A1 requests', async () => {
    const requested: string[] = [];
    const result = await readIncrementalGoogleSheet(config, 132, async range => {
      requested.push(range);
      if (range === "'MainSheet'!A1:ZZ6") return headerRows;
      if (range === "'MainSheet'!A133:ZZ") return [['source-133', 'alex@example.com', 'Fail']];
      throw new Error(`Unexpected range: ${range}`);
    });
    expect(requested).toEqual(["'MainSheet'!A1:ZZ6", "'MainSheet'!A133:ZZ"]);
    expect(requested.every(range => !range.includes(','))).toBe(true);
    expect(result).toMatchObject({ sourceDataStartRow: 133, endRow: 133 });
    expect(result.values).toEqual([headerRows[1], ['source-133', 'alex@example.com', 'Fail']]);
  });

  it('handles a header-only or completely empty sheet without inventing rows', async () => {
    const headerOnly = await readIncrementalGoogleSheet(config, 2, async range => range.endsWith('A1:ZZ6') ? headerRows : []);
    expect(headerOnly.values).toEqual([headerRows[1]]);
    expect(headerOnly.endRow).toBe(2);

    const empty = await readFullGoogleSheet(config, async () => []);
    expect(empty.values).toEqual([]);
    expect(empty.endRow).toBe(0);
  });

  it('holds the cursor after a partial processing failure and retries the same next row', async () => {
    let cursor = 132;
    const failedAttemptRanges: string[] = [];
    await expect(readIncrementalGoogleSheet(config, cursor, async range => {
      failedAttemptRanges.push(range);
      if (range.endsWith('A1:ZZ6')) return headerRows;
      throw new Error('Temporary Google API failure');
    })).rejects.toThrow('Temporary Google API failure');
    cursor = committedGoogleSheetCursor(cursor, 133, false);
    expect(cursor).toBe(132);

    const retryRanges: string[] = [];
    const retry = await readIncrementalGoogleSheet(config, cursor, async range => {
      retryRanges.push(range);
      return range.endsWith('A1:ZZ6') ? headerRows : [['source-133', 'alex@example.com', 'Fail']];
    });
    expect(failedAttemptRanges.at(-1)).toBe("'MainSheet'!A133:ZZ");
    expect(retryRanges.at(-1)).toBe("'MainSheet'!A133:ZZ");
    cursor = committedGoogleSheetCursor(cursor, retry.endRow, true);
    expect(cursor).toBe(133);
  });

  it('rejects comma-joined ranges and invalid row boundaries', () => {
    expect(() => parseGoogleA1Range("'MainSheet'!A1:ZZ6,'MainSheet'!A133:ZZ")).toThrow(/single valid A1 range/);
    expect(() => parseGoogleA1Range("'MainSheet'!A10:ZZ9")).toThrow(/single valid A1 range/);
  });

  it('returns explicit HTTP outcomes for success, lease conflicts and partial failures', () => {
    expect(googleSyncHttpStatus({ status: 'SUCCEEDED', failedCount: 0 })).toBe(200);
    const locked = { status: 'PARTIAL', failedCount: 0, errorMessage: 'This sync was skipped because another Google Sheets sync is still running.' };
    expect(googleSyncHttpStatus(locked)).toBe(409);
    const partialFailure = { status: 'PARTIAL', failedCount: 1, errorMessage: '1 source submission failed and the cursor was held.' };
    expect(googleSyncHttpStatus(partialFailure)).toBe(503);
    expect(googleSyncMessage(partialFailure)).toContain('cursor was held');
    expect(googleSyncHttpStatus({ status: 'PARTIAL', failedCount: 0, errorMessage: 'A source submission is durably awaiting Admin review.' })).toBe(207);
  });
});
