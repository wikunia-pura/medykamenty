import React, { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import type { Supplier, Lang } from '../../shared/types';
import ConfirmDialog from '../components/ConfirmDialog';
import SearchInput, { matchesQuery } from '../components/SearchInput';
import { IconEdit, IconTrash, IconPlus, IconClose } from '../components/Icons';
import ExportImportButtons from '../components/ExportImportButtons';
import {
  exportSuppliersCsv,
  importSuppliersCsv,
  saveFile,
  openFile,
  formatStats,
} from '../utils/exportImport';

const Suppliers: React.FC = () => {
  const t = useT();
  const [items, setItems] = useState<Supplier[]>([]);
  const [editing, setEditing] = useState<Partial<Supplier> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Supplier | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');

  const reload = async () => {
    setItems(await window.electronAPI.listSuppliers());
  };

  useEffect(() => {
    void reload();
  }, []);

  const filtered = useMemo(
    () => items.filter((s) => matchesQuery(s, query)),
    [items, query],
  );

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

  const onExport = async () => {
    setError(null);
    setInfo(null);
    if (items.length === 0) {
      setInfo(t.exportEmpty);
      return;
    }
    setBusy(true);
    try {
      const { content, filename } = exportSuppliersCsv(items);
      await saveFile(filename, content, 'csv');
    } finally {
      setBusy(false);
    }
  };

  const onImport = async () => {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const r = await openFile('csv');
      if (!r.ok || !r.content) return;
      try {
        const stats = await importSuppliersCsv(r.content, [...items]);
        setInfo(formatStats(stats));
        await reload();
      } catch (err) {
        setError(`${t.importInvalidFile}: ${(err as Error).message}`);
      }
    } finally {
      setBusy(false);
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
      <div className="page-header">
        <h1>{t.suppliers}</h1>
        <span className="page-header-count">({items.length})</span>
      </div>

      <div className="card">
        <div className="toolbar">
          <div className="toolbar-actions">
            <button className="btn primary" onClick={onAdd}>
              <IconPlus size={14} /> {t.add}
            </button>
            <ExportImportButtons
              format="csv"
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
                <th className="col-w-lg">{t.name}</th>
                <th className="col-w-lg">{t.email}</th>
                <th className="col-w-md">{t.phone}</th>
                <th className="col-w-sm">{t.preferredEmailLanguage}</th>
                <th className="actions">{t.actionsHeader}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="hint">
                    {query ? '—' : t.noData}
                  </td>
                </tr>
              )}
              {filtered.map((s) => (
                <tr key={s.id}>
                  <td className="col-name">{s.name}</td>
                  <td>{s.email}</td>
                  <td>{s.phone ?? ''}</td>
                  <td>{s.preferredEmailLanguage ?? ''}</td>
                  <td className="actions">
                    <div className="btn-row">
                      <button
                        className="btn btn-sm soft-edit"
                        onClick={() => setEditing(s)}
                        title={t.edit}
                      >
                        <IconEdit size={13} /> {t.edit}
                      </button>
                      <button
                        className="btn btn-sm soft-danger"
                        onClick={() => setConfirmDelete(s)}
                        title={t.delete}
                      >
                        <IconTrash size={13} /> {t.delete}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-header-text">
                <h2 className="modal-title">
                  {editing.id ? `${t.edit}: ${editing.name ?? ''}` : `${t.add} — ${t.suppliers.toLowerCase()}`}
                </h2>
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
    </div>
  );
};

export default Suppliers;
