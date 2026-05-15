import React, { useEffect, useState } from 'react';
import { useT } from '../i18n';

type Phase = 'idle' | 'downloading' | 'ready';

interface Progress {
  percent?: number;
  transferred?: number;
  total?: number;
}

const UpdateNotification: React.FC = () => {
  const t = useT();
  const [available, setAvailable] = useState<{ version?: string } | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI.onUpdateAvailable((info) => {
      setAvailable(info);
      setPhase('idle');
      setProgress(null);
      setError(null);
    });
    window.electronAPI.onDownloadProgress((p) => {
      setProgress({ percent: p?.percent, transferred: p?.transferred, total: p?.total });
    });
    window.electronAPI.onUpdateDownloaded(() => {
      setPhase('ready');
    });
    window.electronAPI.onUpdateError((msg) => {
      setError(msg);
      setPhase('idle');
    });
  }, []);

  if (!available) return null;

  const isWindows = window.electronAPI.platform === 'win32';
  const percent = Math.max(0, Math.min(100, Math.round(progress?.percent ?? 0)));

  const onDownload = async () => {
    setError(null);
    if (isWindows) {
      setPhase('downloading');
    }
    try {
      const r = await window.electronAPI.downloadUpdate();
      if (r.error) setError(r.error);
      // Non-Windows path opens the browser; close the banner.
      if (!isWindows || r.openedRelease) {
        setAvailable(null);
      }
    } catch (err) {
      setError((err as Error).message);
      setPhase('idle');
    }
  };

  return (
    <div className="banner">
      <div>
        {phase === 'ready'
          ? `${t.appName} ${available.version ? `v${available.version}` : ''} — gotowe do instalacji. Aplikacja zrestartuje się za chwilę.`
          : phase === 'downloading'
            ? `${t.appName} ${available.version ? `v${available.version}` : ''} — pobieranie ${percent}%${progress?.total ? ` (${Math.round((progress.transferred ?? 0) / 1024 / 1024)} / ${Math.round((progress.total ?? 0) / 1024 / 1024)} MB)` : ''}`
            : `${t.appName} ${available.version ? `v${available.version}` : ''} dostępna do pobrania.`}
        {error && <span style={{ marginLeft: 8, opacity: 0.85 }}>({error})</span>}
      </div>
      <div className="btn-row">
        {phase === 'idle' && (
          <button
            className="btn"
            onClick={onDownload}
            style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}
          >
            {t.download}
          </button>
        )}
        {phase === 'downloading' && (
          <div
            aria-label="progress"
            style={{
              width: 160,
              height: 8,
              background: 'rgba(255,255,255,0.25)',
              borderRadius: 4,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${percent}%`,
                height: '100%',
                background: '#fff',
                transition: 'width 200ms ease',
              }}
            />
          </div>
        )}
        {phase !== 'downloading' && (
          <button
            className="btn ghost"
            onClick={() => setAvailable(null)}
            style={{ color: '#fff' }}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
};

export default UpdateNotification;
