import React, { useState } from 'react';
import type { WorkflowTemplate, TaskTemplate, TaskType } from '../../shared/types';
import { useT } from '../i18n';
import ModalHeader from './ModalHeader';
import NumberInput from './NumberInput';
import { IconPlus, IconClose, IconEdit, IconEye } from './Icons';
import { useEscapeKey } from '../utils/useEscapeKey';

// Client-side temporary ID for unsaved tasks. The backend assigns the real UUID
// on save, but the editor needs stable keys for React's reconciliation while
// the list is being edited.
const newClientId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;

interface Props {
  editing: Partial<WorkflowTemplate>;
  setEditing: (next: Partial<WorkflowTemplate>) => void;
  onCancel: () => void;
  onSave: () => void | Promise<void>;
  readOnly?: boolean;
}

const WorkflowTemplateEditorModal: React.FC<Props> = ({
  editing,
  setEditing,
  onCancel,
  onSave,
  readOnly = false,
}) => {
  const t = useT();
  useEscapeKey(onCancel);

  const tasks: TaskTemplate[] = editing.tasks ?? [];

  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const updateTask = (idx: number, patch: Partial<TaskTemplate>) => {
    if (readOnly) return;
    const next = tasks.slice();
    next[idx] = { ...next[idx], ...patch };
    setEditing({ ...editing, tasks: next });
  };

  const removeTask = (idx: number) => {
    if (readOnly) return;
    setEditing({ ...editing, tasks: tasks.filter((_, i) => i !== idx) });
  };

  const addTask = () => {
    if (readOnly) return;
    setEditing({
      ...editing,
      tasks: [
        ...tasks,
        { id: newClientId(), name: '', type: 'custom', durationDays: 1 },
      ],
    });
  };

  const onDragStart = (idx: number) => (e: React.DragEvent) => {
    if (readOnly) return;
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  };

  const onDragOver = (idx: number) => (e: React.DragEvent) => {
    if (readOnly) return;
    if (dragIdx === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIdx !== idx) setDragOverIdx(idx);
  };

  const onDrop = (idx: number) => (e: React.DragEvent) => {
    if (readOnly) return;
    e.preventDefault();
    if (dragIdx !== null && dragIdx !== idx) {
      const next = tasks.slice();
      const [moved] = next.splice(dragIdx, 1);
      next.splice(idx, 0, moved);
      setEditing({ ...editing, tasks: next });
    }
    setDragIdx(null);
    setDragOverIdx(null);
  };

  const onDragEnd = () => {
    setDragIdx(null);
    setDragOverIdx(null);
  };

  const typeOptions: { value: TaskType; label: string }[] = [
    { value: 'custom', label: t.taskTypeCustom },
    { value: 'import_stock', label: t.taskTypeImportStock },
    { value: 'generate_shortage', label: t.taskTypeGenerateShortage },
    { value: 'generate_emails', label: t.taskTypeGenerateEmails },
  ];

  const totalDays = tasks.reduce((acc, t) => acc + (t.durationDays || 0), 0);
  const canSave =
    !readOnly &&
    !!(editing.name && editing.name.trim()) &&
    tasks.every((tk) => tk.name.trim());

  const title = readOnly
    ? `${t.workflowTemplatePreview}: ${editing.name ?? ''}`
    : editing.id
      ? `${t.edit}: ${editing.name ?? ''}`
      : t.workflowTemplateNew;

  const icon = readOnly ? (
    <IconEye size={18} />
  ) : editing.id ? (
    <IconEdit size={18} />
  ) : (
    <IconPlus size={18} />
  );

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className={`modal modal-md${readOnly ? ' modal-readonly' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <ModalHeader
          icon={icon}
          tone={readOnly ? 'neutral' : editing.id ? 'edit' : 'add'}
          title={title}
          subtitle={`${tasks.length} ${t.tasks.toLowerCase()} · ${totalDays} ${t.days}`}
          onClose={onCancel}
        />
        <div className="modal-body">
          <div className="form-row">
            <label className="form-label">{t.name}</label>
            <input
              type="text"
              className="input"
              value={editing.name ?? ''}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder={t.workflowTemplateNamePlaceholder}
              autoFocus={!readOnly}
              disabled={readOnly}
            />
          </div>

          <div className="form-row">
            <div className="form-row-header">
              <label className="form-label">{t.tasks}</label>
              {!readOnly && (
                <button
                  type="button"
                  className="btn btn-sm soft-edit"
                  onClick={addTask}
                >
                  <IconPlus size={13} /> {t.addTask}
                </button>
              )}
            </div>
            {tasks.length === 0 && (
              <div className="empty-hint">{t.workflowTemplateNoTasks}</div>
            )}
            <div className="workflow-task-list">
              {tasks.map((task, idx) => {
                const isDragged = !readOnly && dragIdx === idx;
                const isOver =
                  !readOnly && dragOverIdx === idx && dragIdx !== null && dragIdx !== idx;
                return (
                  <div
                    key={task.id}
                    className={`workflow-task-row${isDragged ? ' dragging' : ''}${
                      isOver ? ' drag-over' : ''
                    }`}
                    draggable={!readOnly}
                    onDragStart={onDragStart(idx)}
                    onDragOver={onDragOver(idx)}
                    onDrop={onDrop(idx)}
                    onDragEnd={onDragEnd}
                  >
                    {!readOnly && (
                      <span className="workflow-task-handle" aria-hidden>
                        ⋮⋮
                      </span>
                    )}
                    <span className="workflow-task-idx">{idx + 1}.</span>
                    <input
                      type="text"
                      className="input workflow-task-name"
                      value={task.name}
                      onChange={(e) => updateTask(idx, { name: e.target.value })}
                      placeholder={t.taskNamePlaceholder}
                      disabled={readOnly}
                    />
                    <select
                      className="workflow-task-type"
                      value={task.type}
                      onChange={(e) =>
                        updateTask(idx, { type: e.target.value as TaskType })
                      }
                      disabled={readOnly}
                    >
                      {typeOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <div className="workflow-task-duration">
                      <NumberInput
                        className="input"
                        style={{ width: 60 }}
                        value={task.durationDays}
                        onChange={(v) =>
                          updateTask(idx, { durationDays: Math.max(1, v ?? 1) })
                        }
                        min={1}
                        disabled={readOnly}
                      />
                      <span className="workflow-task-duration-suffix">{t.days}</span>
                    </div>
                    {!readOnly && (
                      <button
                        type="button"
                        className="btn btn-sm soft-danger btn-icon-only"
                        onClick={() => removeTask(idx)}
                        title={t.delete}
                      >
                        <IconClose size={12} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          {readOnly ? (
            <button type="button" className="btn primary-filled" onClick={onCancel}>
              {t.close}
            </button>
          ) : (
            <>
              <button type="button" className="btn" onClick={onCancel}>
                {t.cancel}
              </button>
              <button
                type="button"
                className="btn primary-filled"
                disabled={!canSave}
                onClick={onSave}
              >
                {t.save}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default WorkflowTemplateEditorModal;
