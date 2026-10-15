import React from 'react';
import { useT } from '../i18n';
import { useEscapeKey } from '../utils/useEscapeKey';
import ModalHeader from './ModalHeader';
import { IconInfo, IconTrash } from './Icons';

interface Props {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}

// Same shell as every other dialog (ModalHeader + body + footer). Sits above
// other modals, since it is often opened from one.
const ConfirmDialog: React.FC<Props> = ({ message, onConfirm, onCancel, danger }) => {
  const t = useT();
  useEscapeKey(onCancel);
  return (
    <div className="modal-overlay" style={{ zIndex: 1000 }} onClick={onCancel}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <ModalHeader
          icon={danger ? <IconTrash size={18} /> : <IconInfo size={18} />}
          tone={danger ? 'danger' : 'neutral'}
          title={t.confirm}
          onClose={onCancel}
        />
        <div className="modal-body" style={{ whiteSpace: 'pre-wrap' }}>
          {message}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onCancel}>
            {t.cancel}
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'danger-filled' : 'primary-filled'}`}
            onClick={onConfirm}
          >
            {t.confirm}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
