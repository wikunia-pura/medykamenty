import React, { useState } from 'react';
import { useT } from '../i18n';
import NumberInput from './NumberInput';
import HoverTooltip from './HoverTooltip';
import { IconEdit, IconCheck, IconClose, IconNote } from './Icons';
import IconButton from './IconButton';
import type { T } from '../translations';
import type { StockBatch, StockSource } from '../../shared/types';
import { effectiveExpiry, isExpired, daysUntilExpiry } from '../../shared/expiry';

interface Props {
  qty?: number;
  unit: string; // display label, e.g. "kg" or "szt."
  source?: StockSource;
  updatedAt?: string;
  sourceFile?: string;
  // Free-text warehouse note (from the "Magazyn" import). Marked in the cell
  // and shown in the tooltip.
  note?: string;
  // Stock split into expiry batches (raw materials). The cell shows the total
  // and the batch count; the tooltip lists each batch with its expiry.
  batches?: StockBatch[];
  // Persists a manual stock edit. Resolves once the catalog has been updated.
  // For a batched material a manual edit replaces the batches with a single
  // no-expiry value (handled by the caller).
  onCommit: (qty: number) => Promise<void>;
}

// Batches expiring within this many days are flagged as "soon".
const SOON_DAYS = 90;

// "1 partia" / "2 partie" / "5 partii" — Polish plural; English uses the
// first two forms.
function batchCountLabel(t: T, n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const form =
    n === 1
      ? t.stockBatchCount1
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? t.stockBatchCount2
        : t.stockBatchCount5;
  return form.replace('{n}', String(n));
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
          <IconButton
            className="btn-sm soft-success"
            icon={<IconCheck size={12} />}
            label={t.save}
            onClick={() => void commit()}
            disabled={saving}
          />
          <IconButton
            className="btn-sm"
            icon={<IconClose size={12} />}
            label={t.cancel}
            onClick={() => setEditing(false)}
            disabled={saving}
          />
        </div>
      </td>
    );
  }

  const hasBatches = !!batches && batches.length > 0;
  const anyExpired = hasBatches && batches!.some((b) => isExpired(b));
  const anySoon =
    hasBatches &&
    !anyExpired &&
    batches!.some((b) => {
      const d = daysUntilExpiry(b);
      return d !== undefined && d <= SOON_DAYS;
    });
  // What the list needs at a glance: how much is past its date (or close to
  // it), not just that something is — the batch count is the calm fallback.
  const expiredQty = hasBatches
    ? batches!.filter((b) => isExpired(b)).reduce((sum, b) => sum + b.qty, 0)
    : 0;
  const soonBatches = hasBatches
    ? batches!.filter((b) => {
        const d = daysUntilExpiry(b);
        return !isExpired(b) && d !== undefined && d <= SOON_DAYS;
      })
    : [];
  const soonQty = soonBatches.reduce((sum, b) => sum + b.qty, 0);
  const soonDays = soonBatches.length
    ? Math.min(...soonBatches.map((b) => daysUntilExpiry(b) ?? SOON_DAYS))
    : undefined;
  const hasNote = !!note && note.trim() !== '';
  const dateLabel = updatedAt ? new Date(updatedAt).toLocaleString() : undefined;
  const qtyLabel = (n: number) => `${n.toLocaleString()} ${unit}`;

  // The list shows just the total, the batch count (coloured when a batch is
  // expired or close to it) and a note mark; everything else — the batches
  // with their dates, the note, where the value came from — lives in one
  // tooltip laid out in columns.
  const summary = (
    <span className="stock-summary">
      <span className="stock-qty">{qty === undefined ? '—' : qtyLabel(qty)}</span>
      {hasBatches && (
        <span
          className={`stock-batches-count${
            anyExpired ? ' is-expired' : anySoon ? ' is-soon' : ''
          }`}
        >
          {anyExpired
            ? `${qtyLabel(expiredQty)} ${t.expired}`
            : anySoon && soonDays !== undefined
              ? `${qtyLabel(soonQty)} ${t.expiresInDays.replace('{n}', String(soonDays))}`
              : batchCountLabel(t, batches!.length)}
        </span>
      )}
      {hasNote && <IconNote size={12} className="stock-note-mark" />}
    </span>
  );

  const details = (
    <div className="stock-tip">
      {hasBatches && (
        <>
          <div className="shortage-tooltip-header">{t.stockBatches}</div>
          <div className="stock-tip-grid">
            <span className="stock-tip-head num">{t.quantity}</span>
            <span className="stock-tip-head">{t.expiry}</span>
            <span className="stock-tip-head" />
            {batches!.map((b) => {
              const eff = effectiveExpiry(b);
              const expired = isExpired(b);
              const days = daysUntilExpiry(b);
              const tone = expired ? ' is-expired' : '';
              return (
                <React.Fragment key={b.id}>
                  <span className={`stock-tip-qty num${tone}`}>{qtyLabel(b.qty)}</span>
                  <span className="stock-tip-date">
                    {eff ? fmtDate(eff) : t.noExpiry}
                    {b.retestExpiryDate && (
                      <span className="stock-tip-sub">
                        {t.expiryOriginal}: {fmtDate(b.expiryDate)}
                      </span>
                    )}
                  </span>
                  <span className="stock-tip-status">
                    {expired ? (
                      <span className="tag danger">{t.expired}</span>
                    ) : days !== undefined && days <= SOON_DAYS ? (
                      <span className="tag warn">
                        {t.expiresInDays.replace('{n}', String(days))}
                      </span>
                    ) : null}
                  </span>
                  {b.note && <span className="stock-tip-note">{b.note}</span>}
                </React.Fragment>
              );
            })}
            <span className="stock-tip-total">
              {t.stockTotal}: <strong>{qtyLabel(qty ?? 0)}</strong>
            </span>
          </div>
        </>
      )}
      {hasNote && (
        <>
          <div className="shortage-tooltip-header">{t.stockNote}</div>
          <div className="stock-note-text">{note}</div>
        </>
      )}
      {source && (
        <div className="stock-tip-meta">
          {t.stockSourceLabel}:{' '}
          {source === 'manual' ? t.stockSourceManual : t.stockSourceImport}
          {dateLabel && ` · ${dateLabel}`}
          {sourceFile && ` · ${sourceFile}`}
        </div>
      )}
    </div>
  );

  return (
    <td className="num">
      <div className="stock-cell">
        {hasBatches || hasNote || source ? (
          <HoverTooltip align="right" className="stock-tip-tooltip" trigger={summary}>
            {details}
          </HoverTooltip>
        ) : (
          summary
        )}
        {/* Import is the norm; only a manual override is flagged in the list. */}
        {source === 'manual' && (
          <span className="tag warn stock-badge">{t.stockSourceManual}</span>
        )}
        <IconButton
          className="btn-sm soft-edit stock-edit-btn"
          icon={<IconEdit size={12} />}
          label={t.stockEditManual}
          onClick={startEdit}
        />
      </div>
    </td>
  );
};

export default StockCell;
