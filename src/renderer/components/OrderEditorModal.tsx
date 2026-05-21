import React, { useEffect, useState } from 'react';
import type { Order, OrderStatus, WorkflowTemplate } from '../../shared/types';
import { useT } from '../i18n';
import ModalHeader from './ModalHeader';
import { IconPlus, IconClose, IconEdit } from './Icons';
import { useEscapeKey } from '../utils/useEscapeKey';

interface Props {
  editing: Partial<Order>;
  setEditing: (next: Partial<Order>) => void;
  onCancel: () => void;
  /**
   * Returns the workflowTemplateId the user picked (or null if none). The
   * caller is responsible for attaching the workflow after the order is
   * created. Only relevant when editing.id is unset (new order); on edit the
   * picker stays hidden because attach happens from OrderDetails.
   */
  onSave: (workflowTemplateId: string | null) => void | Promise<void>;
}

const todayIso = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const OrderEditorModal: React.FC<Props> = ({ editing, setEditing, onCancel, onSave }) => {
  const t = useT();
  useEscapeKey(onCancel);

  const isNew = !editing.id;
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');

  useEffect(() => {
    if (!isNew) return;
    void (async () => {
      try {
        const list = await window.electronAPI.listWorkflowTemplates();
        setTemplates(list);
      } catch {
        /* ignore — picker just stays empty */
      }
    })();
  }, [isNew]);

  const statusOptions: { value: OrderStatus; label: string }[] = [
    { value: 'draft', label: t.orderStatusDraft },
    { value: 'in_progress', label: t.orderStatusInProgress },
    { value: 'completed', label: t.orderStatusCompleted },
    { value: 'cancelled', label: t.orderStatusCancelled },
  ];

  const canSave =
    !!(editing.name && editing.name.trim()) && !!(editing.startDate && editing.startDate);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal-md" onClick={(e) => e.stopPropagation()}>
        <ModalHeader
          icon={editing.id ? <IconEdit size={18} /> : <IconPlus size={18} />}
          tone={editing.id ? 'edit' : 'add'}
          title={editing.id ? `${t.edit}: ${editing.name ?? ''}` : t.orderNew}
          onClose={onCancel}
        />
        <div className="modal-body">
          <div className="form-row">
            <label className="form-label">{t.orderName}</label>
            <input
              type="text"
              className="input"
              value={editing.name ?? ''}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder={t.orderName}
              autoFocus
            />
          </div>
          <div className="form-row">
            <label className="form-label">{t.orderStartDate}</label>
            <input
              type="date"
              className="input"
              value={editing.startDate ?? todayIso()}
              onChange={(e) => setEditing({ ...editing, startDate: e.target.value })}
            />
          </div>
          <div className="form-row">
            <label className="form-label">{t.orderStatus}</label>
            <select
              value={editing.status ?? 'draft'}
              onChange={(e) =>
                setEditing({ ...editing, status: e.target.value as OrderStatus })
              }
            >
              {statusOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {isNew && (
            <div className="form-row">
              <label className="form-label">{t.workflow}</label>
              <select
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                disabled={templates.length === 0}
              >
                <option value="">
                  {templates.length === 0
                    ? `— ${t.workflowTemplatesEmpty} —`
                    : `— ${t.noWorkflowAttached} —`}
                </option>
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name} ({tpl.tasks.length} {t.tasks.toLowerCase()})
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="form-row">
            <label className="form-label">{t.orderNotes}</label>
            <textarea
              value={editing.notes ?? ''}
              onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
              rows={3}
            />
          </div>
          {!isNew && (
            <label className="settings-toggle-row" style={{ marginTop: 6 }}>
              <span>{t.archivedField}</span>
              <input
                type="checkbox"
                checked={!!editing.archived}
                onChange={(e) =>
                  setEditing({ ...editing, archived: e.target.checked })
                }
              />
            </label>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onCancel}>
            {t.cancel}
          </button>
          <button
            type="button"
            className="btn primary-filled"
            disabled={!canSave}
            onClick={() => onSave(isNew ? selectedTemplateId || null : null)}
          >
            {t.save}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OrderEditorModal;
