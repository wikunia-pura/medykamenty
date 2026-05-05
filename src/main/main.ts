import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import log from './utils/logger';
import Database from './database';
import { registerIpcHandlers } from './ipc';
import { IPC } from '../shared/ipcChannels';

const DEV_SERVER_PORT = 3000;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

let mainWindow: BrowserWindow | null = null;
let database: Database;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));
  } else {
    mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  }

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
      setTimeout(() => autoUpdater.quitAndInstall(), 2000);
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

app.whenReady().then(() => {
  database = new Database();
  registerIpcHandlers(database, () => mainWindow);
  setupAutoUpdater();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
