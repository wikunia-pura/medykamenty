import React, { useState } from 'react';
import { useT } from '../i18n';
import NumberInput from './NumberInput';
import { IconEdit, IconCheck, IconClose, IconRefresh } from './Icons';

interface Props {
  // Explicit per-item overage %, or undefined when the item inherits the default.
  pct?: number;
  // Type-level default %, shown when the item inherits and used as the editor placeholder.
  defaultPct: number;
  // Persists the edit. `undefined` clears the explicit value so the item inherits the default.
  onCommit: (pct: number | undefined) => Promise<void>;
}

// Renders an item's effective overage ("naddatek") with an inline editor.
// Leaving the field empty stores `undefined`, so the item falls back to the
// type-level default — mirrors the StockCell pattern.
const OverageCell: React.FC<Props> = ({ pct, defaultPct, onCommit }) => {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<number | undefined>(pct);
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setDraft(pct);
    setEditing(true);
  };

  const commit = async (value: number | undefined) => {
    if (saving) return;
    setSaving(true);
    try {
      await onCommit(value);
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
            step="0.1"
            placeholder={String(defaultPct)}
            onChange={setDraft}
            disabled={saving}
          />
          <button
            type="button"
            className="btn btn-sm soft-success"
            onClick={() => void commit(draft)}
            disabled={saving}
            title={t.save}
          >
            <IconCheck size={12} />
          </button>
          <button
            type="button"
            className="btn btn-sm soft-edit"
            onClick={() => void commit(undefined)}
            disabled={saving || pct === undefined}
            title={t.overageResetToDefault}
          >
            <IconRefresh size={12} />
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

  const inherited = pct === undefined;
  const effective = inherited ? defaultPct : pct;
  return (
    <td className="num">
      <div className="stock-cell">
        <span className="stock-qty">{effective}%</span>
        {inherited && (
          <span className="tag stock-badge" title={t.overageInheritedTooltip}>
            {t.overageInherited}
          </span>
        )}
        <button
          type="button"
          className="btn btn-sm soft-edit stock-edit-btn"
          onClick={startEdit}
          title={t.overageEdit}
        >
          <IconEdit size={12} />
        </button>
      </div>
    </td>
  );
};

export default OverageCell;
