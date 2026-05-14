import React from 'react';
import { useT } from '../i18n';

interface Props {
  message?: string;
}

const LoadingOverlay: React.FC<Props> = ({ message }) => {
  const t = useT();
  return (
    <div className="modal-overlay loading-overlay" role="status" aria-live="polite">
      <div className="loading-overlay-card">
        <div className="loading-spinner" aria-hidden="true" />
        <div className="loading-overlay-text">{message ?? t.loading}</div>
      </div>
    </div>
  );
};

export default LoadingOverlay;
