import React, { useEffect, useState } from 'react';
import { useT } from '../i18n';

const UpdateNotification: React.FC = () => {
  const t = useT();
  const [available, setAvailable] = useState<{ version?: string } | null>(null);

  useEffect(() => {
    window.electronAPI.onUpdateAvailable((info) => setAvailable(info));
  }, []);

  if (!available) return null;

  return (
    <div className="banner">
      <div>
        {t.appName} {available.version ? `v${available.version}` : ''} dostępna do pobrania.
      </div>
      <div className="btn-row">
        <button
          className="btn"
          onClick={() => window.electronAPI.downloadUpdate()}
          style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}
        >
          {t.download}
        </button>
        <button
          className="btn ghost"
          onClick={() => setAvailable(null)}
          style={{ color: '#fff' }}
        >
          ×
        </button>
      </div>
    </div>
  );
};

export default UpdateNotification;
