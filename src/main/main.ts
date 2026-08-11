import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import log from './utils/logger';
import Database from './database';
import { registerIpcHandlers } from './ipc';
import { runAutoBackup } from './backupService';
import { IPC } from '../shared/ipcChannels';

const DEV_SERVER_PORT = 5183;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

let mainWindow: BrowserWindow | null = null;
let database: Database;

function resolveIconPath(): string | undefined {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'icon.png'),
        path.join(process.resourcesPath, 'icon.icns'),
        path.join(process.resourcesPath, 'icon.ico'),
      ]
    : [
        path.join(__dirname, '..', '..', '..', 'resources', 'icon.png'),
        path.join(__dirname, '..', '..', '..', 'resources', 'icon.icns'),
        path.join(__dirname, '..', '..', '..', 'resources', 'icon.ico'),
      ];
  return candidates.find((p) => {
    try {
      return require('fs').existsSync(p);
    } catch {
      return false;
    }
  });
}

// Exit-time backup. Closing the window (or quitting) is intercepted exactly
// once: today's auto backup is refreshed with everything changed during the
// session, an in-app toast is shown while the window is still visible, and
// only then does the close/quit proceed. `backupOnExitDone` guards re-entry
// and lets the auto-updater's quit skip the whole dance.
let backupOnExitDone = false;

function runExitBackup(resume: () => void): void {
  if (backupOnExitDone || !database) {
    backupOnExitDone = true;
    resume();
    return;
  }
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    backupOnExitDone = true;
    resume();
  };
  // Never block closing for long — if Supabase is slow/offline, give up.
  const failsafe = setTimeout(finish, 15000);

  const notify = (channel: string, payload: unknown) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  };

  // The export + off-site push take a few seconds, during which the window
  // just sits there — say what's happening before starting the work, not only
  // after it finishes.
  notify(IPC.EVT_BACKUP_STARTED, { trigger: 'quit' });

  runAutoBackup(database, { force: true })
    .then((info) => {
      // A failed exit backup used to close the window in silence, leaving the
      // "backing up…" toast as the last thing seen. Report both outcomes.
      notify(
        info ? IPC.EVT_BACKUP_CREATED : IPC.EVT_BACKUP_FAILED,
        info ? { ...info, trigger: 'quit' } : { trigger: 'quit' },
      );
      // Keep the window up long enough for the toast to be seen.
      return new Promise<void>((resolve) => setTimeout(resolve, 2500));
    })
    .finally(() => {
      clearTimeout(failsafe);
      finish();
    });
}

function createWindow(): void {
  // A fresh window starts a fresh session — its close deserves its own backup.
  backupOnExitDone = false;

  const iconPath = resolveIconPath();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.maximize();

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));
  } else {
    mainWindow.loadURL(DEV_SERVER_URL);
  }

  mainWindow.on('close', (event) => {
    // Intercept the X button too — on the app-quit path before-quit fires only
    // after the window is gone, too late for an in-app notification.
    if (backupOnExitDone) return;
    event.preventDefault();
    runExitBackup(() => mainWindow?.close());
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function setupAutoUpdater(): void {
  log.transports.file.level = 'debug';
  autoUpdater.logger = log;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  // Allow installing builds without an Apple-notarized signature.
  process.env.ELECTRON_UPDATER_ALLOW_UNVERIFIED = '1';
  (autoUpdater as any).forceDevUpdateConfig = true;
  (autoUpdater as any).allowDowngrade = true;

  autoUpdater.on('update-available', (info) => {
    if (mainWindow) mainWindow.webContents.send(IPC.EVT_UPDATE_AVAILABLE, info);
  });
  autoUpdater.on('update-downloaded', (info) => {
    if (mainWindow) mainWindow.webContents.send(IPC.EVT_UPDATE_DOWNLOADED, info);
    if (process.platform === 'win32') {
      setTimeout(() => {
        // Don't let the exit-time backup preventDefault this quit — the updater
        // relaunches the app and the startup backup covers the gap.
        backupOnExitDone = true;
        autoUpdater.quitAndInstall();
      }, 2000);
    }
  });
  autoUpdater.on('error', (err) => {
    if (mainWindow) mainWindow.webContents.send(IPC.EVT_UPDATE_ERROR, err.message);
  });
  autoUpdater.on('download-progress', (progress) => {
    if (mainWindow) mainWindow.webContents.send(IPC.EVT_DOWNLOAD_PROGRESS, progress);
  });

  if (app.isPackaged) {
    setTimeout(() => {
      if (process.platform === 'darwin') {
        autoUpdater.checkForUpdates().catch((err) => log.error('mac startup check failed:', err));
      } else {
        autoUpdater.checkForUpdatesAndNotify();
      }
    }, 3000);
  }
}

function ensureAutoLaunch(): void {
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: false,
      ...(process.platform === 'win32' ? { path: process.execPath, args: [] } : {}),
    });
  } catch (err) {
    log.warn('Failed to set login item:', err);
  }
}

// Two instances sharing one user-data-dir fight over the Chromium storage
// backend: the second one's first synchronous localStorage read blocks for
// ~4s waiting on the LevelDB lock (measured 3861ms vs 0ms), and both would
// write the same Supabase data and run their own exit backup. Focus the
// window that already exists instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    const iconPath = resolveIconPath();
    if (iconPath) {
      try {
        app.dock?.setIcon(iconPath);
      } catch (err) {
        log.warn('Failed to set dock icon:', err);
      }
    }
  }
  ensureAutoLaunch();
  database = new Database();
  registerIpcHandlers(database, () => mainWindow);
  setupAutoUpdater();
  createWindow();

  // Startup auto backup — a safety net for days whose exit backup never ran:
  // it writes (and toasts) only when today's file is missing, i.e. on the
  // first open of the day or after a crash killed the previous session before
  // its exit backup. Delayed so the persisted Supabase session has time to
  // restore; without a session the reads fail and the backup is skipped (logged).
  setTimeout(async () => {
    const info = await runAutoBackup(database);
    if (info && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.EVT_BACKUP_CREATED, { ...info, trigger: 'startup' });
    }
  }, 15000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (backupOnExitDone || !database) return;
  event.preventDefault();
  runExitBackup(() => app.quit());
});
