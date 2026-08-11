import React, { useEffect, useState } from 'react';
import { useT } from '../i18n';

/** 'progress' = work running (green frame + spinner), 'ok' = done, 'warn' = problem. */
type ToastTone = 'progress' | 'ok' | 'warn';

interface ToastState {
  message: string;
  tone: ToastTone;
  /** In-progress toasts stay until replaced — the app is closing anyway. */
  sticky?: boolean;
}

/**
 * Invisible bridge: listens for the main process's auto-backup pushes and
 * surfaces them as a floating toast. On exit the sequence is "backing up…"
 * (sent before the work starts, because the export plus off-site push take a
 * few seconds of frozen window) and then the result; the main process holds
 * the window open for a moment so that result is actually seen. The startup
 * backup only sends the result, since it usually has nothing to do.
 *
 * The toast also reports the off-site push, so "saved locally" and "saved
 * locally AND copied to the backups repo" are distinguishable without
 * digging through main.log. A failed push turns the toast into a warning;
 * machines with no upload config say nothing about it at all.
 */
const BackupNotifier: React.FC = () => {
  const t = useT();
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    const offCreated = window.electronAPI.onBackupCreated((info) => {
      const offsite =
        info.upload === 'uploaded'
          ? t.backupOffsiteOk
          : info.upload === 'failed'
            ? t.backupOffsiteFailed
            : '';
      const message = (info.trigger === 'quit' ? t.backupExitCreated : t.backupAutoCreated)
        .replace('{date}', info.date)
        .replace('{offsite}', offsite);
      setToast({ message, tone: info.upload === 'failed' ? 'warn' : 'ok' });
    });
    const offStarted = window.electronAPI.onBackupStarted(() => {
      setToast({ message: t.backupExitInProgress, tone: 'progress', sticky: true });
    });
    const offFailed = window.electronAPI.onBackupFailed(() => {
      setToast({ message: t.backupExitFailed, tone: 'warn' });
    });
    return () => {
      offCreated();
      offStarted();
      offFailed();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  useEffect(() => {
    if (!toast || toast.sticky) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;

  return (
    <div
      className={`backup-toast ${toast.tone}`}
      onClick={() => setToast(null)}
      role="status"
      aria-live="polite"
    >
      <span className="backup-toast-mark" aria-hidden="true">
        {toast.tone === 'progress' ? (
          <span className="backup-toast-spinner" />
        ) : toast.tone === 'ok' ? (
          '✓'
        ) : (
          '!'
        )}
      </span>
      <span className="backup-toast-text">{toast.message}</span>
    </div>
  );
};

export default BackupNotifier;
