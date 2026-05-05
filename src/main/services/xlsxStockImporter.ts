import ExcelJS from 'exceljs';
import path from 'path';
import type { StockKind, StockRow, StockSnapshot } from '../../shared/types';
import { newId, nowIso } from '../utils/id';
import log from '../utils/logger';

interface ColumnMap {
  name: number;
  symbol?: number;
  qty?: number;
  warehouse?: number;
  netS?: number;
  vatS?: number;
  grossS?: number;
  currency?: number;
  oNet?: number;
  oVat?: number;
  oGross?: number;
  manufacturer?: number;
  notes?: number;
  mpFirmaId?: number;
}

function detectColumns(headerRow: ExcelJS.Row): ColumnMap | null {
  const map: Partial<ColumnMap> = {};
  headerRow.eachCell((cell, col) => {
    const v = String(cell.value ?? '').trim();
    const lower = v.toLowerCase();
    if (lower === 'nazwa' || lower === 'name') map.name = col;
    else if (lower === 'symbol') map.symbol = col;
    else if (lower === 'ilość' || lower === 'ilosc' || lower === 'qty' || lower === 'quantity')
      map.qty = col;
    else if (lower === 'magazyn' || lower === 'warehouse') map.warehouse = col;
    else if (lower.startsWith('netto (s)') || lower === 'netto') map.netS = col;
    else if (lower.startsWith('vat (s)')) map.vatS = col;
    else if (lower.startsWith('brutto (s)')) map.grossS = col;
    else if (lower === 'waluta' || lower === 'currency') map.currency = col;
    else if (lower.startsWith('onetto (z)') || lower.startsWith('onetto')) map.oNet = col;
    else if (lower.startsWith('ovat (z)')) map.oVat = col;
    else if (lower.startsWith('obrutto (z)')) map.oGross = col;
    else if (lower.startsWith('symbol producenta') || lower.startsWith('manufacturer'))
      map.manufacturer = col;
    else if (lower === 'uwagi' || lower === 'notes') map.notes = col;
  });
  if (!map.name) return null;
  return map as ColumnMap;
}

function findHeaderRow(ws: ExcelJS.Worksheet): { row: ExcelJS.Row; columns: ColumnMap } | null {
  const limit = Math.min(20, ws.rowCount);
  for (let i = 1; i <= limit; i++) {
    const row = ws.getRow(i);
    const cols = detectColumns(row);
    if (cols && (cols.symbol !== undefined || cols.qty !== undefined)) {
      return { row, columns: cols };
    }
  }
  return null;
}

function asNumber(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/\s/g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof v === 'object' && v !== null && 'result' in v) {
    return asNumber((v as { result: unknown }).result);
  }
  return undefined;
}

function asString(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  }
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object' && v !== null && 'text' in v) {
    return asString((v as { text: unknown }).text);
  }
  return undefined;
}

export async function parseStockXlsx(filePath: string, kind: StockKind): Promise<StockSnapshot> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error(`No worksheet in ${filePath}`);

  const header = findHeaderRow(ws);
  if (!header) throw new Error(`Could not detect header row in ${filePath}`);
  const { row: headerRow, columns } = header;

  const rows: StockRow[] = [];
  const headerNum = headerRow.number;
  for (let i = headerNum + 1; i <= ws.rowCount; i++) {
    const r = ws.getRow(i);
    const name = asString(r.getCell(columns.name).value);
    if (!name) {
      // The MP Firma export typically has the row "ID" in the first column;
      // skip rows where the name cell is empty.
      continue;
    }

    const symbol = columns.symbol ? asString(r.getCell(columns.symbol).value) : undefined;
    const qty = columns.qty ? (asNumber(r.getCell(columns.qty).value) ?? 0) : 0;
    const warehouse = columns.warehouse
      ? asString(r.getCell(columns.warehouse).value)
      : undefined;
    const netS = columns.netS ? asNumber(r.getCell(columns.netS).value) : undefined;
    const vatS = columns.vatS ? asNumber(r.getCell(columns.vatS).value) : undefined;
    const grossS = columns.grossS ? asNumber(r.getCell(columns.grossS).value) : undefined;
    const currency = columns.currency ? asString(r.getCell(columns.currency).value) : undefined;
    const oNet = columns.oNet ? asNumber(r.getCell(columns.oNet).value) : undefined;
    const oVat = columns.oVat ? asNumber(r.getCell(columns.oVat).value) : undefined;
    const oGross = columns.oGross ? asNumber(r.getCell(columns.oGross).value) : undefined;
    const manufacturer = columns.manufacturer
      ? asString(r.getCell(columns.manufacturer).value)
      : undefined;
    const notes = columns.notes ? asString(r.getCell(columns.notes).value) : undefined;

    // The first column in MP Firma exports holds an internal numeric ID without a header label.
    // We capture it as mpFirmaId (best-effort; not used for matching).
    let mpFirmaId: string | undefined;
    if (columns.name > 1) {
      mpFirmaId = asString(r.getCell(1).value);
    }

    rows.push({
      rowKey: `${i}:${symbol ?? name}`,
      mpFirmaId,
      mpFirmaSymbol: symbol,
      name,
      qty,
      warehouse,
      netPrice: netS,
      vatPrice: vatS,
      grossPrice: grossS,
      currency,
      oNet,
      oVat,
      oGross,
      manufacturerSymbol: manufacturer,
      notes,
    });
  }

  log.info(`[stock-import] parsed ${rows.length} rows from ${path.basename(filePath)}`);

  return {
    id: newId(),
    importedAt: nowIso(),
    sourceFile: path.basename(filePath),
    kind,
    rows,
  };
}
