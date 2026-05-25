// Client for the BSX Online warehouse API (bsxCloud, mpFirma module).
//
// Auth is a two-step handshake:
//   1. GET /mp/core/verifyCloudKey?key=<CLOUD_KEY>            -> cloud token
//   2. GET /mp/core/login?username&password&force=1           -> session token
//      (Authorization: Bearer <cloud-token>)
// After login, every subsequent call uses the session token. The token is
// short-lived (~15 min) and refreshed on every successful request, so a single
// import run can chain calls without re-authenticating.
//
// BSX occasionally embeds raw control characters (CR/LF, NUL) inside JSON
// string fields — notably the user permissions blob — which makes strict JSON
// parsers throw. parseBsxJson strips them before parsing.

import log from '../utils/logger';

const BASE_URL = 'https://api.bsxonline.pl/api';

// Strip ASCII control chars except \t (0x09), \n (0x0a) and \r (0x0d) which
// JSON would normally escape. BSX sends raw \r\n inside ppermdata.
const CTRL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g;

export interface BsxStockRow {
  // composite "productId|warehouseId", e.g. "521|6"
  id: string;
  pname: string;
  pquantity: string;
  pavailable?: string;
  preserved?: string;
  punit?: string;
  psymbol?: string;
  pcatsymbol?: string;
  pmansymbol?: string;
  pproducent?: string;
  idm?: string;
  idm_title?: string;
  modyf_time?: string;
  [key: string]: unknown;
}

export class BsxError extends Error {
  constructor(
    message: string,
    public readonly resultCode?: number,
    public readonly step?: 'verifyCloudKey' | 'login' | 'stockList',
  ) {
    super(message);
    this.name = 'BsxError';
  }
}

function parseBsxJson(raw: string): { resultCode: number; errorStr?: string; [k: string]: unknown } {
  return JSON.parse(raw.replace(CTRL_RE, ''));
}

async function bsxFetch(url: string, token?: string): Promise<{ resultCode: number; errorStr?: string; [k: string]: unknown }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { method: 'GET', headers });
  const body = await res.text();
  if (!res.ok && body.length === 0) {
    throw new BsxError(`HTTP ${res.status} from ${url}`);
  }
  try {
    return parseBsxJson(body);
  } catch (err) {
    throw new BsxError(`Invalid JSON from BSX (${(err as Error).message}): ${body.slice(0, 200)}`);
  }
}

async function verifyCloudKey(cloudKey: string): Promise<string> {
  const url = `${BASE_URL}/mp/core/verifyCloudKey?key=${encodeURIComponent(cloudKey)}`;
  const data = await bsxFetch(url);
  if (data.resultCode !== 100 || typeof data.token !== 'string') {
    throw new BsxError(
      data.errorStr || `verifyCloudKey failed (resultCode=${data.resultCode})`,
      data.resultCode,
      'verifyCloudKey',
    );
  }
  return data.token;
}

async function loginUser(cloudToken: string, username: string, password: string): Promise<string> {
  const params = new URLSearchParams({
    username,
    password,
    force: '1',
  });
  const url = `${BASE_URL}/mp/core/login?${params.toString()}`;
  const data = await bsxFetch(url, cloudToken);
  if (data.resultCode !== 100 || typeof data.token !== 'string') {
    throw new BsxError(
      data.errorStr || `login failed (resultCode=${data.resultCode})`,
      data.resultCode,
      'login',
    );
  }
  return data.token;
}

async function stockListPage(
  sessionToken: string,
  idstock: number,
  start: number,
  limit: number,
): Promise<{ rows: BsxStockRow[]; count: number }> {
  const params = new URLSearchParams({
    idstock: String(idstock),
    start: String(start),
    limit: String(limit),
  });
  const url = `${BASE_URL}/mp/stock/list?${params.toString()}`;
  const data = await bsxFetch(url, sessionToken);
  if (data.resultCode !== 100) {
    throw new BsxError(
      data.errorStr || `stock/list failed (resultCode=${data.resultCode})`,
      data.resultCode,
      'stockList',
    );
  }
  const rows = (data.rows as BsxStockRow[] | undefined) ?? [];
  const count = typeof data.count === 'number' ? data.count : rows.length;
  return { rows, count };
}

export async function fetchStockForWarehouse(
  sessionToken: string,
  idstock: number,
): Promise<BsxStockRow[]> {
  const pageSize = 100;
  const all: BsxStockRow[] = [];
  let start = 0;
  // First page tells us the total count; loop until we have them all.
  // Guard against runaway loops with a hard cap (100k rows).
  for (let i = 0; i < 1000; i++) {
    const { rows, count } = await stockListPage(sessionToken, idstock, start, pageSize);
    all.push(...rows);
    if (all.length >= count || rows.length < pageSize) break;
    start += pageSize;
  }
  return all;
}

export interface BsxWarehouse {
  id: number;
  title: string;
  symbol?: string;
  ownerName?: string;
}

export async function fetchWarehouses(sessionToken: string): Promise<BsxWarehouse[]> {
  const url = `${BASE_URL}/mp/stocks/list`;
  const data = await bsxFetch(url, sessionToken);
  if (data.resultCode !== 100) {
    throw new BsxError(
      data.errorStr || `stocks/list failed (resultCode=${data.resultCode})`,
      data.resultCode,
      'stockList',
    );
  }
  const rows = (data.rows as Array<Record<string, unknown>> | undefined) ?? [];
  return rows.map((r) => ({
    id: Number(r.id),
    title: String(r.ptitle ?? '').trim() || `#${r.id}`,
    symbol: typeof r.psymbol === 'string' && r.psymbol.trim() ? r.psymbol.trim() : undefined,
    ownerName: typeof r.sname === 'string' && r.sname.trim() ? r.sname.trim() : undefined,
  }));
}

