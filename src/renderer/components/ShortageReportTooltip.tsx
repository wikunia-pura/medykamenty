import React from 'react';
import { useT } from '../i18n';
import type {
  EmailBatch,
  ShortageLine,
  ShortageReportEntry,
} from '../../shared/types';
import HoverTooltip from './HoverTooltip';
import { IconCheck } from './Icons';

interface Props {
  entry: ShortageReportEntry;
  batches: EmailBatch[];
}

const fmt = (n: number, unit: ShortageLine['unit']) =>
  n.toFixed(unit === 'pcs' ? 0 : 2);

const missingLinesFor = (e: ShortageReportEntry): ShortageLine[] =>
  [...e.report.rawLines, ...e.report.componentLines]
    .filter((l) => l.shortage > 0)
    .sort((a, b) => b.shortage - a.shortage);

const groupStatusFor = (
  entry: ShortageReportEntry,
  batches: EmailBatch[],
): {
  supplierId?: string;
  supplierName: string;
  sentAt?: string;
  receivedAt?: string;
}[] => {
  const reportBatches = batches
    .filter((b) => b.reportId === entry.id)
    .sort(
      (a, b) =>
        new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime(),
    );
  const receiptByKey = new Map(
    (entry.supplierReceipts ?? []).map((r) => [r.supplierId, r.receivedAt]),
  );
  return entry.report.groups.map((g) => {
    const key = g.supplierId ?? '__none__';
    let sentAt: string | undefined;
    for (const b of reportBatches) {
      const email = b.emails.find((em) =>
        g.supplierId ? em.supplierId === g.supplierId : !em.supplierId,
      );
      if (email) {
        sentAt = email.sentAt;
        break;
      }
    }
    return {
      supplierId: g.supplierId,
      supplierName: g.supplierName,
      sentAt,
      receivedAt: receiptByKey.get(key),
    };
  });
};

const ShortageReportTooltip: React.FC<Props> = ({ entry, batches }) => {
  const t = useT();
  const missing = missingLinesFor(entry);
  const groups = entry.report.groups.length;

  if (missing.length === 0) {
    return <span className="tag success">{t.noShortages}</span>;
  }

  const statuses = groupStatusFor(entry, batches);
  const statusBySupplier = new Map(
    statuses.map((s) => [s.supplierId ?? '__none__', s]),
  );
  const supplierStatuses = statuses.filter((s) => s.sentAt || s.receivedAt);

  return (
    <HoverTooltip
      className="shortage-tooltip-wide"
      trigger={
        <span className="shortage-summary">
          <strong className="shortage-count">{missing.length}</strong>
          <span className="hint">
            {missing.length === 1 ? 'brakująca pozycja' : 'brakujących pozycji'}
            {' · '}
            {groups} {groups === 1 ? 'dostawca' : 'dostawców'}
          </span>
        </span>
      }
    >
      <div className="shortage-tooltip-header">
        {t.shortageReport} — {missing.length}{' '}
        {missing.length === 1 ? 'pozycja' : 'pozycji'}
      </div>
      <ul className="shortage-tooltip-list">
        {missing.map((line) => {
          const lineStatus = statusBySupplier.get(
            line.preferredSupplierId ?? '__none__',
          );
          const hasStatus = !!lineStatus?.sentAt || !!lineStatus?.receivedAt;
          return (
            <li key={`${line.itemKind}-${line.itemId}`}>
              <span className="shortage-tooltip-name">{line.itemName}</span>
              <span className="shortage-tooltip-amount">
                {fmt(line.shortage, line.unit)} {line.unit}
              </span>
              <span
                className={`shortage-tooltip-line-status${hasStatus ? '' : ' is-empty'}`}
              >
                <span className="shortage-tooltip-status-slot">
                  {lineStatus?.sentAt && (
                    <span
                      className="tag success"
                      title={`${t.sentAtLabel}: ${new Date(lineStatus.sentAt).toLocaleString()}`}
                    >
                      <IconCheck size={10} /> {t.mailSentBadge}
                    </span>
                  )}
                </span>
                <span className="shortage-tooltip-status-slot">
                  {lineStatus?.receivedAt && (
                    <span
                      className="tag success"
                      title={`${t.receivedAtLabel}: ${new Date(lineStatus.receivedAt).toLocaleString()}`}
                    >
                      <IconCheck size={10} /> {t.receivedBadge}
                    </span>
                  )}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {supplierStatuses.length > 0 && (
        <div className="shortage-tooltip-section">
          <div className="shortage-tooltip-section-header">{t.suppliers}</div>
          <ul className="shortage-tooltip-list">
            {supplierStatuses.map((s) => (
              <li key={s.supplierId ?? '__none__'}>
                <span className="shortage-tooltip-name">{s.supplierName}</span>
                <span className="shortage-tooltip-amount">
                  {s.sentAt && (
                    <span
                      className="tag success"
                      title={`${t.sentAtLabel}: ${new Date(s.sentAt).toLocaleString()}`}
                    >
                      <IconCheck size={10} /> {t.mailSentBadge}
                    </span>
                  )}
                  {s.receivedAt && (
                    <span
                      className="tag success"
                      style={{ marginLeft: 4 }}
                      title={`${t.receivedAtLabel}: ${new Date(s.receivedAt).toLocaleString()}`}
                    >
                      <IconCheck size={10} /> {t.receivedBadge}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </HoverTooltip>
  );
};

export default ShortageReportTooltip;
