import React from 'react';
import { IconClose } from './Icons';
import { useT } from '../i18n';

interface Props {
  icon: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose: () => void;
  /** Color tint for the icon badge. Defaults to "neutral". */
  tone?: 'edit' | 'add' | 'danger' | 'neutral';
}

const ModalHeader: React.FC<Props> = ({ icon, title, subtitle, onClose, tone = 'neutral' }) => {
  const t = useT();
  return (
    <div className="modal-header">
      <div className="modal-header-row">
        <span className={`modal-header-icon modal-header-icon-${tone}`} aria-hidden>
          {icon}
        </span>
        <h2 className="modal-title">{title}</h2>
        <button
          type="button"
          className="modal-close"
          onClick={onClose}
          title={t.close}
          aria-label={t.close}
        >
          <IconClose size={16} />
        </button>
      </div>
      {subtitle && <p className="modal-subtitle">{subtitle}</p>}
    </div>
  );
};

export default ModalHeader;