// One PZ line item, distilled to what we need for cost reporting.
export interface BsxPzPrice {
  idproduct: string;
  netPrice: number;
  vatPrice: number;
  grossPrice: number;
  vatRate: number;
  currency: string;
  pzDate: string;
  pzId: string;
  pzNo: string;
  supplier?: string;
}

interface PzHeader {
  id: string;
  idm1: string;
  ndate_issue: string;
  nstatus: string;
  pname?: string;
}

async function listStockDocsPage(
  sessionToken: string,
  start: number,
  limit: number,
): Promise<{ rows: PzHeader[]; count: number }> {
  const params = new URLSearchParams({
    ntype: '0', // PZ
    nstatus: '2', // Zatwierdzony
    start: String(start),
    limit: String(limit),
    orderby: 'id DESC',
  });
  const url = `${BASE_URL}/mp/stockdocuments/list?${params.toString()}`;
  const data = await bsxFetch(url, sessionToken);
  if (data.resultCode !== 100) {
    throw new BsxError(
      data.errorStr || `stockdocuments/list failed (resultCode=${data.resultCode})`,
      data.resultCode,
      'stockList',
    );
  }
  const rows = ((data.rows as PzHeader[] | undefined) ?? []) as PzHeader[];
  const count = typeof data.count === 'number' ? data.count : rows.length;
  return { rows, count };
}

async function fetchStockDoc(sessionToken: string, id: string): Promise<Record<string, unknown>> {
  const url = `${BASE_URL}/mp/stockdocuments/get?id=${encodeURIComponent(id)}`;
  const data = await bsxFetch(url, sessionToken);
  if (data.resultCode !== 100) {
    throw new BsxError(
      data.errorStr || `stockdocuments/get failed (resultCode=${data.resultCode})`,
      data.resultCode,
      'stockList',
    );
  }
  return (data.row as Record<string, unknown>) ?? {};
}

// Runs `tasks` with at most `concurrency` in flight at once. Returns results
// in input order. Errors propagate from Promise.all of each batch wave.
async function runConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

function parseNum(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Builds a map: idproduct → latest PZ line price, scoped to PZ documents
 * that landed in the given warehouse (`idm1`). "Latest" is determined by
 * `ndate_issue` DESC, then PZ `id` DESC as tiebreaker. Status is hard-coded
 * to 2 (Zatwierdzony) so unfinished drafts never leak into pricing.
 *
 * This is the implementation of Model A — "ostatnia cena zakupu". It pulls
 * ALL matching PZ headers (paginated) and fetches their details concurrently
 * because the list endpoint doesn't return line items.
 */
export async function fetchLatestPzPrices(
  sessionToken: string,
  idm1: number,
): Promise<Map<string, BsxPzPrice>> {
  // 1) Paginate headers, filtering to our warehouse.
  const pageSize = 100;
  const matching: PzHeader[] = [];
  let start = 0;
  for (let i = 0; i < 1000; i++) {
    const { rows, count } = await listStockDocsPage(sessionToken, start, pageSize);
    for (const r of rows) {
      if (String(r.idm1) === String(idm1)) matching.push(r);
    }
    start += pageSize;
    if (start >= count || rows.length < pageSize) break;
  }

  log.info(`[bsx] PZ headers for idm1=${idm1}: ${matching.length} matching`);

  // 2) Fetch details concurrently. BSX is happy with ~10 parallel requests on
  // the same session token. Each successful request refreshes the token
  // server-side so we don't have to ping during the loop.
  const details = await runConcurrent(matching, 10, async (h) => {
    const row = await fetchStockDoc(sessionToken, h.id);
    return { header: h, row };
  });

  // 3) Reduce to "latest per idproduct" using ndate_issue then id as the
  // ordering key — string comparison works for "YYYY-MM-DD" and numeric ids
  // are padded by ndate's same length, so we just compare the tuple.
  const latest = new Map<string, BsxPzPrice>();
  for (const { header, row } of details) {
    const items = ((row.items as { rows?: unknown[] } | undefined)?.rows ?? []) as Array<
      Record<string, unknown>
    >;
    const pzDate = String(header.ndate_issue ?? '');
    const pzId = String(header.id ?? '');
    const supplier =
      typeof row.pname === 'string' && row.pname.trim() ? row.pname.trim() : undefined;
    const currency = String((row as { ncurrency?: unknown }).ncurrency ?? 'PLN');
    for (const it of items) {
      const idproduct = String(it.idproduct ?? '');
      if (!idproduct) continue;
      const existing = latest.get(idproduct);
      const isNewer =
        !existing ||
        pzDate > existing.pzDate ||
        (pzDate === existing.pzDate && pzId > existing.pzId);
      if (!isNewer) continue;
      latest.set(idproduct, {
        idproduct,
        netPrice: parseNum(it.psprice_n),
        vatPrice: parseNum(it.psprice_v),
        grossPrice: parseNum(it.psprice_b),
        vatRate: parseNum(it.psrate_v),
        currency: String((it as { oncurrency?: unknown }).oncurrency ?? currency),
        pzDate,
        pzId,
        pzNo: String((it as { onnodoc?: unknown }).onnodoc ?? row.nnodoc ?? ''),
        supplier,
      });
    }
  }

  return latest;
}

export interface BsxSession {
  cloudToken: string;
  sessionToken: string;
}

export async function authenticate(
  cloudKey: string,
  username: string,
  password: string,
): Promise<BsxSession> {
  const cloudToken = await verifyCloudKey(cloudKey);
  const sessionToken = await loginUser(cloudToken, username, password);
  log.info('[bsx] authenticated, session established');
  return { cloudToken, sessionToken };
}
