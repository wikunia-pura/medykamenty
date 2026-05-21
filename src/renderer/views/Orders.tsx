import React, { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { HeaderNav } from '../navigation';
import type { Order, OrderStatus, TaskInstance } from '../../shared/types';
import OrderEditorModal from '../components/OrderEditorModal';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingOverlay from '../components/LoadingOverlay';
import SearchInput, { matchesQuery } from '../components/SearchInput';
import TaskNoteDialog from '../components/TaskNoteDialog';
import TaskProgressBar, { type TaskAction } from '../components/TaskProgressBar';
import {
  IconDuplicate,
  IconEdit,
  IconPlus,
  IconSettings,
  IconTrash,
} from '../components/Icons';
import ModalHeader from '../components/ModalHeader';
import { useEscapeKey } from '../utils/useEscapeKey';

interface Props {
  onOpenOrder: (id: string) => void;
  onNavigateForTask: (
    target: 'stockImport' | 'shortageReport' | 'emailGenerator',
    orderId: string,
    taskId: string,
  ) => void;
}

const todayIso = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const Orders: React.FC<Props> = ({ onOpenOrder, onNavigateForTask }) => {
  const t = useT();
  const [items, setItems] = useState<Order[]>([]);
  const [editing, setEditing] = useState<Partial<Order> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingNote, setEditingNote] =
    useState<{ orderId: string; task: TaskInstance } | null>(null);
  useEscapeKey(() => setSettingsOpen(false), settingsOpen);

  const reload = async () => {
    try {
      const list = await window.electronAPI.listOrders();
      setItems(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const onAdd = () => {
    setEditing({ name: '', startDate: todayIso(), status: 'draft', notes: '' });
  };

  const onEdit = (o: Order) => {
    setEditing({ ...o });
  };

  const onSave = async (workflowTemplateId: string | null) => {
    if (!editing) return;
    const name = (editing.name ?? '').trim();
    const startDate = editing.startDate;
    if (!name || !startDate) return;
    setBusy(true);
    try {
      if (editing.id) {
        await window.electronAPI.updateOrder(editing.id, {
          name,
          startDate,
          status: editing.status ?? 'draft',
          notes: editing.notes,
          archived: editing.archived ?? false,
        });
      } else {
        const created = await window.electronAPI.createOrder({
          name,
          startDate,
          status: editing.status ?? 'draft',
          notes: editing.notes,
        });
        if (workflowTemplateId) {
          await window.electronAPI.attachWorkflowToOrder(created.id, workflowTemplateId);
        }
      }
      setEditing(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (o: Order) => {
    setConfirmDelete(null);
    setBusy(true);
    try {
      await window.electronAPI.deleteOrder(o.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onTaskAction = async (order: Order, task: TaskInstance, action: TaskAction) => {
    if (action.kind === 'setStatus') {
      setBusy(true);
      try {
        await window.electronAPI.updateOrderTask(order.id, task.id, {
          status: action.status,
        });
        await reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    } else if (action.kind === 'open') {
      const target =
        task.type === 'import_stock'
          ? 'stockImport'
          : task.type === 'generate_shortage'
            ? 'shortageReport'
            : task.type === 'generate_emails'
              ? 'emailGenerator'
              : null;
      if (!target) return;
      // Auto-start the task when opening its screen, same as in OrderDetails.
      if (task.status === 'todo') {
        try {
          await window.electronAPI.updateOrderTask(order.id, task.id, {
            status: 'in_progress',
          });
        } catch {
          /* non-fatal: the user can still click "mark done" later */
        }
      }
      onNavigateForTask(target, order.id, task.id);
    } else if (action.kind === 'editNote') {
      setEditingNote({ orderId: order.id, task });
    }
  };

  const onPickStatus = async (o: Order, status: OrderStatus) => {
    setBusy(true);
    try {
      await window.electronAPI.updateOrder(o.id, { status });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const statusOptions: { value: OrderStatus; label: string }[] = [
    { value: 'draft', label: t.orderStatusDraft },
    { value: 'in_progress', label: t.orderStatusInProgress },
    { value: 'completed', label: t.orderStatusCompleted },
    { value: 'cancelled', label: t.orderStatusCancelled },
  ];

  const visible = showArchived ? items : items.filter((o) => !o.archived);
  const archivedCount = items.filter((o) => o.archived).length;
  const filtered = visible.filter((o) => matchesQuery(o, query));

  return (
    <div className="main">
      <div className="page-header">
        <HeaderNav />
        <h1>{t.orders}</h1>
        <span className="page-header-count">{items.length}</span>
        <button
          type="button"
          className="btn btn-sm"
          style={{ marginLeft: 'auto' }}
          onClick={() => setSettingsOpen(true)}
          title={t.settings}
          aria-label={t.settings}
        >
          <IconSettings size={14} />
        </button>
      </div>

      <div className="card">
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
          <table className="table orders-list-table">
            <thead>
              <tr>
                <th className="col-w-lg">{t.name}</th>
                <th className="col-w-sm">{t.orderStartDate}</th>
                <th className="col-w-sm">{t.orderEndDate}</th>
                <th>{t.workflow}</th>
                <th className="actions actions-sticky">{t.actionsHeader}</th>
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
              {filtered.map((o) => {
                const tasks = o.workflow?.tasks ?? [];
                const endDate =
                  tasks.length > 0 ? tasks[tasks.length - 1].endDate : null;
                return (
                  <tr
                    key={o.id}
                    className={`row-clickable${o.archived ? ' row-archived' : ''}`}
                    onClick={() => onOpenOrder(o.id)}
                    title={t.orderDetails}
                  >
                    <td className="col-name">
                      <div className="orders-name-cell">
                        <span className="orders-name-text">{o.name}</span>
                        {o.archived && (
                          <span className="tag" title={t.archivedTag}>
                            {t.archivedTag}
                          </span>
                        )}
                        <select
                          className={`status-inline-select order-status-${o.status}`}
                          value={o.status}
                          onClick={(ev) => ev.stopPropagation()}
                          onChange={(e) =>
                            void onPickStatus(o, e.target.value as OrderStatus)
                          }
                          title={t.changeStatus}
                        >
                          {statusOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                    <td>{o.startDate}</td>
                    <td>{endDate ?? <span className="hint">—</span>}</td>
                    <td>
                      {tasks.length === 0 ? (
                        <span className="hint">—</span>
                      ) : (
                        <div onClick={(ev) => ev.stopPropagation()}>
                          <TaskProgressBar
                            tasks={tasks}
                            size="md"
                            interactive
                            onTaskAction={(task, action) =>
                              onTaskAction(o, task, action)
                            }
                          />
                        </div>
                      )}
                    </td>
                    <td
                      className="actions actions-sticky"
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      <div className="btn-row">
                        <button
                          className="btn btn-sm soft-edit"
                          onClick={() => onEdit(o)}
                          title={t.edit}
                        >
                          <IconEdit size={13} /> {t.edit}
                        </button>
                        <button
                          className="btn btn-sm soft-success"
                          onClick={async () => {
                            await window.electronAPI.duplicateOrder(o.id);
                            await reload();
                          }}
                          title={t.duplicate}
                        >
                          <IconDuplicate size={13} /> {t.duplicate}
                        </button>
                        <button
                          className="btn btn-sm soft-danger"
                          onClick={() => setConfirmDelete(o)}
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
        <OrderEditorModal
          editing={editing}
          setEditing={setEditing}
          onCancel={() => setEditing(null)}
          onSave={onSave}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`${t.confirmDeleteOrder}\n\n${confirmDelete.name}`}
          danger
          onConfirm={() => onDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {editingNote && (
        <TaskNoteDialog
          task={editingNote.task}
          onCancel={() => setEditingNote(null)}
          onSave={async (note) => {
            const { orderId, task } = editingNote;
            setBusy(true);
            try {
              await window.electronAPI.updateOrderTask(orderId, task.id, { note });
              await reload();
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
              setEditingNote(null);
            }
          }}
        />
      )}

      {settingsOpen && (
        <div className="modal-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
            <ModalHeader
              icon={<IconSettings size={18} />}
              tone="edit"
              title={t.settings}
              onClose={() => setSettingsOpen(false)}
            />
            <div className="modal-body">
              <label className="settings-toggle-row">
                <span>
                  {t.showArchived}
                  {archivedCount > 0 && (
                    <span className="hint" style={{ marginLeft: 6 }}>
                      ({archivedCount})
                    </span>
                  )}
                </span>
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(ev) => setShowArchived(ev.target.checked)}
                />
              </label>
            </div>
            <div className="modal-footer">
              <button
                className="btn primary-filled"
                onClick={() => setSettingsOpen(false)}
              >
                {t.close}
              </button>
            </div>
          </div>
        </div>
      )}

      {busy && <LoadingOverlay message={t.loaderProcessing} />}
    </div>
  );
};

export default Orders;
