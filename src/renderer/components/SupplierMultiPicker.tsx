import React from 'react';
import type { Supplier } from '../../shared/types';
import { useT } from '../i18n';

interface Props {
  suppliers: Supplier[];
  selectedIds: string[];
  preferredId?: string;
  onChange: (ids: string[], preferred?: string) => void;
}

const SupplierMultiPicker: React.FC<Props> = ({
  suppliers,
  selectedIds,
  preferredId,
  onChange,
}) => {
  const t = useT();

  const toggle = (id: string) => {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((s) => s !== id)
      : [...selectedIds, id];
    const nextPreferred =
      preferredId && next.includes(preferredId) ? preferredId : next[0];
    onChange(next, nextPreferred);
  };

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {suppliers.length === 0 && <span className="hint">{t.noData}</span>}
        {suppliers.map((s) => {
          const isSelected = selectedIds.includes(s.id);
          const isPreferred = preferredId === s.id;
          return (
            <button
              key={s.id}
              type="button"
              className={`btn btn-sm ${isSelected ? 'primary' : ''}`}
              style={isPreferred ? { boxShadow: '0 0 0 2px var(--primary)' } : undefined}
              onClick={() => toggle(s.id)}
              title={isPreferred ? `★ ${t.preferredSupplier}` : ''}
            >
              {isPreferred ? '★ ' : ''}
              {s.name}
            </button>
          );
        })}
      </div>
      {selectedIds.length > 1 && (
        <div style={{ marginTop: 8 }}>
          <label className="hint" style={{ marginRight: 8 }}>
            {t.preferredSupplier}:
          </label>
          <select
            value={preferredId ?? ''}
            onChange={(e) =>
              onChange(selectedIds, e.target.value || undefined)
            }
          >
            <option value="">—</option>
            {selectedIds
              .map((id) => suppliers.find((s) => s.id === id))
              .filter((s): s is Supplier => !!s)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </div>
      )}
    </div>
  );
};

export default SupplierMultiPicker;
