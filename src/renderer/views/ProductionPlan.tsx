import React, { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import type {
  ProductionPlan,
  Product,
  ProductionPlanItem,
  BulkMassItem,
} from '../../shared/types';
import ConfirmDialog from '../components/ConfirmDialog';
import SearchInput, { matchesQuery } from '../components/SearchInput';
import { IconEdit, IconTrash, IconPlus, IconClose, IconDuplicate } from '../components/Icons';
import ExportImportButtons from '../components/ExportImportButtons';
import {
  exportPlansJson,
  importPlansJson,
  saveFile,
  openFile,
  formatStats,
} from '../utils/exportImport';

interface Props {
  editPlanId?: string;
  onEditPlanIdConsumed?: () => void;
}

const ProductionPlanView: React.FC<Props> = ({ editPlanId, onEditPlanIdConsumed }) => {
  const t = useT();
  const [plans, setPlans] = useState<ProductionPlan[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [editing, setEditing] = useState<Partial<ProductionPlan> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ProductionPlan | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const filteredPlans = useMemo(() => {
    if (!query.trim()) return plans;
    return plans.filter((p) => {
      const productNames = (p.items ?? [])
        .map((i) => products.find((pp) => pp.id === i.productId)?.name ?? '')
        .join(' ');
      return matchesQuery({ ...p, productNames }, query);
    });
  }, [plans, products, query]);

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

  // Open the edit modal for a specific plan when navigated here from elsewhere
  // (e.g. from a shortage report history entry).
  useEffect(() => {
    if (!editPlanId) return;
    const target = plans.find((p) => p.id === editPlanId);
    if (target) {
      setEditing(target);
      onEditPlanIdConsumed?.();
    }
  }, [editPlanId, plans]);

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

  const onExport = async () => {
    setError(null);
    setInfo(null);
    if (plans.length === 0) {
      setInfo(t.exportEmpty);
      return;
    }
    setBusy(true);
    try {
      const { content, filename } = exportPlansJson(plans, products);
      await saveFile(filename, content, 'json');
    } finally {
      setBusy(false);
    }
  };

  const onImport = async () => {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const r = await openFile('json');
      if (!r.ok || !r.content) return;
      try {
        const stats = await importPlansJson(r.content, [...plans], products);
        setInfo(formatStats(stats));
        await reload();
      } catch (err) {
        setError(`${t.importInvalidFile}: ${(err as Error).message}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const onDuplicate = async (p: ProductionPlan) => {
    const copy = await window.electronAPI.duplicatePlan(p.id);
    setEditing(copy);
    await reload();
  };

  const statusInfo = (
    status: ProductionPlan['status'],
  ): { label: string; tooltip: string; cls: string } => {
    switch (status) {
      case 'computed':
        return { label: t.planStatusComputed, tooltip: t.planStatusComputedTooltip, cls: 'success' };
      case 'archived':
        return { label: t.planStatusArchived, tooltip: t.planStatusArchivedTooltip, cls: '' };
      case 'draft':
      default:
        return { label: t.planStatusDraft, tooltip: t.planStatusDraftTooltip, cls: 'warn' };
    }
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
      <div className="page-header">
        <h1>{t.productionPlan}</h1>
        <span className="page-header-count">({plans.length})</span>
      </div>

      <div className="card">
        <div className="toolbar">
          <div className="toolbar-actions">
            <button className="btn primary" onClick={onAdd}>
              <IconPlus size={14} /> {t.add}
            </button>
            <ExportImportButtons
              format="json"
              onExport={onExport}
              onImport={onImport}
              busy={busy}
            />
          </div>
          <div className="toolbar-search">
            <SearchInput value={query} onChange={setQuery} block />
          </div>
        </div>
        {error && <div className="error-text" style={{ marginBottom: 8 }}>{error}</div>}
        {info && <div className="hint" style={{ marginBottom: 8 }}>{info}</div>}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="col-w-xl">{t.planName}</th>
                <th className="col-w-md">Status</th>
                <th className="num col-w-sm">{t.planItems}</th>
                <th className="actions">{t.actionsHeader}</th>
              </tr>
            </thead>
            <tbody>
              {filteredPlans.length === 0 && (
                <tr>
                  <td colSpan={4} className="hint">
                    {query ? '—' : t.noData}
                  </td>
                </tr>
              )}
              {filteredPlans.map((p) => {
                const info = statusInfo(p.status);
                return (
                  <tr key={p.id}>
                    <td className="col-name col-wrap">{p.name}</td>
                    <td>
                      <span className={`tag ${info.cls}`} title={info.tooltip}>
                        {info.label}
                      </span>
                    </td>
                    <td className="num">{p.items.length}</td>
                    <td className="actions">
                      <div className="btn-row">
                        <button
                          className="btn btn-sm soft-edit"
                          onClick={() => setEditing(p)}
                          title={t.edit}
                        >
                          <IconEdit size={13} /> {t.edit}
                        </button>
                        <button
                          className="btn btn-sm soft-success"
                          onClick={() => onDuplicate(p)}
                          title={t.duplicatePlan}
                        >
                          <IconDuplicate size={13} /> {t.duplicate}
                        </button>
                        <button
                          className="btn btn-sm soft-danger"
                          onClick={() => setConfirmDelete(p)}
                          title={t.delete}
                        >
                          <IconTrash size={13} /> {t.delete}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div
            className="modal modal-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-header-text">
                <h2 className="modal-title">
                  {editing.id ? `${t.edit}: ${editing.name ?? ''}` : t.addPlanCta}
                </h2>
                <p className="modal-subtitle">
                  {editing.id
                    ? t.productionPlan
                    : 'Zaplanuj produkcję: dodaj produkty pakowane oraz, opcjonalnie, masę luzem.'}
                </p>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setEditing(null)}
                title={t.close}
                aria-label={t.close}
              >
                <IconClose size={16} />
              </button>
            </div>

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
                />
              </div>

              <div className="modal-section">
                <div className="modal-section-header">
                  <div>
                    <h3 className="modal-section-title">{t.planItems}</h3>
                    <div className="hint" style={{ marginTop: 2 }}>
                      Produkty gotowe do pakowania w sztukach.
                    </div>
                  </div>
                  <button
                    className="btn btn-sm soft-edit"
                    onClick={addItem}
                    disabled={products.length === 0}
                  >
                    <IconPlus size={13} /> {t.add}
                  </button>
                </div>
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t.products}</th>
                      <th className="num">{t.quantity}</th>
                      <th className="actions">{t.actionsHeader}</th>
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
                            style={{ width: 120 }}
                            value={item.qtyUnits}
                            onChange={(e) =>
                              updateItem(idx, { qtyUnits: Number(e.target.value) || 0 })
                            }
                          />
                        </td>
                        <td className="actions">
                          <button
                            className="btn btn-sm soft-danger btn-icon-only"
                            onClick={() => removeItem(idx)}
                            title={t.delete}
                          >
                            <IconClose size={12} />
                          </button>
                        </td>
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
                  <button
                    className="btn btn-sm soft-edit"
                    onClick={addBulk}
                    disabled={products.length === 0}
                  >
                    <IconPlus size={13} /> {t.add}
                  </button>
                </div>
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t.products}</th>
                      <th className="num">{t.bulkMass}</th>
                      <th className="actions">{t.actionsHeader}</th>
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
                            style={{ width: 100 }}
                            value={bm.massKg}
                            onChange={(e) =>
                              updateBulk(idx, { massKg: Number(e.target.value) || 0 })
                            }
                          />{' '}
                          kg
                        </td>
                        <td className="actions">
                          <button
                            className="btn btn-sm soft-danger btn-icon-only"
                            onClick={() => removeBulk(idx)}
                            title={t.delete}
                          >
                            <IconClose size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn" onClick={() => setEditing(null)}>
                {t.cancel}
              </button>
              <button className="btn primary-filled" onClick={onSave}>
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
