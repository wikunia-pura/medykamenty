import React, { useState } from 'react';
import { useT } from '../i18n';
import NumberInput from './NumberInput';
import HoverTooltip from './HoverTooltip';
import { IconEdit, IconCheck, IconClose, IconInfo } from './Icons';
import type { StockBatch, StockSource } from '../../shared/types';
import { effectiveExpiry, isExpired, daysUntilExpiry } from '../../shared/expiry';

interface Props {
  qty?: number;
  unit: string; // display label, e.g. "kg" or "szt."
  source?: StockSource;
  updatedAt?: string;
  sourceFile?: string;
  // Free-text warehouse note (from the "Magazyn" import). When set, an info
  // icon with a hover tooltip is shown next to the stock value.
  note?: string;
  // Stock split into expiry batches (raw materials). When present the cell
  // shows the per-batch quantities slash-separated with the total beside them,
  // and an info tooltip lists each batch's expiry (expired ones highlighted).
  batches?: StockBatch[];
  // Persists a manual stock edit. Resolves once the catalog has been updated.
  // For a batched material a manual edit replaces the batches with a single
  // no-expiry value (handled by the caller).
  onCommit: (qty: number) => Promise<void>;
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

// Renders the catalog stock value with a source badge (manual / import) and an
// inline editor. Editing here always flags the item as manually set — see
// setManualStock in the IPC layer.
const StockCell: React.FC<Props> = ({
  qty,
  unit,
  source,
  updatedAt,
  sourceFile,
  note,
  batches,
  onCommit,
}) => {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<number | undefined>(qty);
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setDraft(qty);
    setEditing(true);
  };

  const commit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onCommit(draft ?? 0);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <td className="num">
        <div className="stock-edit">
          <NumberInput
            className="input stock-edit-input"
            value={draft}
            emptyValue={0}
            step="0.001"
            onChange={setDraft}
            disabled={saving}
          />
          <button
            type="button"
            className="btn btn-sm soft-success"
            onClick={() => void commit()}
            disabled={saving}
            title={t.save}
          >
            <IconCheck size={12} />
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setEditing(false)}
            disabled={saving}
            title={t.cancel}
          >
            <IconClose size={12} />
          </button>
        </div>
      </td>
    );
  }

  const dateLabel = updatedAt ? new Date(updatedAt).toLocaleString() : undefined;
  const badgeTitle = [
    dateLabel ? `${t.stockUpdatedAt}: ${dateLabel}` : undefined,
    sourceFile ? `${t.stockSourceLabel}: ${sourceFile}` : undefined,
  ]
    .filter(Boolean)
    .join('\n');

  const hasBatches = !!batches && batches.length > 0;
  const anyExpired = hasBatches && batches!.some((b) => isExpired(b));

  return (
    <td className="num">
      <div className="stock-cell">
        {hasBatches ? (
          <>
            <span className="stock-split">
              {batches!.map((b, i) => (
                <React.Fragment key={b.id}>
                  {i > 0 && <span className="stock-split-sep">/</span>}
                  <span className={isExpired(b) ? 'stock-split-expired' : undefined}>
                    {b.qty.toLocaleString()}
                  </span>
                </React.Fragment>
              ))}
            </span>
            <span className="stock-qty stock-qty-total">
              {(qty ?? 0).toLocaleString()} {unit}
            </span>
            <HoverTooltip
              align="right"
              triggerClassName={`stock-note-icon${anyExpired ? ' stock-note-icon-warn' : ''}`}
              trigger={<IconInfo size={13} />}
            >
              <div className="shortage-tooltip-header">{t.stockBatches}</div>
              <ul className="stock-batch-list">
                {batches!.map((b) => {
                  const eff = effectiveExpiry(b);
                  const expired = isExpired(b);
                  const days = daysUntilExpiry(b);
                  const retested = !!b.retestExpiryDate;
                  return (
                    <li key={b.id} className={expired ? 'stock-batch-expired' : undefined}>
                      <span className="stock-batch-qty">
                        {b.qty.toLocaleString()} {unit}
                      </span>
                      <span className="stock-batch-exp">
                        {eff ? (
                          <>
                            {t.expiry}: {fmtDate(eff)}
                            {retested && (
                              <span className="stock-batch-retest">
                                {' '}
                                ({t.expiryOriginal}: {fmtDate(b.expiryDate)})
                              </span>
                            )}
                            {expired ? (
                              <span className="stock-batch-flag">{t.expired}</span>
                            ) : days !== undefined && days <= 90 ? (
                              <span className="stock-batch-soon">
                                {t.expiresInDays.replace('{n}', String(days))}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          t.noExpiry
                        )}
                      </span>
                      {b.note && <span className="stock-batch-note">{b.note}</span>}
                    </li>
                  );
                })}
              </ul>
            </HoverTooltip>
          </>
        ) : (
          <span className="stock-qty">
            {qty === undefined ? '—' : `${qty.toLocaleString()} ${unit}`}
          </span>
        )}
        {note && note.trim() !== '' && (
          <HoverTooltip
            align="right"
            triggerClassName="stock-note-icon"
            trigger={<IconInfo size={13} />}
          >
            <div className="shortage-tooltip-header">{t.stockNote}</div>
            <div className="stock-note-text">{note}</div>
          </HoverTooltip>
        )}
        {source && (
          <span
            className={`tag ${source === 'manual' ? 'warn' : ''} stock-badge`}
            title={badgeTitle || undefined}
          >
            {source === 'manual' ? t.stockSourceManual : t.stockSourceImport}
          </span>
        )}
        <button
          type="button"
          className="btn btn-sm soft-edit stock-edit-btn"
          onClick={startEdit}
          title={t.stockEditManual}
        >
          <IconEdit size={12} />
        </button>
      </div>
    </td>
  );
};

export default StockCell;
