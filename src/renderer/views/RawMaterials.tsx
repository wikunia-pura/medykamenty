import React, { useEffect, useState } from 'react';
import { useT } from '../i18n';
import type { RawMaterial, Supplier, Unit } from '../../shared/types';
import ConfirmDialog from '../components/ConfirmDialog';
import SupplierMultiPicker from '../components/SupplierMultiPicker';

const UNITS: Unit[] = ['kg', 'g', 'l', 'ml'];

const RawMaterials: React.FC = () => {
  const t = useT();
  const [items, setItems] = useState<RawMaterial[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [editing, setEditing] = useState<Partial<RawMaterial> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RawMaterial | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    const [rms, ss] = await Promise.all([
      window.electronAPI.listRawMaterials(),
      window.electronAPI.listSuppliers(),
    ]);
    setItems(rms);
    setSuppliers(ss);
  };

  useEffect(() => {
    void reload();
  }, []);

  const supplierName = (id?: string) => suppliers.find((s) => s.id === id)?.name ?? '—';

  const onAdd = () =>
    setEditing({
      name: '',
      unit: 'kg',
      supplierIds: [],
      factorySupplied: false,
    });

  const onSave = async () => {
    if (!editing || !editing.name?.trim()) return;
    setError(null);
    const payload = {
      name: editing.name.trim(),
      mpFirmaSymbol: editing.mpFirmaSymbol?.trim() || undefined,
      unit: (editing.unit ?? 'kg') as Unit,
      supplierIds: editing.supplierIds ?? [],
      preferredSupplierId: editing.preferredSupplierId,
      factorySupplied: !!editing.factorySupplied,
      moq: editing.moq,
      leadTimeDays: editing.leadTimeDays,
      shelfLifeMonths: editing.shelfLifeMonths,
      lastPurchasePriceNet: editing.lastPurchasePriceNet,
      currency: editing.currency?.trim() || undefined,
      notes: editing.notes?.trim() || undefined,
    };
    try {
      if (editing.id) {
        await window.electronAPI.updateRawMaterial(editing.id, payload);
      } else {
        await window.electronAPI.createRawMaterial(payload);
      }
      setEditing(null);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onDelete = async (rm: RawMaterial) => {
    setConfirmDelete(null);
    const result = await window.electronAPI.deleteRawMaterial(rm.id);
    if (!result.ok) {
      setError(`${t.error}: ${result.blockedBy?.join(', ') ?? ''}`);
    } else {
      await reload();
    }
  };

  return (
    <div className="main">
      <h1>{t.rawMaterials}</h1>

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
              <th>{t.unit}</th>
              <th>{t.preferredSupplier}</th>
              <th className="num">{t.moq}</th>
              <th className="num">{t.leadTime}</th>
              <th>{t.factorySupplied}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={8} className="hint">
                  {t.noData}
                </td>
              </tr>
            )}
            {items.map((rm) => (
              <tr key={rm.id}>
                <td>{rm.name}</td>
                <td>{rm.mpFirmaSymbol ?? ''}</td>
                <td>{rm.unit}</td>
                <td>{supplierName(rm.preferredSupplierId)}</td>
                <td className="num">{rm.moq ?? ''}</td>
                <td className="num">{rm.leadTimeDays ?? ''}</td>
                <td>{rm.factorySupplied ? <span className="tag warn">factory</span> : ''}</td>
                <td>
                  <button className="btn btn-sm" onClick={() => setEditing(rm)}>
                    {t.edit}
                  </button>{' '}
                  <button className="btn btn-sm" onClick={() => setConfirmDelete(rm)}>
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
              {editing.id ? t.edit : t.add} — {t.rawMaterials.toLowerCase()}
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
              <label>{t.symbol}</label>
              <input
                className="input"
                value={editing.mpFirmaSymbol ?? ''}
                onChange={(e) => setEditing({ ...editing, mpFirmaSymbol: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>{t.unit}</label>
              <select
                value={editing.unit ?? 'kg'}
                onChange={(e) => setEditing({ ...editing, unit: e.target.value as Unit })}
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>{t.factorySupplied}</label>
              <input
                type="checkbox"
                checked={!!editing.factorySupplied}
                onChange={(e) => setEditing({ ...editing, factorySupplied: e.target.checked })}
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
              <label>{t.shelfLife}</label>
              <input
                className="input"
                type="number"
                value={editing.shelfLifeMonths ?? ''}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    shelfLifeMonths: e.target.value === '' ? undefined : Number(e.target.value),
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
                value={editing.currency ?? ''}
                placeholder="PLN"
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

export default RawMaterials;
