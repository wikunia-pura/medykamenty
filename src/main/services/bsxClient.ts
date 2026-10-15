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

// Per-request timeout. BSX normally answers in well under a second; a hung
// connection must not freeze an import forever.
const REQUEST_TIMEOUT_MS = 30_000;

// The BSX API takes credentials (cloud key, password) and tokens in the GET
// query string, so a URL must never reach an error message, the log or the UI
// with its query: keep only the path ("…/mp/core/login").
function safeUrl(url: string): string {
  const q = url.search(/[?#]/);
  return (q === -1 ? url : url.slice(0, q)).replace(BASE_URL, '');
}

async function bsxFetch(url: string, token?: string): Promise<{ resultCode: number; errorStr?: string; [k: string]: unknown }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const where = safeUrl(url);
  let res: Response;
  let body: string;
  try {
    res = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    body = await res.text();
  } catch (err) {
    const name = (err as Error)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new BsxError(
        `BSX nie odpowiedział w ciągu ${REQUEST_TIMEOUT_MS / 1000} s (${where}). Spróbuj ponownie później.`,
      );
    }
    // Network-level failure (DNS, TLS, connection reset). The underlying
    // error may echo the request URL, so its message is not passed on.
    throw new BsxError(`Brak połączenia z BSX (${where}) — sprawdź połączenie z internetem.`);
  }
  if (!res.ok && body.length === 0) {
    throw new BsxError(`BSX zwrócił błąd HTTP ${res.status} (${where}).`);
  }
  try {
    return parseBsxJson(body);
  } catch {
    // Never echo the body: it can carry a token or credentials.
    throw new BsxError(
      `BSX zwrócił nieprawidłową odpowiedź (HTTP ${res.status}, ${where}, ${body.length} B) — to nie jest JSON.`,
    );
  }
}

// `count` from a list endpoint — BSX sometimes sends it as a string. Returns
// undefined when it isn't a usable number, so callers keep paging until a
// short page instead of stopping after page 1.
function parseCount(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
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
): Promise<{ rows: BsxStockRow[]; count?: number }> {
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
  return { rows, count: parseCount(data.count) };
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
    // A short (or empty) page is always the last one; a known total ends the
    // loop as soon as it is reached.
    if (rows.length < pageSize || (count !== undefined && all.length >= count)) break;
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
): Promise<{ rows: PzHeader[]; count?: number }> {
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
  return { rows, count: parseCount(data.count) };
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

// A line price, or undefined when the field is missing / not a number. A
// missing price must not become a "latest price" of 0.
function parsePrice(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

// PZ ids are numeric strings: "100" is newer than "99". Compare numerically,
// falling back to string order only when an id isn't a number.
function comparePzId(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

async function fetchStockDocWithRetry(
  sessionToken: string,
  id: string,
  attempts = 3,
): Promise<Record<string, unknown>> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fetchStockDoc(sessionToken, id);
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  throw lastErr;
}

/**
 * Builds, for each requested warehouse (`idm1`), a map idproduct → latest PZ
 * line price. "Latest" is `ndate_issue` DESC, then PZ `id` DESC (numeric) as
 * tiebreaker. Status is hard-coded to 2 (Zatwierdzony) so unfinished drafts
 * never leak into pricing.
 *
 * This is the implementation of Model A — "ostatnia cena zakupu". The PZ
 * headers are paged ONCE for all warehouses (the list endpoint has no
 * warehouse filter) and split by `idm1`; each matching document is then
 * fetched for its line items (the list doesn't return them). A document that
 * still fails after a few retries is logged and skipped — one bad PZ must not
 * sink the whole price refresh. Every requested id gets a (possibly empty)
 * map in the result.
 */
export async function fetchLatestPzPricesForWarehouses(
  sessionToken: string,
  warehouseIds: number[],
): Promise<Map<number, Map<string, BsxPzPrice>>> {
  const wanted = Array.from(new Set(warehouseIds));
  const result = new Map<number, Map<string, BsxPzPrice>>();
  for (const id of wanted) result.set(id, new Map());
  if (wanted.length === 0) return result;
  const wantedByKey = new Map(wanted.map((id) => [String(id), id]));

  // 1) Paginate headers once, keeping those of the requested warehouses.
  const pageSize = 100;
  const matching: { header: PzHeader; warehouseId: number }[] = [];
  let start = 0;
  let seen = 0;
  for (let i = 0; i < 1000; i++) {
    const { rows, count } = await listStockDocsPage(sessionToken, start, pageSize);
    seen += rows.length;
    for (const r of rows) {
      const warehouseId = wantedByKey.get(String(r.idm1));
      if (warehouseId !== undefined) matching.push({ header: r, warehouseId });
    }
    start += pageSize;
    if (rows.length < pageSize || (count !== undefined && seen >= count)) break;
  }

  log.info(
    `[bsx] PZ headers: ${seen} scanned, ${matching.length} in warehouses ${wanted.join(', ')}`,
  );

  // 2) Fetch details concurrently. BSX is happy with ~10 parallel requests on
  // the same session token. Each successful request refreshes the token
  // server-side so we don't have to ping during the loop.
  let failed = 0;
  const details = await runConcurrent(matching, 10, async ({ header, warehouseId }) => {
    try {
      const row = await fetchStockDocWithRetry(sessionToken, header.id);
      return { header, warehouseId, row };
    } catch (err) {
      failed++;
      log.warn(`[bsx] PZ id=${header.id} skipped: ${(err as Error)?.message ?? 'unknown error'}`);
      return undefined;
    }
  });
  if (failed > 0) log.warn(`[bsx] ${failed} of ${matching.length} PZ documents could not be read`);
  // A few unreadable documents only cost older prices for their products;
  // none readable (expired session, BSX down) must be an error, not a silent
  // "0 prices loaded".
  if (matching.length > 0 && failed === matching.length) {
    throw new BsxError(`Nie udało się pobrać żadnego z ${matching.length} dokumentów PZ.`);
  }

  // 3) Reduce to "latest per idproduct" per warehouse: ndate_issue
  // ("YYYY-MM-DD…", string order is date order), then numeric PZ id.
  for (const d of details) {
    if (!d) continue;
    const { header, warehouseId, row } = d;
    const latest = result.get(warehouseId)!;
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
      // A line without a real (positive) net price — missing, garbage, or a
      // free-of-charge delivery — can't be the "latest purchase price".
      const netPrice = parsePrice(it.psprice_n);
      if (netPrice === undefined || netPrice <= 0) continue;
      const existing = latest.get(idproduct);
      const isNewer =
        !existing ||
        pzDate > existing.pzDate ||
        (pzDate === existing.pzDate && comparePzId(pzId, existing.pzId) > 0);
      if (!isNewer) continue;
      latest.set(idproduct, {
        idproduct,
        netPrice,
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

  return result;
}

/**
 * Single-warehouse variant, kept for existing callers. Prefer
 * fetchLatestPzPricesForWarehouses when pricing several warehouses — it scans
 * the PZ headers once instead of once per warehouse.
 */
export async function fetchLatestPzPrices(
  sessionToken: string,
  idm1: number,
): Promise<Map<string, BsxPzPrice>> {
  const all = await fetchLatestPzPricesForWarehouses(sessionToken, [idm1]);
  return all.get(idm1) ?? new Map();
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
