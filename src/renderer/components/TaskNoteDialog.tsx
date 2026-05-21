import React, { useState } from 'react';
import type { TaskInstance } from '../../shared/types';
import { useT } from '../i18n';
import ModalHeader from './ModalHeader';
import { IconNote, IconTrash } from './Icons';
import { useEscapeKey } from '../utils/useEscapeKey';

interface Props {
  task: TaskInstance;
  onCancel: () => void;
  onSave: (note: string) => void | Promise<void>;
}

const TaskNoteDialog: React.FC<Props> = ({ task, onCancel, onSave }) => {
  const t = useT();
  useEscapeKey(onCancel);
  const [note, setNote] = useState<string>(task.note ?? '');
  const hadNote = !!task.note;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal-sm task-note-modal" onClick={(e) => e.stopPropagation()}>
        <ModalHeader
          icon={<IconNote size={18} />}
          tone="edit"
          title={hadNote ? t.taskEditNote : t.taskAddNote}
          onClose={onCancel}
        />
        <div className="modal-body">
          <div className="task-note-modal-task">
            <span className="task-note-modal-task-name">{task.name}</span>
            <span className="task-note-modal-task-dates">
              {task.startDate} → {task.endDate}
            </span>
          </div>
          <div className="form-row">
            <label className="form-label">{t.taskNote}</label>
            <textarea
              className="input task-note-textarea"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t.taskNotePlaceholder}
              rows={5}
              autoFocus
            />
          </div>
        </div>
        <div className="modal-footer">
          {hadNote && (
            <button
              type="button"
              className="btn soft-danger task-note-modal-clear"
              onClick={() => void onSave('')}
            >
              <IconTrash size={13} /> {t.delete}
            </button>
          )}
          <button type="button" className="btn" onClick={onCancel}>
            {t.cancel}
          </button>
          <button
            type="button"
            className="btn primary-filled"
            onClick={() => void onSave(note)}
          >
            {t.save}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TaskNoteDialog;
