import React, { useEffect, useState } from 'react';
import { useT } from '../i18n';
import type {
  ProductionPlan,
  Product,
  ProductionPlanItem,
  BulkMassItem,
} from '../../shared/types';
import ConfirmDialog from '../components/ConfirmDialog';

const ProductionPlanView: React.FC = () => {
  const t = useT();
  const [plans, setPlans] = useState<ProductionPlan[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [editing, setEditing] = useState<Partial<ProductionPlan> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ProductionPlan | null>(null);

  const reload = async () => {
    const [ps, prods] = await Promise.all([
      window.electronAPI.listPlans(),
      window.electronAPI.listProducts(),
    ]);
    setPlans(ps);
    setProducts(prods);
  };

  useEffect(() => {
    void reload();
  }, []);

  const onAdd = () =>
    setEditing({
      name: `Plan ${new Date().toISOString().slice(0, 10)}`,
      items: [],
      bulkMass: [],
      status: 'draft',
    });

  const onSave = async () => {
    if (!editing || !editing.name?.trim()) return;
    const payload = {
      name: editing.name.trim(),
      items: editing.items ?? [],
      bulkMass: editing.bulkMass ?? [],
      status: editing.status ?? 'draft',
    };
    if (editing.id) {
      await window.electronAPI.updatePlan(editing.id, payload);
    } else {
      await window.electronAPI.createPlan(payload);
    }
    setEditing(null);
    await reload();
  };

  const onDelete = async (p: ProductionPlan) => {
    setConfirmDelete(null);
    await window.electronAPI.deletePlan(p.id);
    await reload();
  };

  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? '?';

  const updateItem = (idx: number, patch: Partial<ProductionPlanItem>) => {
    if (!editing) return;
    const next = (editing.items ?? []).slice();
    next[idx] = { ...next[idx], ...patch };
    setEditing({ ...editing, items: next });
  };
  const removeItem = (idx: number) => {
    if (!editing) return;
    setEditing({ ...editing, items: (editing.items ?? []).filter((_, i) => i !== idx) });
  };
  const addItem = () => {
    if (!editing) return;
    const firstProduct = products.find(
      (p) => !(editing.items ?? []).some((i) => i.productId === p.id),
    );
    if (!firstProduct) return;
    setEditing({
      ...editing,
      items: [...(editing.items ?? []), { productId: firstProduct.id, qtyUnits: 1000 }],
    });
  };

  const updateBulk = (idx: number, patch: Partial<BulkMassItem>) => {
    if (!editing) return;
    const next = (editing.bulkMass ?? []).slice();
    next[idx] = { ...next[idx], ...patch };
    setEditing({ ...editing, bulkMass: next });
  };
  const removeBulk = (idx: number) => {
    if (!editing) return;
    setEditing({ ...editing, bulkMass: (editing.bulkMass ?? []).filter((_, i) => i !== idx) });
  };
  const addBulk = () => {
    if (!editing || products.length === 0) return;
    setEditing({
      ...editing,
      bulkMass: [...(editing.bulkMass ?? []), { productId: products[0].id, massKg: 10 }],
    });
  };

  return (
    <div className="main">
      <h1>{t.productionPlan}</h1>

      <div className="card">
        <div className="card-header">
          <div className="card-title">{plans.length}</div>
          <button className="btn primary" onClick={onAdd}>
            + {t.add}
          </button>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>{t.planName}</th>
              <th>Status</th>
              <th className="num">{t.planItems}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {plans.length === 0 && (
              <tr>
                <td colSpan={4} className="hint">
                  {t.noData}
                </td>
              </tr>
            )}
            {plans.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>
                  <span className={`tag ${p.status === 'computed' ? 'success' : ''}`}>
                    {p.status}
                  </span>
                </td>
                <td className="num">{p.items.length}</td>
                <td>
                  <button className="btn btn-sm" onClick={() => setEditing(p)}>
                    {t.edit}
                  </button>{' '}
                  <button className="btn btn-sm" onClick={() => setConfirmDelete(p)}>
                    {t.delete}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
          onClick={() => setEditing(null)}
        >
          <div
            className="card"
            style={{ width: 720, maxWidth: '90vw', maxHeight: '90vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0 }}>
              {editing.id ? t.edit : t.add} — {t.productionPlan.toLowerCase()}
            </h2>
            <div className="form-row">
              <label>{t.planName}</label>
              <input
                className="input"
                value={editing.name ?? ''}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </div>

            <h2>{t.planItems}</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>{t.products}</th>
                  <th className="num">{t.quantity}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(editing.items ?? []).length === 0 && (
                  <tr>
                    <td colSpan={3} className="hint">
                      {t.noData}
                    </td>
                  </tr>
                )}
                {(editing.items ?? []).map((item, idx) => (
                  <tr key={idx}>
                    <td>
                      <select
                        value={item.productId}
                        onChange={(e) => updateItem(idx, { productId: e.target.value })}
                      >
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.capacityMl} ml)
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="num">
                      <input
                        className="input"
                        type="number"
                        style={{ width: 120, textAlign: 'right' }}
                        value={item.qtyUnits}
                        onChange={(e) =>
                          updateItem(idx, { qtyUnits: Number(e.target.value) || 0 })
                        }
                      />
                    </td>
                    <td>
                      <button className="btn btn-sm" onClick={() => removeItem(idx)}>
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              className="btn btn-sm"
              style={{ marginTop: 8 }}
              onClick={addItem}
              disabled={products.length === 0}
            >
              + {t.add}
            </button>

            <h2>{t.bulkMass}</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>{t.products}</th>
                  <th className="num">{t.bulkMass}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(editing.bulkMass ?? []).length === 0 && (
                  <tr>
                    <td colSpan={3} className="hint">
                      {t.noData}
                    </td>
                  </tr>
                )}
                {(editing.bulkMass ?? []).map((bm, idx) => (
                  <tr key={idx}>
                    <td>
                      <select
                        value={bm.productId}
                        onChange={(e) => updateBulk(idx, { productId: e.target.value })}
                      >
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="num">
                      <input
                        className="input"
                        type="number"
                        step="0.1"
                        style={{ width: 100, textAlign: 'right' }}
                        value={bm.massKg}
                        onChange={(e) => updateBulk(idx, { massKg: Number(e.target.value) || 0 })}
                      />{' '}
                      kg
                    </td>
                    <td>
                      <button className="btn btn-sm" onClick={() => removeBulk(idx)}>
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              className="btn btn-sm"
              style={{ marginTop: 8 }}
              onClick={addBulk}
              disabled={products.length === 0}
            >
              + {t.add}
            </button>

            <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn" onClick={() => setEditing(null)}>
                {t.cancel}
              </button>
              <button className="btn primary" onClick={onSave}>
                {t.save}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`${t.delete}: ${confirmDelete.name}?`}
          onConfirm={() => onDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
          danger
        />
      )}

      {plans.length === 0 && products.length === 0 && (
        <div className="card hint">
          Najpierw zdefiniuj produkty (z recepturami) zanim utworzysz plan produkcji.
        </div>
      )}
      <div className="hint" style={{ marginTop: 8 }}>
        {t.products}: {productName.length === 0 ? products.length : products.length}
      </div>
    </div>
  );
};

export default ProductionPlanView;
