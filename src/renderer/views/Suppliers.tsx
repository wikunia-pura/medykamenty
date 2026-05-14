import React, { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { HeaderNav } from '../navigation';
import type { Supplier, Lang } from '../../shared/types';
import ConfirmDialog from '../components/ConfirmDialog';
import BlockedByDialog from '../components/BlockedByDialog';
import LoadingOverlay from '../components/LoadingOverlay';
import SearchInput, { matchesQuery } from '../components/SearchInput';
import { IconEdit, IconTrash, IconPlus } from '../components/Icons';
import ModalHeader from '../components/ModalHeader';
import ExportImportButtons from '../components/ExportImportButtons';
import SearchableSelect from '../components/SearchableSelect';
import ColumnPicker from '../components/ColumnPicker';
import { useColumnPrefs, type ColumnDef } from '../utils/useColumnPrefs';
import { useEscapeKey } from '../utils/useEscapeKey';
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
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [loaderMessage, setLoaderMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [blockedBy, setBlockedBy] = useState<string[] | null>(null);

  useEscapeKey(() => setEditing(null), !!editing);

  const COLUMNS: ColumnDef[] = useMemo(
    () => [
      { id: 'name', label: t.name, required: true },
      { id: 'email', label: t.email, defaultVisible: true },
      { id: 'phone', label: t.phone, defaultVisible: true },
      { id: 'contactPerson', label: t.contactPerson, defaultVisible: true },
      { id: 'paymentTerms', label: t.paymentTerms, defaultVisible: false },
      { id: 'language', label: t.preferredEmailLanguage, defaultVisible: true },
      { id: 'notes', label: t.notes, defaultVisible: false },
    ],
    [t],
  );
  const {
    isVisible,
    toggle,
    reorder,
    reset: resetColumns,
    orderedColumns,
    orderedVisibleIds,
  } = useColumnPrefs('suppliers', COLUMNS);

  const headerFor = (id: string): React.ReactNode => {
    switch (id) {
      case 'name':
        return <th key={id} className="col-w-lg">{t.name}</th>;
      case 'email':
        return <th key={id} className="col-w-lg">{t.email}</th>;
      case 'phone':
        return <th key={id} className="col-w-md">{t.phone}</th>;
      case 'contactPerson':
        return <th key={id} className="col-w-md">{t.contactPerson}</th>;
      case 'paymentTerms':
        return <th key={id} className="col-w-md">{t.paymentTerms}</th>;
      case 'language':
        return <th key={id} className="col-w-sm">{t.preferredEmailLanguage}</th>;
      case 'notes':
        return <th key={id} className="col-w-lg">{t.notes}</th>;
      default:
        return null;
    }
  };

  const cellFor = (id: string, s: Supplier): React.ReactNode => {
    switch (id) {
      case 'name':
        return <td key={id} className="col-name">{s.name}</td>;
      case 'email':
        return <td key={id}>{s.email}</td>;
      case 'phone':
        return <td key={id}>{s.phone ?? ''}</td>;
      case 'contactPerson':
        return <td key={id}>{s.contactPerson ?? ''}</td>;
      case 'paymentTerms':
        return <td key={id}>{s.paymentTerms ?? ''}</td>;
      case 'language':
        return <td key={id}>{s.preferredEmailLanguage ?? ''}</td>;
      case 'notes':
        return <td key={id} className="col-wrap">{s.notes ?? ''}</td>;
      default:
        return null;
    }
  };

  const reload = async () => {
    setItems(await window.electronAPI.listSuppliers());
  };

  useEffect(() => {
    void (async () => {
      setLoaderMessage(t.loading);
      try {
        await reload();
      } finally {
        setLoaderMessage(null);
      }
    })();
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
      contactPerson: editing.contactPerson?.trim() || undefined,
      paymentTerms: editing.paymentTerms?.trim() || undefined,
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
    setLoaderMessage(t.loaderExporting);
    try {
      const { content, filename } = exportSuppliersCsv(items);
      await saveFile(filename, content, 'csv');
    } finally {
      setBusy(false);
      setLoaderMessage(null);
    }
  };

  const onImport = async () => {
    setError(null);
    setInfo(null);
    setBusy(true);
    setLoaderMessage(t.loaderImporting);
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
      setLoaderMessage(null);
    }
  };

  const onDelete = async (s: Supplier) => {
    setConfirmDelete(null);
    const result = await window.electronAPI.deleteSupplier(s.id);
    if (!result.ok) {
      setBlockedBy(result.blockedBy ?? []);
    } else {
      await reload();
    }
  };

  const onDeleteAll = async () => {
    setConfirmDeleteAll(false);
    setError(null);
    setInfo(null);
    setBusy(true);
    setLoaderMessage(t.deleteAllInProgress);
    const total = items.length;
    let deleted = 0;
    let blocked = 0;
    const blockers: string[] = [];
    try {
      for (const s of items) {
        const result = await window.electronAPI.deleteSupplier(s.id);
        if (result.ok) deleted++;
        else {
          blocked++;
          if (result.blockedBy) blockers.push(...result.blockedBy);
        }
      }
      if (blocked === 0) {
        setInfo(t.deleteAllSuccess.replace('{n}', String(deleted)));
      } else {
        setInfo(
          t.deleteAllPartial
            .replace('{n}', String(deleted))
            .replace('{total}', String(total))
            .replace('{blocked}', String(blocked)),
        );
        setBlockedBy(Array.from(new Set(blockers)));
      }
      await reload();
    } finally {
      setBusy(false);
      setLoaderMessage(null);
    }
  };

  return (
    <div className="main">
      <div className="page-header">
        <HeaderNav />
        <h1>{t.suppliers}</h1>
        <span className="page-header-count">{items.length}</span>
      </div>

      <div className="card">
        <div className="toolbar">
          <div className="toolbar-actions">
            <ExportImportButtons
              format="csv"
              onExport={onExport}
              onImport={onImport}
              busy={busy}
            />
            <ColumnPicker
              columns={orderedColumns}
              isVisible={isVisible}
              toggle={toggle}
              reorder={reorder}
              reset={resetColumns}
            />
            <button
              className="btn danger"
              onClick={() => setConfirmDeleteAll(true)}
              disabled={busy || items.length === 0}
              title={t.deleteAll}
            >
              <IconTrash size={13} /> {t.deleteAll}
            </button>
            <button className="btn primary toolbar-action-primary" onClick={onAdd}>
              <IconPlus size={14} /> {t.add}
            </button>
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
                {orderedVisibleIds.map((id) => headerFor(id))}
                <th className="actions actions-sticky">{t.actionsHeader}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={orderedVisibleIds.length + 1} className="hint">
                    {query ? '—' : t.noData}
                  </td>
                </tr>
              )}
              {filtered.map((s) => (
                <tr key={s.id}>
                  {orderedVisibleIds.map((id) => cellFor(id, s))}
                  <td className="actions actions-sticky">
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
            <ModalHeader
              icon={editing.id ? <IconEdit size={18} /> : <IconPlus size={18} />}
              tone={editing.id ? 'edit' : 'add'}
              title={
                editing.id
                  ? `${t.edit}: ${editing.name ?? ''}`
                  : `${t.add} — ${t.suppliers.toLowerCase()}`
              }
              onClose={() => setEditing(null)}
            />
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
                <label>{t.contactPerson}</label>
                <input
                  className="input"
                  value={editing.contactPerson ?? ''}
                  onChange={(e) => setEditing({ ...editing, contactPerson: e.target.value })}
                />
              </div>
              <div className="form-row">
                <label>{t.paymentTerms}</label>
                <input
                  className="input"
                  value={editing.paymentTerms ?? ''}
                  onChange={(e) => setEditing({ ...editing, paymentTerms: e.target.value })}
                />
              </div>
              <div className="form-row">
                <label>{t.preferredEmailLanguage}</label>
                <SearchableSelect
                  options={[
                    { value: '', label: '—' },
                    { value: 'pl', label: 'PL' },
                    { value: 'en', label: 'EN' },
                  ]}
                  value={editing.preferredEmailLanguage ?? ''}
                  onChange={(val) =>
                    setEditing({
                      ...editing,
                      preferredEmailLanguage: (val || undefined) as Lang | undefined,
                    })
                  }
                />
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

      {confirmDeleteAll && (
        <ConfirmDialog
          message={t.deleteAllConfirm.replace('{n}', String(items.length))}
          onConfirm={onDeleteAll}
          onCancel={() => setConfirmDeleteAll(false)}
          danger
        />
      )}

      {blockedBy && (
        <BlockedByDialog blockedBy={blockedBy} onClose={() => setBlockedBy(null)} />
      )}

      {loaderMessage && <LoadingOverlay message={loaderMessage} />}
    </div>
  );
};

export default Suppliers;
