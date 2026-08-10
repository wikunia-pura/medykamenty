import React, { useEffect, useState } from 'react';
import { useT } from '../i18n';

interface ToastState {
  message: string;
  warn: boolean;
}

/**
 * Invisible bridge: listens for the main process's "auto backup written"
 * push and surfaces it as a floating toast. Fired after the startup backup
 * and on exit — the main process holds the window open for a moment after
 * the exit backup so this toast is actually seen before the app closes.
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
    return window.electronAPI.onBackupCreated((info) => {
      const offsite =
        info.upload === 'uploaded'
          ? t.backupOffsiteOk
          : info.upload === 'failed'
            ? t.backupOffsiteFailed
            : '';
      const message = (info.trigger === 'quit' ? t.backupExitCreated : t.backupAutoCreated)
        .replace('{date}', info.date)
        .replace('{offsite}', offsite);
      setToast({ message, warn: info.upload === 'failed' });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;

  return (
    <div className={`backup-toast${toast.warn ? ' warn' : ''}`} onClick={() => setToast(null)}>
      {toast.message}
    </div>
  );
};

export default BackupNotifier;
