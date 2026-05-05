import React from 'react';
import { useT } from '../i18n';

interface Props {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  available: boolean;
  label?: string;
}

const AIToggleButton: React.FC<Props> = ({ enabled, onChange, available, label }) => {
  const t = useT();
  const title = label ?? t.refineWithAI;
  return (
    <button
      type="button"
      className={`btn btn-sm ${enabled && available ? 'primary' : ''}`}
      disabled={!available}
      title={available ? title : t.aiUnavailable}
      onClick={() => onChange(!enabled)}
    >
      <span style={{ fontWeight: 700 }}>AI</span>
      <span>{enabled && available ? 'ON' : 'OFF'}</span>
    </button>
  );
};

export default AIToggleButton;
