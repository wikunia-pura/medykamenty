import type Database from '../database';
import type { Lang, RFQEmail, ShortageGroup, ShortageLine } from '../../shared/types';
import { computeShortages } from './shortageCalculator';
import { rewriteEmail } from './llmClient';
import { isAiAvailable } from '../aiConfig';
import log from '../utils/logger';

interface GenerateOptions {
  language: Lang;
  useAI: boolean;
  sendToAllAlternatives?: boolean;
}

function formatLine(line: ShortageLine, lang: Lang): string {
  const qty = line.suggestedOrder.toFixed(line.unit === 'pcs' ? 0 : 2);
  const unit = line.unit === 'pcs' ? (lang === 'pl' ? 'szt.' : 'pcs') : line.unit;
  const moqInfo = line.moq
    ? lang === 'pl'
      ? ` (MOQ: ${line.moq} ${unit})`
      : ` (MOQ: ${line.moq} ${unit})`
    : '';
  return `- ${line.itemName} — ${qty} ${unit}${moqInfo}`;
}

function buildBody(group: ShortageGroup, lang: Lang): string {
  const allLines = [...group.rawLines, ...group.componentLines].filter((l) => l.shortage > 0);
  const today = new Date().toISOString().slice(0, 10);

  if (lang === 'pl') {
    const intro = `Dzień dobry,\n\nZwracam się z prośbą o wycenę następujących pozycji:\n`;
    const items = allLines.map((l) => formatLine(l, 'pl')).join('\n');
    const outro =
      '\n\nProszę o potwierdzenie ceny netto, dostępności, czasu realizacji oraz terminu ważności.\n' +
      `Data zapytania: ${today}.\n\nPozdrawiam,\nCutis`;
    return `${intro}${items}${outro}`;
  }
  const intro = `Hello,\n\nI would like to request a quote for the following items:\n`;
  const items = allLines.map((l) => formatLine(l, 'en')).join('\n');
  const outro =
    '\n\nPlease confirm net price, availability, lead time, and expiry date.\n' +
    `Request date: ${today}.\n\nBest regards,\nCutis`;
  return `${intro}${items}${outro}`;
}

function buildSubject(lang: Lang): string {
  const today = new Date().toISOString().slice(0, 10);
  return lang === 'pl' ? `Zapytanie ofertowe — ${today}` : `Quote request — ${today}`;
}

export async function generateEmails(
  planId: string,
  opts: GenerateOptions,
  db: Database,
): Promise<RFQEmail[]> {
  const report = computeShortages(planId, db);
  const suppliers = new Map(db.listSuppliers().map((s) => [s.id, s]));

  const emails: RFQEmail[] = [];

  for (const group of report.groups) {
    const lines = [...group.rawLines, ...group.componentLines].filter((l) => l.shortage > 0);
    if (lines.length === 0) continue;

    const supplier = group.supplierId ? suppliers.get(group.supplierId) : undefined;
    const lang: Lang = supplier?.preferredEmailLanguage ?? opts.language;

    let body = buildBody(group, lang);
    let refinedByAI = false;

    if (opts.useAI && isAiAvailable()) {
      try {
        body = await rewriteEmail(body, lang, {
          supplierName: group.supplierName,
          subject: buildSubject(lang),
        });
        refinedByAI = true;
      } catch (err) {
        log.warn(`[rfq] AI rewrite failed for ${group.supplierName}: ${(err as Error).message}`);
      }
    }

    emails.push({
      supplierId: group.supplierId,
      supplierName: group.supplierName,
      to: group.supplierEmail ?? '',
      language: lang,
      subject: buildSubject(lang),
      body,
      lines,
      refinedByAI,
    });
  }

  if (opts.sendToAllAlternatives) {
    // Generate additional emails for non-preferred alternative suppliers per item.
    // For simplicity we group by supplierId across all alternative suppliers found on items.
    // Skipped for MVP-1; placeholder for v1.5.
  }

  return emails;
}
