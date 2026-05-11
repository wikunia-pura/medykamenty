import type Database from '../database';
import type {
  EmailBatch,
  Lang,
  RFQEmailRecord,
  ShortageGroup,
  ShortageLine,
} from '../../shared/types';
import { rewriteEmail } from './llmClient';
import { isAiAvailable } from '../aiConfig';
import { newId, nowIso } from '../utils/id';
import log from '../utils/logger';

interface GenerateOptions {
  language: Lang;
  useAI: boolean;
  sendToAllAlternatives?: boolean;
}

function formatLine(line: ShortageLine, lang: Lang): string {
  const qty = line.suggestedOrder.toFixed(line.unit === 'pcs' ? 0 : 2);
  const unit = line.unit === 'pcs' ? (lang === 'pl' ? 'szt.' : 'pcs') : line.unit;
  const moqInfo = line.moq ? ` (MOQ: ${line.moq} ${unit})` : '';
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

export async function generateEmailsForReport(
  reportId: string,
  opts: GenerateOptions,
  db: Database,
): Promise<EmailBatch> {
  const entry = await db.getShortageReport(reportId);
  if (!entry) throw new Error(`Shortage report ${reportId} not found`);

  const suppliers = new Map((await db.listSuppliers()).map((s) => [s.id, s]));
  const records: RFQEmailRecord[] = [];

  for (const group of entry.report.groups) {
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

    records.push({
      id: newId(),
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

  const batch: EmailBatch = {
    id: newId(),
    reportId: entry.id,
    planId: entry.planId,
    planName: entry.planName,
    reportName: entry.reportName,
    reportComputedAt: entry.computedAt,
    generatedAt: nowIso(),
    language: opts.language,
    emails: records,
  };

  await db.addEmailBatch(batch);
  return batch;
}

export async function regenerateBatchEmail(
  batchId: string,
  emailId: string,
  opts: { language: Lang; useAI: boolean },
  db: Database,
): Promise<EmailBatch> {
  const batch = await db.getEmailBatch(batchId);
  if (!batch) throw new Error(`Email batch ${batchId} not found`);
  const email = batch.emails.find((e) => e.id === emailId);
  if (!email) throw new Error(`Email ${emailId} not found in batch ${batchId}`);

  const group: ShortageGroup = {
    supplierId: email.supplierId,
    supplierName: email.supplierName,
    supplierEmail: email.to || undefined,
    rawLines: email.lines.filter((l) => l.itemKind === 'raw'),
    componentLines: email.lines.filter((l) => l.itemKind === 'component'),
  };

  let body = buildBody(group, opts.language);
  const subject = buildSubject(opts.language);
  let refinedByAI = false;

  if (opts.useAI && isAiAvailable()) {
    try {
      body = await rewriteEmail(body, opts.language, {
        supplierName: email.supplierName,
        subject,
      });
      refinedByAI = true;
    } catch (err) {
      log.warn(`[rfq] AI rewrite failed for ${email.supplierName}: ${(err as Error).message}`);
    }
  }

  const updated = await db.updateBatchEmail(batchId, emailId, {
    body,
    subject,
    language: opts.language,
    refinedByAI,
  });
  if (!updated) throw new Error('Failed to persist regenerated email');
  return updated;
}
