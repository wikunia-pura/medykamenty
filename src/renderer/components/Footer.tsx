import React, { useEffect, useState } from 'react';
import { useT } from '../i18n';

interface Props {
  appVersion: string;
}

const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.0;

const Footer: React.FC<Props> = ({ appVersion }) => {
  const t = useT();
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);

  useEffect(() => {
    try {
      setZoom(window.electronAPI.getZoomFactor());
    } catch {
      // running in a non-Electron context — leave zoom at 1
    }
  }, []);

  useEffect(() => {
    if (!updateMsg) return;
    const id = window.setTimeout(() => setUpdateMsg(null), 6000);
    return () => window.clearTimeout(id);
  }, [updateMsg]);

  const applyZoom = (next: number) => {
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(next.toFixed(2))));
    window.electronAPI.setZoomFactor(clamped);
    setZoom(clamped);
  };

  const checkUpdates = async () => {
    setBusy(true);
    setUpdateMsg(null);
    try {
      const r = await window.electronAPI.checkForUpdates();
      if (r.error) setUpdateMsg(`${t.error}: ${r.error}`);
      else if (r.available)
        setUpdateMsg(`${t.appName} ${r.info?.version ?? ''} ${t.updateAvailable}`);
      else setUpdateMsg(r.message ?? t.upToDate);
    } catch (err) {
      setUpdateMsg(`${t.error}: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <footer className="app-footer">
      <div className="app-footer-track" aria-hidden="true">
        <span className="app-footer-runner pig" role="img" aria-label="pig">
          🐖
        </span>
        <span className="app-footer-runner cat" role="img" aria-label="cat">
          🐈
        </span>
      </div>

      <div className="app-footer-inner">
        <div className="app-footer-section">
          <span className="app-footer-version">
            {t.appName} {t.version} {appVersion}
          </span>
        </div>

        <div className="app-footer-section app-footer-center">
          <span className="app-footer-text">
            Made with <span className="app-footer-heart">♥</span> for 🍌 by 🦙
          </span>
        </div>

        <div className="app-footer-section app-footer-right">
          <div className="app-footer-zoom" role="group" aria-label={t.zoom}>
            <button
              type="button"
              className="btn btn-sm app-footer-btn"
              onClick={() => applyZoom(zoom - ZOOM_STEP)}
              disabled={zoom <= ZOOM_MIN + 0.001}
              title={t.zoomOut}
              aria-label={t.zoomOut}
            >
              −
            </button>
            <button
              type="button"
              className="btn btn-sm app-footer-btn app-footer-zoom-value"
              onClick={() => applyZoom(1)}
              title={t.zoomReset}
              aria-label={t.zoomReset}
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              className="btn btn-sm app-footer-btn"
              onClick={() => applyZoom(zoom + ZOOM_STEP)}
              disabled={zoom >= ZOOM_MAX - 0.001}
              title={t.zoomIn}
              aria-label={t.zoomIn}
            >
              +
            </button>
          </div>
          <button
            type="button"
            className="btn btn-sm app-footer-btn"
            onClick={checkUpdates}
            disabled={busy}
            title={t.checkForUpdates}
          >
            {busy ? t.loading : t.checkForUpdates}
          </button>
          {updateMsg && (
            <span className="app-footer-update-msg" role="status">
              {updateMsg}
            </span>
          )}
        </div>
      </div>
    </footer>
  );
};

export default Footer;
