import React, { useState } from 'react';
import { useT } from '../i18n';
import ModalHeader from './ModalHeader';
import SegmentedControl from './SegmentedControl';
import { IconClose } from './Icons';
import { useEscapeKey } from '../utils/useEscapeKey';
import type { ExpiredBatchRef } from '../../shared/types';

interface Props {
  batches: ExpiredBatchRef[];
  onCancel: () => void;
  // Receives the ids of the expired batches the user chose to count as valid
  // for this calculation run. Empty array = exclude everything (safe default).
  onConfirm: (includeBatchIds: string[]) => void;
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

// Shown before a shortage report / max-producible computation when the involved
// materials have expired stock. The user decides — individually or in bulk —
// whether each expired batch still counts as available for this run. The
// decision is per-run and not persisted.
const ExpiredStockModal: React.FC<Props> = ({ batches, onCancel, onConfirm }) => {
  const t = useT();
  useEscapeKey(onCancel);
  // Default: everything excluded (unchecked).
  const [included, setIncluded] = useState<Record<string, boolean>>({});

  const setAll = (value: boolean) => {
    const next: Record<string, boolean> = {};
    for (const b of batches) next[b.batchId] = value;
    setIncluded(next);
  };
  const toggle = (id: string) => setIncluded((prev) => ({ ...prev, [id]: !prev[id] }));

  const confirm = () => onConfirm(batches.filter((b) => included[b.batchId]).map((b) => b.batchId));

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <ModalHeader
          icon={<IconClose size={18} />}
          tone="add"
          title={t.expiredStockTitle}
          onClose={onCancel}
        />
        <div className="modal-body">
          <div className="hint" style={{ marginBottom: 12 }}>
            {t.expiredStockIntro}
          </div>
          <div className="apply-all-row">
            <span className="apply-all-label">{t.applyToAllLabel}</span>
            <button type="button" className="btn btn-sm" onClick={() => setAll(false)}>
              {t.expiredStockSkipAll}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setAll(true)}>
              {t.expiredStockIncludeAll}
            </button>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.name}</th>
                  <th className="num">{t.stock}</th>
                  <th>{t.expiry}</th>
                  <th>{t.expiredStockDecision}</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => {
                  const on = !!included[b.batchId];
                  const retested = !!b.effectiveExpiry && b.effectiveExpiry !== b.originalExpiry;
                  return (
                    <tr key={b.batchId}>
                      <td className="col-wrap">
                        {b.rawMaterialName}
                        {b.note && <div className="hint">{b.note}</div>}
                      </td>
                      <td className="num">
                        {b.qty.toLocaleString()} {b.unit}
                      </td>
                      <td>
                        <span className="stock-batch-flag">{fmtDate(b.effectiveExpiry)}</span>
                        {retested && (
                          <div className="hint">
                            {t.expiryOriginal}: {fmtDate(b.originalExpiry)}
                          </div>
                        )}
                      </td>
                      <td>
                        <SegmentedControl
                          size="sm"
                          ariaLabel={b.rawMaterialName}
                          value={on ? 'include' : 'skip'}
                          onChange={(v) => {
                            if ((v === 'include') !== on) toggle(b.batchId);
                          }}
                          options={[
                            { value: 'skip', label: t.expiredStockSkip, tone: 'neutral' },
                            { value: 'include', label: t.expiredStockInclude, tone: 'success' },
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onCancel}>
            {t.cancel}
          </button>
          <button className="btn primary-filled" onClick={confirm}>
            {t.expiredStockContinue}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExpiredStockModal;
