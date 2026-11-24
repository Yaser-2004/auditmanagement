import { GoogleSheetsIntegrationError } from './errors';
import { googleSheetHeaderRowIndex } from './normalize';

export type ParsedGoogleA1Range = {
  prefix: string;
  startColumn: string;
  endColumn: string;
  firstRow: number;
  lastRow: number | null;
};

export type GoogleSheetReadConfig = {
  spreadsheetId: string;
  range: string;
  sheetName: string;
  stageMode: 'SEQUENCE' | 'EXPLICIT';
};

export type GoogleSheetReadResult = {
  values: unknown[][];
  spreadsheetId: string;
  sheetName: string;
  range: string;
  stageMode: 'SEQUENCE' | 'EXPLICIT';
  sourceStartRow: number;
  sourceDataStartRow?: number;
  endRow: number;
  incrementalSupported: boolean;
};

export type ReadA1Range = (range: string) => Promise<unknown[][]>;

function invalidRange(range: string): never {
  throw new GoogleSheetsIntegrationError(
    `GOOGLE_SHEETS_RANGE must be a single valid A1 range (received “${range.slice(0, 120)}”).`,
    'GOOGLE_SHEETS_RANGE_INVALID',
    400,
  );
}

function columnNumber(column: string) {
  return [...column].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0);
}

export function parseGoogleA1Range(value: string): ParsedGoogleA1Range {
  const range = value.trim();
  if (!range || range.includes(',')) return invalidRange(value);
  const bang = range.lastIndexOf('!');
  const prefix = bang >= 0 ? range.slice(0, bang + 1) : '';
  if (bang >= 0 && (!range.slice(0, bang).trim() || range.indexOf('!') !== bang)) return invalidRange(value);
  const cells = (bang >= 0 ? range.slice(bang + 1) : range).replace(/\$/g, '');
  const match = cells.match(/^([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/i);
  if (!match) return invalidRange(value);
  const startColumn = match[1].toUpperCase();
  const endColumn = (match[3] ?? match[1]).toUpperCase();
  const firstRow = Number(match[2] || 1);
  const lastRow = match[4] ? Number(match[4]) : null;
  if (!Number.isSafeInteger(firstRow) || firstRow < 1 || (lastRow !== null && (!Number.isSafeInteger(lastRow) || lastRow < firstRow))) return invalidRange(value);
  if (columnNumber(endColumn) < columnNumber(startColumn)) return invalidRange(value);
  return { prefix, startColumn, endColumn, firstRow, lastRow };
}

export async function readFullGoogleSheet(config: GoogleSheetReadConfig, readRange: ReadA1Range): Promise<GoogleSheetReadResult> {
  const parsed = parseGoogleA1Range(config.range);
  const values = await readRange(config.range);
  const endRow = values.length ? parsed.firstRow + values.length - 1 : parsed.firstRow - 1;
  return {
    values,
    spreadsheetId: config.spreadsheetId,
    sheetName: config.sheetName,
    range: config.range,
    stageMode: config.stageMode,
    sourceStartRow: parsed.firstRow,
    endRow: parsed.lastRow === null ? endRow : Math.min(endRow, parsed.lastRow),
    incrementalSupported: true,
  };
}

/**
 * Reads the compact Form header and the append range with two independent
 * values.get calls. A range list must never be passed as one A1 range string.
 */
export async function readIncrementalGoogleSheet(config: GoogleSheetReadConfig, cursorRow: number, readRange: ReadA1Range): Promise<GoogleSheetReadResult> {
  const parsed = parseGoogleA1Range(config.range);
  const headerEndRow = Math.min(parsed.firstRow + 5, parsed.lastRow ?? parsed.firstRow + 5);
  const headerRange = `${parsed.prefix}${parsed.startColumn}${parsed.firstRow}:${parsed.endColumn}${headerEndRow}`;
  const headerRows = await readRange(headerRange);
  if (!headerRows.length) {
    return {
      values: [], spreadsheetId: config.spreadsheetId, sheetName: config.sheetName, range: config.range,
      stageMode: config.stageMode, sourceStartRow: parsed.firstRow,
      sourceDataStartRow: Math.max(cursorRow + 1, parsed.firstRow + 1), endRow: cursorRow, incrementalSupported: true,
    };
  }

  let headerIndex: number;
  try { headerIndex = googleSheetHeaderRowIndex(headerRows); }
  catch {
    throw new GoogleSheetsIntegrationError('The configured header rows do not contain the required Audit ID and Counsellor Email columns.', 'GOOGLE_SHEETS_HEADER_INVALID', 400);
  }
  const header = headerRows[headerIndex];
  const sourceDataStartRow = Math.max(cursorRow + 1, parsed.firstRow + headerIndex + 1);
  if (parsed.lastRow !== null && sourceDataStartRow > parsed.lastRow) {
    return {
      values: [header], spreadsheetId: config.spreadsheetId, sheetName: config.sheetName, range: config.range,
      stageMode: config.stageMode, sourceStartRow: parsed.firstRow, sourceDataStartRow,
      endRow: cursorRow, incrementalSupported: true,
    };
  }

  const dataRange = `${parsed.prefix}${parsed.startColumn}${sourceDataStartRow}:${parsed.endColumn}${parsed.lastRow ?? ''}`;
  const dataRows = await readRange(dataRange);
  const endRow = dataRows.length ? sourceDataStartRow + dataRows.length - 1 : cursorRow;
  return {
    values: [header, ...dataRows], spreadsheetId: config.spreadsheetId, sheetName: config.sheetName,
    range: config.range, stageMode: config.stageMode, sourceStartRow: parsed.firstRow,
    sourceDataStartRow, endRow: parsed.lastRow === null ? endRow : Math.min(endRow, parsed.lastRow), incrementalSupported: true,
  };
}

/** Keep the cursor at its previous position unless every fetched row is durable. */
export function committedGoogleSheetCursor(currentRow: number, scannedEndRow: number, rowsAreDurable: boolean) {
  return rowsAreDurable ? Math.max(currentRow, scannedEndRow) : currentRow;
}
