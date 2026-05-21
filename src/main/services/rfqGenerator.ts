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
  return `- ${line.itemName} — ${qty} ${unit}`;
}

// Components-only groups use the order template; raw-material groups (and the
// rare mixed group, which shouldn't happen once suppliers have a `type`) use
// the inquiry template that also asks for expiry date.
function isComponentGroup(group: ShortageGroup): boolean {
  const hasRaw = group.rawLines.some((l) => l.shortage > 0);
  const hasComponent = group.componentLines.some((l) => l.shortage > 0);
  return hasComponent && !hasRaw;
}

function buildBody(group: ShortageGroup, lang: Lang): string {
  const lines = [...group.rawLines, ...group.componentLines].filter((l) => l.shortage > 0);
  const items = lines.map((l) => formatLine(l, lang)).join('\n');
  const componentOnly = isComponentGroup(group);

  if (lang === 'pl') {
    if (componentOnly) {
      return `Dzień dobry, uprzejmie proszę o informację o cenie oraz czasie realizacji zamówienia na poniższe produkty:\n\n${items}`;
    }
    return `Dzień dobry,\n\nUprzejmie proszę o informację o cenie, czasie realizacji zamówienia oraz terminie ważności dla:\n${items}`;
  }
  if (componentOnly) {
    return `Hello, I would like to request a quote and lead time for the following products:\n\n${items}`;
  }
  return `Hello,\n\nI would like to request a quote, lead time, and expiry date for:\n${items}`;
}

function buildSubject(group: ShortageGroup, lang: Lang): string {
  if (isComponentGroup(group)) {
    return lang === 'pl' ? 'Zamówienie myLab' : 'myLab order';
  }
  const rawNames = group.rawLines.filter((l) => l.shortage > 0).map((l) => l.itemName);
  const componentNames = group.componentLines.filter((l) => l.shortage > 0).map((l) => l.itemName);
  const names = (rawNames.length > 0 ? rawNames : componentNames).join(', ');
  return lang === 'pl'
    ? `Pytanie o dostępność surowca ${names}`
    : `Raw material availability inquiry: ${names}`;
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
    const subject = buildSubject(group, lang);
    let refinedByAI = false;

    if (opts.useAI && isAiAvailable()) {
      try {
        body = await rewriteEmail(body, lang, {
          supplierName: group.supplierName,
          subject,
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
      subject,
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
    batchName: entry.reportName,
    reportComputedAt: entry.computedAt,
    generatedAt: nowIso(),
    language: opts.language,
    emails: records,
    ...(entry.orderId ? { orderId: entry.orderId } : {}),
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
  const subject = buildSubject(group, opts.language);
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
