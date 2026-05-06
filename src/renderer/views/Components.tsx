import React, { useEffect, useState } from 'react';
import { useT } from '../i18n';
import type { PackagingComponent, Supplier, ComponentType } from '../../shared/types';
import ConfirmDialog from '../components/ConfirmDialog';
import SupplierMultiPicker from '../components/SupplierMultiPicker';

const TYPES: ComponentType[] = [
  'tube',
  'bottle',
  'jar',
  'label',
  'cap',
  'pump',
  'pipette',
  'box',
  'leaflet',
  'other',
];

const Components: React.FC = () => {
  const t = useT();
  const [items, setItems] = useState<PackagingComponent[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [editing, setEditing] = useState<Partial<PackagingComponent> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PackagingComponent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    const [list, ss] = await Promise.all([
      window.electronAPI.listComponents(),
      window.electronAPI.listSuppliers(),
    ]);
    setItems(list);
    setSuppliers(ss);
  };

  useEffect(() => {
    void reload();
  }, []);

  const supplierName = (id?: string) => suppliers.find((s) => s.id === id)?.name ?? '—';

  const onAdd = () =>
    setEditing({
      name: '',
      type: 'other',
      supplierIds: [],
    });

  const onSave = async () => {
    if (!editing || !editing.name?.trim()) return;
    setError(null);
    const payload = {
      name: editing.name.trim(),
      type: (editing.type ?? 'other') as ComponentType,
      mpFirmaSymbol: editing.mpFirmaSymbol?.trim() || undefined,
      supplierIds: editing.supplierIds ?? [],
      preferredSupplierId: editing.preferredSupplierId,
      moq: editing.moq,
      leadTimeDays: editing.leadTimeDays,
      lastPurchasePriceNet: editing.lastPurchasePriceNet,
      currency: editing.currency?.trim() || undefined,
      notes: editing.notes?.trim() || undefined,
    };
    try {
      if (editing.id) {
        await window.electronAPI.updateComponent(editing.id, payload);
      } else {
        await window.electronAPI.createComponent(payload);
      }
      setEditing(null);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onDelete = async (c: PackagingComponent) => {
    setConfirmDelete(null);
    const result = await window.electronAPI.deleteComponent(c.id);
    if (!result.ok) {
      setError(`${t.error}: ${result.blockedBy?.join(', ') ?? ''}`);
    } else {
      await reload();
    }
  };

  return (
    <div className="main">
      <h1>{t.components}</h1>

      <div className="card">
        <div className="card-header">
          <div className="card-title">{items.length}</div>
          <button className="btn primary" onClick={onAdd}>
            + {t.add}
          </button>
        </div>
        {error && <div className="error-text" style={{ marginBottom: 8 }}>{error}</div>}
        <table className="table">
          <thead>
            <tr>
              <th>{t.name}</th>
              <th>{t.symbol}</th>
              <th>Typ</th>
              <th>{t.preferredSupplier}</th>
              <th className="num">{t.moq}</th>
              <th className="num">{t.price}</th>
              <th className="actions">{t.actionsHeader}</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="hint">
                  {t.noData}
                </td>
              </tr>
            )}
            {items.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.mpFirmaSymbol ?? ''}</td>
                <td>{c.type}</td>
                <td>{supplierName(c.preferredSupplierId)}</td>
                <td className="num">{c.moq ?? ''}</td>
                <td className="num">{c.lastPurchasePriceNet ?? ''}</td>
                <td className="actions">
                  <button className="btn btn-sm" onClick={() => setEditing(c)}>
                    {t.edit}
                  </button>{' '}
                  <button className="btn btn-sm" onClick={() => setConfirmDelete(c)}>
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
            style={{ minWidth: 560, maxHeight: '85vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0 }}>
              {editing.id ? t.edit : t.add} — {t.components.toLowerCase()}
            </h2>
            <div className="form-row">
              <label>{t.name}</label>
              <input
                className="input"
                value={editing.name ?? ''}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>Typ</label>
              <select
                value={editing.type ?? 'other'}
                onChange={(e) => setEditing({ ...editing, type: e.target.value as ComponentType })}
              >
                {TYPES.map((tt) => (
                  <option key={tt} value={tt}>
                    {tt}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>{t.symbol}</label>
              <input
                className="input"
                value={editing.mpFirmaSymbol ?? ''}
                onChange={(e) => setEditing({ ...editing, mpFirmaSymbol: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>{t.suppliers}</label>
              <SupplierMultiPicker
                suppliers={suppliers}
                selectedIds={editing.supplierIds ?? []}
                preferredId={editing.preferredSupplierId}
                onChange={(ids, pref) =>
                  setEditing({ ...editing, supplierIds: ids, preferredSupplierId: pref })
                }
              />
            </div>
            <div className="form-row">
              <label>{t.moq}</label>
              <input
                className="input"
                type="number"
                value={editing.moq ?? ''}
                onChange={(e) =>
                  setEditing({ ...editing, moq: e.target.value === '' ? undefined : Number(e.target.value) })
                }
              />
            </div>
            <div className="form-row">
              <label>{t.leadTime}</label>
              <input
                className="input"
                type="number"
                value={editing.leadTimeDays ?? ''}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    leadTimeDays: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
              />
            </div>
            <div className="form-row">
              <label>{t.price}</label>
              <input
                className="input"
                type="number"
                step="0.01"
                value={editing.lastPurchasePriceNet ?? ''}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    lastPurchasePriceNet:
                      e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
              />
            </div>
            <div className="form-row">
              <label>{t.currency}</label>
              <input
                className="input"
                placeholder="PLN"
                value={editing.currency ?? ''}
                onChange={(e) => setEditing({ ...editing, currency: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>{t.notes}</label>
              <textarea
                value={editing.notes ?? ''}
                onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
              />
            </div>
            <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
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
    </div>
  );
};

export default Components;
