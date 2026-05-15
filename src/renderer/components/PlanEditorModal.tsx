import React, { useState } from 'react';
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

type Tab = 'items' | 'bulk';

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

  const items = editing.items ?? [];
  const bulkMass = editing.bulkMass ?? [];

  const [activeTab, setActiveTab] = useState<Tab>(
    items.length === 0 && bulkMass.length > 0 ? 'bulk' : 'items',
  );

  const updateItem = (idx: number, patch: Partial<ProductionPlanItem>) => {
    const next = items.slice();
    next[idx] = { ...next[idx], ...patch };
    setEditing({ ...editing, items: next });
  };
  const removeItem = (idx: number) => {
    setEditing({ ...editing, items: items.filter((_, i) => i !== idx) });
  };
  const defaultQtyFor = (product: Product | undefined): number => {
    const moq = product?.moqUnits;
    if (moq && moq > 0) return moq;
    return 1000;
  };
  const addItem = () => {
    if (products.length === 0) return;
    const first = products[0];
    setEditing({
      ...editing,
      items: [...items, { productId: first.id, qtyUnits: defaultQtyFor(first) }],
    });
  };

  const updateBulk = (idx: number, patch: Partial<BulkMassItem>) => {
    const next = bulkMass.slice();
    next[idx] = { ...next[idx], ...patch };
    setEditing({ ...editing, bulkMass: next });
  };
  const removeBulk = (idx: number) => {
    setEditing({ ...editing, bulkMass: bulkMass.filter((_, i) => i !== idx) });
  };
  const addBulk = () => {
    if (products.length === 0) return;
    setEditing({
      ...editing,
      bulkMass: [...bulkMass, { productId: products[0].id, massKg: 10 }],
    });
  };

  const productOptions = products.map((p) => ({
    value: p.id,
    label: p.name,
    hint: `${p.capacityMl} ml`,
  }));
  const productById = new Map(products.map((p) => [p.id, p]));

  const totalUnits = items.reduce((acc, it) => acc + (it.qtyUnits || 0), 0);
  const totalKg = bulkMass.reduce((acc, b) => acc + (b.massKg || 0), 0);

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
              ? undefined
              : 'Zaplanuj produkcję: dodaj produkty pakowane oraz, opcjonalnie, masę luzem.'
          }
          onClose={onCancel}
        />

        {editing.id && (editing.createdAt || editing.updatedAt) && (
          <div className="modal-meta-strip">
            {editing.createdAt && (
              <span>
                <span className="hint">{t.planCreatedAt}:</span>{' '}
                {new Date(editing.createdAt).toLocaleString()}
              </span>
            )}
            {editing.updatedAt && (
              <span>
                <span className="hint">{t.planUpdatedAt}:</span>{' '}
                {new Date(editing.updatedAt).toLocaleString()}
              </span>
            )}
          </div>
        )}

        <div className="modal-body">
          <div className="modal-section">
            <div className="form-row">
              <label>{t.planName}</label>
              <input
                className="input"
                placeholder={t.planName}
                value={editing.name ?? ''}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                disabled={readOnly}
              />
            </div>
          </div>

          <div className="modal-section">
            <div className="modal-tabs">
              <button
                type="button"
                className={`modal-tab ${activeTab === 'items' ? 'active' : ''}`}
                onClick={() => setActiveTab('items')}
              >
                <span>{t.planItems}</span>
                <span className="modal-tab-count">{items.length}</span>
              </button>
              <button
                type="button"
                className={`modal-tab ${activeTab === 'bulk' ? 'active' : ''}`}
                onClick={() => setActiveTab('bulk')}
              >
                <span>{t.bulkMass}</span>
                <span className="modal-tab-count">{bulkMass.length}</span>
              </button>
              <div className="modal-tabs-spacer" />
              <div className="modal-tabs-actions">
                {activeTab === 'items' ? (
                  <>
                    {items.length > 0 && (
                      <span className="tag">
                        Σ {totalUnits.toLocaleString()} szt.
                      </span>
                    )}
                    {!readOnly && (
                      <button
                        className="btn btn-sm soft-edit"
                        onClick={addItem}
                        disabled={products.length === 0}
                      >
                        <IconPlus size={13} /> {t.add}
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    {bulkMass.length > 0 && (
                      <span className="tag">Σ {totalKg.toFixed(2)} kg</span>
                    )}
                    {!readOnly && (
                      <button
                        className="btn btn-sm soft-edit"
                        onClick={addBulk}
                        disabled={products.length === 0}
                      >
                        <IconPlus size={13} /> {t.add}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {activeTab === 'items' ? (
              items.length === 0 ? (
                <div className="plan-empty-state">
                  <div className="plan-empty-state-icon" aria-hidden>
                    📦
                  </div>
                  <div className="plan-empty-state-text">
                    {readOnly
                      ? t.noData
                      : 'Brak produktów. Dodaj pierwszy, aby zaplanować pakowanie.'}
                  </div>
                </div>
              ) : (
                <>
                  <div className="plan-rows-header">
                    <span>{t.products}</span>
                    <span>{t.quantity}</span>
                    {!readOnly && <span aria-hidden />}
                  </div>
                  <div className="plan-rows">
                    {items.map((item, idx) => {
                      const product = productById.get(item.productId);
                      const moq = product?.moqUnits;
                      const belowMoq =
                        !!moq && moq > 0 && (item.qtyUnits ?? 0) < moq;
                      return (
                        <div
                          key={idx}
                          style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                        >
                          <div className="plan-row">
                            <div className="plan-row-product">
                              <SearchableSelect
                                options={productOptions}
                                value={item.productId}
                                onChange={(val) => updateItem(idx, { productId: val })}
                                placeholder={t.search}
                                disabled={readOnly}
                              />
                            </div>
                            <div className="plan-row-qty">
                              <NumberInput
                                className="input"
                                style={{ width: 120 }}
                                value={item.qtyUnits}
                                emptyValue={0}
                                onChange={(v) => updateItem(idx, { qtyUnits: v ?? 0 })}
                                disabled={readOnly}
                              />
                              <span className="plan-row-unit">szt.</span>
                            </div>
                            {!readOnly && (
                              <button
                                className="btn btn-sm soft-danger btn-icon-only"
                                onClick={() => removeItem(idx)}
                                title={t.delete}
                              >
                                <IconClose size={12} />
                              </button>
                            )}
                          </div>
                          {belowMoq && (
                            <div
                              className="warn-text"
                              style={{ fontSize: 12, paddingLeft: 10 }}
                            >
                              {t.planItemBelowMoqWarning.replace(
                                '{moq}',
                                moq!.toLocaleString(),
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )
            ) : bulkMass.length === 0 ? (
              <div className="plan-empty-state">
                <div className="plan-empty-state-icon" aria-hidden>
                  ⚖️
                </div>
                <div className="plan-empty-state-text">
                  {readOnly
                    ? t.noData
                    : 'Brak masy luzem. Dodaj jeśli planujesz hurt lub saszetki.'}
                </div>
              </div>
            ) : (
              <>
                <div className="plan-rows-header">
                  <span>{t.products}</span>
                  <span>{t.bulkMass}</span>
                  {!readOnly && <span aria-hidden />}
                </div>
                <div className="plan-rows">
                  {bulkMass.map((bm, idx) => (
                    <div className="plan-row" key={idx}>
                      <div className="plan-row-product">
                        <SearchableSelect
                          options={productOptions}
                          value={bm.productId}
                          onChange={(val) => updateBulk(idx, { productId: val })}
                          placeholder={t.search}
                          disabled={readOnly}
                        />
                      </div>
                      <div className="plan-row-qty">
                        <NumberInput
                          className="input"
                          step="0.1"
                          style={{ width: 120 }}
                          value={bm.massKg}
                          emptyValue={0}
                          onChange={(v) => updateBulk(idx, { massKg: v ?? 0 })}
                          disabled={readOnly}
                        />
                        <span className="plan-row-unit">kg</span>
                      </div>
                      {!readOnly && (
                        <button
                          className="btn btn-sm soft-danger btn-icon-only"
                          onClick={() => removeBulk(idx)}
                          title={t.delete}
                        >
                          <IconClose size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="modal-footer">
          {readOnly ? (
            <>
              {onEnterEdit && (
                <button className="btn" onClick={onEnterEdit}>
                  <IconEdit size={13} /> {t.edit}
                </button>
              )}
              <button className="btn primary-filled" onClick={onCancel}>
                {t.close}
              </button>
            </>
          ) : (
            <>
              <button className="btn" onClick={onCancel}>
                {t.cancel}
              </button>
              <button
                className="btn primary-filled"
                onClick={() => void onSave()}
                disabled={!editing.name?.trim()}
              >
                {t.save}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default PlanEditorModal;
