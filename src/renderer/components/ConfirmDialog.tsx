import React from 'react';
import { useT } from '../i18n';

interface Props {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}

const ConfirmDialog: React.FC<Props> = ({ message, onConfirm, onCancel, danger }) => {
  const t = useT();
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onCancel}
    >
      <div
        className="card"
        style={{ minWidth: 360, maxWidth: 480 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ marginBottom: 16, whiteSpace: 'pre-wrap' }}>{message}</div>
        <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onCancel}>
            {t.cancel}
          </button>
          <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>
            {t.confirm}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
