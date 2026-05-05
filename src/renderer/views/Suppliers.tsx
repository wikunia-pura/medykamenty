import React, { useEffect, useState } from 'react';
import { useT } from '../i18n';
import type { Supplier, Lang } from '../../shared/types';
import ConfirmDialog from '../components/ConfirmDialog';

const Suppliers: React.FC = () => {
  const t = useT();
  const [items, setItems] = useState<Supplier[]>([]);
  const [editing, setEditing] = useState<Partial<Supplier> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Supplier | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setItems(await window.electronAPI.listSuppliers());
  };

  useEffect(() => {
    void reload();
  }, []);

  const onAdd = () =>
    setEditing({
      name: '',
      email: '',
      phone: '',
      notes: '',
      preferredEmailLanguage: 'pl',
    });

  const onSave = async () => {
    if (!editing || !editing.name?.trim()) return;
    setError(null);
    const payload = {
      name: editing.name.trim(),
      email: editing.email?.trim() ?? '',
      phone: editing.phone?.trim() || undefined,
      notes: editing.notes?.trim() || undefined,
      preferredEmailLanguage: editing.preferredEmailLanguage as Lang | undefined,
    };
    try {
      if (editing.id) {
        await window.electronAPI.updateSupplier(editing.id, payload);
      } else {
        await window.electronAPI.createSupplier(payload);
      }
      setEditing(null);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onDelete = async (s: Supplier) => {
    setConfirmDelete(null);
    const result = await window.electronAPI.deleteSupplier(s.id);
    if (!result.ok) {
      setError(`${t.error}: ${result.blockedBy?.join(', ') ?? ''}`);
    } else {
      await reload();
    }
  };

  return (
    <div className="main">
      <h1>{t.suppliers}</h1>

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
              <th>{t.email}</th>
              <th>{t.phone}</th>
              <th>{t.preferredEmailLanguage}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="hint">
                  {t.noData}
                </td>
              </tr>
            )}
            {items.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.email}</td>
                <td>{s.phone ?? ''}</td>
                <td>{s.preferredEmailLanguage ?? ''}</td>
                <td>
                  <button className="btn btn-sm" onClick={() => setEditing(s)}>
                    {t.edit}
                  </button>{' '}
                  <button className="btn btn-sm" onClick={() => setConfirmDelete(s)}>
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
            style={{ minWidth: 480 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0 }}>
              {editing.id ? t.edit : t.add} — {t.suppliers.toLowerCase()}
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
              <label>{t.email}</label>
              <input
                className="input"
                value={editing.email ?? ''}
                onChange={(e) => setEditing({ ...editing, email: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>{t.phone}</label>
              <input
                className="input"
                value={editing.phone ?? ''}
                onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>{t.preferredEmailLanguage}</label>
              <select
                value={editing.preferredEmailLanguage ?? ''}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    preferredEmailLanguage: (e.target.value || undefined) as Lang | undefined,
                  })
                }
              >
                <option value="">—</option>
                <option value="pl">PL</option>
                <option value="en">EN</option>
              </select>
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

export default Suppliers;
