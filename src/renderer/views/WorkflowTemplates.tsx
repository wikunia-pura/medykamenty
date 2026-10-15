import React, { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { HeaderNav } from '../navigation';
import type { WorkflowTemplate } from '../../shared/types';
import WorkflowTemplateEditorModal from '../components/WorkflowTemplateEditorModal';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingOverlay from '../components/LoadingOverlay';
import SearchInput, { matchesQuery } from '../components/SearchInput';
import { IconEdit, IconTrash, IconPlus, IconDuplicate } from '../components/Icons';
import IconButton from '../components/IconButton';
import HoverTooltip from '../components/HoverTooltip';
import type { TaskType } from '../../shared/types';
import SkeletonRows from '../components/SkeletonRows';
import { useMinimumLoading } from '../utils/useMinimumLoading';

const WorkflowTemplates: React.FC = () => {
  const t = useT();
  const [items, setItems] = useState<WorkflowTemplate[]>([]);
  const [editing, setEditing] = useState<Partial<WorkflowTemplate> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<WorkflowTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const reload = async () => {
    try {
      const list = await window.electronAPI.listWorkflowTemplates();
      setItems(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // First load shows skeleton rows (held briefly so a fast load still eases in).
  const [initialLoading, setInitialLoading] = useState(true);
  const showSkeleton = useMinimumLoading(initialLoading);
  useEffect(() => {
    void reload().finally(() => setInitialLoading(false));
  }, []);

  const onAdd = () => {
    setEditing({ name: '', tasks: [] });
  };

  const onEdit = (wt: WorkflowTemplate) => {
    setEditing({ ...wt });
  };

  const onSave = async () => {
    if (!editing) return;
    const name = (editing.name ?? '').trim();
    if (!name) {
      setError(t.workflowTemplateNameRequired);
      return;
    }
    const tasks = (editing.tasks ?? []).filter((t) => t.name.trim());
    setBusy(true);
    try {
      if (editing.id) {
        await window.electronAPI.updateWorkflowTemplate(editing.id, { name, tasks });
      } else {
        await window.electronAPI.createWorkflowTemplate({ name, tasks });
      }
      setEditing(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (wt: WorkflowTemplate) => {
    setConfirmDelete(null);
    setBusy(true);
    try {
      await window.electronAPI.deleteWorkflowTemplate(wt.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onDuplicate = async (wt: WorkflowTemplate) => {
    if (duplicatingId) return;
    setDuplicatingId(wt.id);
    setError(null);
    try {
      await window.electronAPI.duplicateWorkflowTemplate(wt.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDuplicatingId(null);
    }
  };

  const filtered = items.filter((wt) => matchesQuery(wt, query));

  const taskTypeLabel = (type: TaskType): string => {
    switch (type) {
      case 'custom':
        return t.taskTypeCustom;
      case 'import_stock':
        return t.taskTypeImportStock;
      case 'generate_shortage':
        return t.taskTypeGenerateShortage;
      case 'generate_emails':
        return t.taskTypeGenerateEmails;
    }
  };

  return (
    <div className="main">
      <div className="page-header">
        <HeaderNav />
        <h1>{t.workflowTemplates}</h1>
        <span className="page-header-count">{items.length}</span>
      </div>

      <div className="card card-fill">
        <div className="toolbar">
          <div className="toolbar-actions">
            <button className="btn primary toolbar-action-primary" onClick={onAdd}>
              <IconPlus size={14} /> {t.add}
            </button>
          </div>
          <div className="toolbar-search">
            <SearchInput value={query} onChange={setQuery} block />
          </div>
        </div>
        {error && (
          <div className="error-text" style={{ marginBottom: 8 }}>
            {error}
          </div>
        )}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="col-w-xl">{t.name}</th>
                <th className="num col-w-sm">{t.tasks}</th>
                <th className="num col-w-sm">{t.totalDuration}</th>
                <th className="actions actions-sticky">{t.actionsHeader}</th>
              </tr>
            </thead>
            <tbody
              key={showSkeleton ? 'loading' : 'ready'}
              className={showSkeleton ? undefined : 'rows-enter'}
            >
              {showSkeleton ? (
                <SkeletonRows cells={3} actions />
              ) : (
                filtered.length === 0 && (
                  <tr>
                    <td colSpan={4} className="hint">
                      {query ? '—' : t.noData}
                    </td>
                  </tr>
                )
              )}
              {!showSkeleton && filtered.map((wt) => {
                const total = wt.tasks.reduce((acc, t) => acc + (t.durationDays || 0), 0);
                return (
                  <tr
                    key={wt.id}
                    className="row-clickable"
                    onClick={() => onEdit(wt)}
                  >
                    <td className="col-name col-wrap">{wt.name}</td>
                    <td className="num">
                      {wt.tasks.length === 0 ? (
                        <span className="hint">0</span>
                      ) : (
                        <HoverTooltip
                          align="right"
                          triggerClassName="count-bubble"
                          trigger={wt.tasks.length}
                        >
                          <div className="shortage-tooltip-header">
                            {t.tasks} — {wt.tasks.length}
                          </div>
                          <ul className="shortage-tooltip-list">
                            {wt.tasks.map((tk, i) => (
                              <li key={`${tk.id}-${i}`}>
                                <span className="shortage-tooltip-name">
                                  {i + 1}. {tk.name}
                                  {tk.type !== 'custom' && (
                                    <span className="workflow-task-type-tag">
                                      {taskTypeLabel(tk.type)}
                                    </span>
                                  )}
                                </span>
                                <span className="list-tooltip-amount">
                                  {tk.durationDays} {t.days}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </HoverTooltip>
                      )}
                    </td>
                    <td className="num">
                      {total} {t.days}
                    </td>
                    <td
                      className="actions actions-sticky"
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      <div className="btn-row">
                        <IconButton
                          className="btn-sm soft-danger"
                          icon={<IconTrash size={14} />}
                          label={t.delete}
                          onClick={() => setConfirmDelete(wt)}
                        />
                        <IconButton
                          className="btn-sm soft-edit"
                          icon={<IconEdit size={14} />}
                          label={t.edit}
                          onClick={() => onEdit(wt)}
                        />
                        <IconButton
                          className="btn-sm soft-success"
                          icon={<IconDuplicate size={14} />}
                          label={t.duplicate}
                          disabled={duplicatingId !== null}
                          onClick={() => void onDuplicate(wt)}
                        />
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
        <WorkflowTemplateEditorModal
          editing={editing}
          setEditing={setEditing}
          onCancel={() => setEditing(null)}
          onSave={onSave}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`${t.confirmDeleteWorkflowTemplate}\n\n${confirmDelete.name}`}
          danger
          onConfirm={() => onDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {busy && <LoadingOverlay message={t.loaderProcessing} />}
    </div>
  );
};

export default WorkflowTemplates;
