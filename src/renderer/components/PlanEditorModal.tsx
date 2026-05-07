import React from 'react';
import type {
  ProductionPlan,
  ProductionPlanItem,
  Product,
  BulkMassItem,
} from '../../shared/types';
import { useT } from '../i18n';
import ModalHeader from './ModalHeader';
import SearchableSelect from './SearchableSelect';
import NumberInput from './NumberInput';
import { IconPlus, IconClose, IconEdit, IconEye } from './Icons';
import { useEscapeKey } from '../utils/useEscapeKey';

interface Props {
  editing: Partial<ProductionPlan>;
  products: Product[];
  setEditing: (next: Partial<ProductionPlan>) => void;
  onCancel: () => void;
  onSave: () => void | Promise<void>;
  readOnly?: boolean;
  onEnterEdit?: () => void;
}

const PlanEditorModal: React.FC<Props> = ({
  editing,
  products,
  setEditing,
  onCancel,
  onSave,
  readOnly = false,
  onEnterEdit,
}) => {
  const t = useT();

  useEscapeKey(onCancel);

  const updateItem = (idx: number, patch: Partial<ProductionPlanItem>) => {
    const next = (editing.items ?? []).slice();
    next[idx] = { ...next[idx], ...patch };
    setEditing({ ...editing, items: next });
  };
  const removeItem = (idx: number) => {
    setEditing({ ...editing, items: (editing.items ?? []).filter((_, i) => i !== idx) });
  };
  const addItem = () => {
    if (products.length === 0) return;
    setEditing({
      ...editing,
      items: [...(editing.items ?? []), { productId: products[0].id, qtyUnits: 1000 }],
    });
  };

  const updateBulk = (idx: number, patch: Partial<BulkMassItem>) => {
    const next = (editing.bulkMass ?? []).slice();
    next[idx] = { ...next[idx], ...patch };
    setEditing({ ...editing, bulkMass: next });
  };
  const removeBulk = (idx: number) => {
    setEditing({ ...editing, bulkMass: (editing.bulkMass ?? []).filter((_, i) => i !== idx) });
  };
  const addBulk = () => {
    if (products.length === 0) return;
    setEditing({
      ...editing,
      bulkMass: [...(editing.bulkMass ?? []), { productId: products[0].id, massKg: 10 }],
    });
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className={`modal modal-lg${readOnly ? ' modal-readonly' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <ModalHeader
          icon={
            readOnly ? (
              <IconEye size={18} />
            ) : editing.id ? (
              <IconEdit size={18} />
            ) : (
              <IconPlus size={18} />
            )
          }
          tone={readOnly ? 'edit' : editing.id ? 'edit' : 'add'}
          title={
            readOnly
              ? `${t.preview}: ${editing.name ?? ''}`
              : editing.id
                ? `${t.edit}: ${editing.name ?? ''}`
                : t.addPlanCta
          }
          subtitle={
            editing.id
              ? t.productionPlan
              : 'Zaplanuj produkcję: dodaj produkty pakowane oraz, opcjonalnie, masę luzem.'
          }
          onClose={onCancel}
        />

        <div className="modal-body">
          <div className="modal-section">
            <div className="modal-section-header">
              <h3 className="modal-section-title">{t.planName}</h3>
            </div>
            <input
              className="input"
              placeholder={t.planName}
              value={editing.name ?? ''}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              disabled={readOnly}
            />
            {editing.id && (editing.createdAt || editing.updatedAt) && (
              <div className="hint" style={{ marginTop: 6, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {editing.createdAt && (
                  <span>
                    {t.planCreatedAt}: {new Date(editing.createdAt).toLocaleString()}
                  </span>
                )}
                {editing.updatedAt && (
                  <span>
                    {t.planUpdatedAt}: {new Date(editing.updatedAt).toLocaleString()}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="modal-section">
            <div className="modal-section-header">
              <div>
                <h3 className="modal-section-title">{t.planItems}</h3>
                <div className="hint" style={{ marginTop: 2 }}>
                  Produkty gotowe do pakowania w sztukach.
                </div>
              </div>
              {!readOnly && (
                <button
                  className="btn btn-sm soft-edit"
                  onClick={addItem}
                  disabled={products.length === 0}
                >
                  <IconPlus size={13} /> {t.add}
                </button>
              )}
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>{t.products}</th>
                  <th className="num">{t.quantity}</th>
                  {!readOnly && <th className="actions">{t.actionsHeader}</th>}
                </tr>
              </thead>
              <tbody>
                {(editing.items ?? []).length === 0 && (
                  <tr>
                    <td colSpan={readOnly ? 2 : 3} className="hint">
                      {t.noData}
                    </td>
                  </tr>
                )}
                {(editing.items ?? []).map((item, idx) => (
                  <tr key={idx}>
                    <td>
                      <SearchableSelect
                        options={products.map((p) => ({
                          value: p.id,
                          label: p.name,
                          hint: `(${p.capacityMl} ml)`,
                        }))}
                        value={item.productId}
                        onChange={(val) => updateItem(idx, { productId: val })}
                        placeholder={t.search}
                        disabled={readOnly}
                      />
                    </td>
                    <td className="num">
                      <NumberInput
                        className="input"
                        style={{ width: 120 }}
                        value={item.qtyUnits}
                        emptyValue={0}
                        onChange={(v) => updateItem(idx, { qtyUnits: v ?? 0 })}
                        disabled={readOnly}
                      />
                    </td>
                    {!readOnly && (
                      <td className="actions">
                        <button
                          className="btn btn-sm soft-danger btn-icon-only"
                          onClick={() => removeItem(idx)}
                          title={t.delete}
                        >
                          <IconClose size={12} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="modal-section">
            <div className="modal-section-header">
              <div>
                <h3 className="modal-section-title">{t.bulkMass}</h3>
                <div className="hint" style={{ marginTop: 2 }}>
                  Masa luzem (np. saszetki, hurt) — w kilogramach.
                </div>
              </div>
              {!readOnly && (
                <button
                  className="btn btn-sm soft-edit"
                  onClick={addBulk}
                  disabled={products.length === 0}
                >
                  <IconPlus size={13} /> {t.add}
                </button>
              )}
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>{t.products}</th>
                  <th className="num">{t.bulkMass}</th>
                  {!readOnly && <th className="actions">{t.actionsHeader}</th>}
                </tr>
              </thead>
              <tbody>
                {(editing.bulkMass ?? []).length === 0 && (
                  <tr>
                    <td colSpan={readOnly ? 2 : 3} className="hint">
                      {t.noData}
                    </td>
                  </tr>
                )}
                {(editing.bulkMass ?? []).map((bm, idx) => (
                  <tr key={idx}>
                    <td>
                      <SearchableSelect
                        options={products.map((p) => ({ value: p.id, label: p.name }))}
                        value={bm.productId}
                        onChange={(val) => updateBulk(idx, { productId: val })}
                        placeholder={t.search}
                        disabled={readOnly}
                      />
                    </td>
                    <td className="num">
                      <NumberInput
                        className="input"
                        step="0.1"
                        style={{ width: 100 }}
                        value={bm.massKg}
                        emptyValue={0}
                        onChange={(v) => updateBulk(idx, { massKg: v ?? 0 })}
                        disabled={readOnly}
                      />{' '}
                      kg
                    </td>
                    {!readOnly && (
                      <td className="actions">
                        <button
                          className="btn btn-sm soft-danger btn-icon-only"
                          onClick={() => removeBulk(idx)}
                          title={t.delete}
                        >
                          <IconClose size={12} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onCancel}>
            {readOnly ? t.close : t.cancel}
          </button>
          {readOnly ? (
            onEnterEdit && (
              <button className="btn primary-filled" onClick={onEnterEdit}>
                <IconEdit size={13} /> {t.edit}
              </button>
            )
          ) : (
            <button
              className="btn primary-filled"
              onClick={() => void onSave()}
              disabled={!editing.name?.trim()}
            >
              {t.save}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PlanEditorModal;
