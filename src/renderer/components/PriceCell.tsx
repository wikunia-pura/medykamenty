import React, { useState } from 'react';
import { useT, useLang } from '../i18n';
import NumberInput from './NumberInput';
import { PriceHistoryTooltip } from './PriceHistory';
import { IconEdit, IconCheck, IconClose } from './Icons';
import type { PriceHistoryEntry } from '../../shared/types';

interface Props {
  price?: number;
  currency?: string;
  history?: PriceHistoryEntry[];
  // Unit the price is quoted in, e.g. "kg" or "szt." — omitted in catalogs
  // where the unit already has its own column.
  priceUnit?: string;
  // Persists the edit to the catalog. Clearing the field stores `undefined`,
  // which removes the price (and records nothing in the history).
  onCommit: (price: number | undefined) => Promise<void>;
  // Renders the bare content instead of a <td>, for use outside tables.
  bare?: boolean;
  disabled?: boolean;
}

// Catalog net purchase price with an inline editor and a hover tooltip listing
// the last recorded price changes. Every commit goes through the normal
// catalog update, so the change lands in `priceHistory` (see database.ts) and
// propagates to every view that reads the price.
const PriceCell: React.FC<Props> = ({
  price,
  currency,
  history,
  priceUnit,
  onCommit,
  bare,
  disabled,
}) => {
  const t = useT();
  const lang = useLang();
  const locale = lang === 'pl' ? 'pl-PL' : 'en-US';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<number | undefined>(price);
  const [saving, setSaving] = useState(false);

  const wrap = (content: React.ReactNode) =>
    bare ? <>{content}</> : <td className="num">{content}</td>;

  const startEdit = () => {
    setDraft(price);
    setEditing(true);
  };

  const commit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onCommit(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return wrap(
      <div className="stock-edit">
        <NumberInput
          className="input stock-edit-input"
          value={draft}
          step="0.01"
          min={0}
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
      </div>,
    );
  }

  return wrap(
    <div className="stock-cell">
      <span className={price === undefined ? 'price-missing' : 'stock-qty'}>
        {price === undefined
          ? t.priceNotSet
          : `${price.toLocaleString(locale, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}${priceUnit ? ` ${currency ?? 'PLN'}/${priceUnit}` : ''}`}
      </span>
      <PriceHistoryTooltip history={history} fallbackCurrency={currency} />
      {!disabled && (
        <button
          type="button"
          className="btn btn-sm soft-edit stock-edit-btn"
          onClick={startEdit}
          title={t.priceEdit}
        >
          <IconEdit size={12} />
        </button>
      )}
    </div>,
  );
};

export default PriceCell;
