// BSX integration config helpers.
//
// Non-secret fields (cloud key, username, warehouse IDs) live in AppSettings
// (electron-store). The password is stored separately, encrypted via Electron's
// safeStorage so it never sits in plain text on disk. AppSettings carries a
// boolean `hasPassword` flag so the renderer can show "password set" without
// the password itself ever crossing the IPC boundary back to the UI.

import fs from 'fs';
import path from 'path';
import { app, safeStorage } from 'electron';
import log from './utils/logger';
import type Database from './database';
import type { BsxIntegrationSettings } from '../shared/types';

const DEFAULT_RAW_IDSTOCK = 6;
const DEFAULT_COMPONENT_IDSTOCK = 7;

function passwordFile(): string {
  return path.join(app.getPath('userData'), 'bsx-password.enc');
}

export function isPasswordStored(): boolean {
  try {
    return fs.existsSync(passwordFile());
  } catch {
    return false;
  }
}

export function setPassword(password: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption is not available on this platform');
  }
  const encrypted = safeStorage.encryptString(password);
  fs.writeFileSync(passwordFile(), encrypted, { mode: 0o600 });
}

export function clearPassword(): void {
  try {
    fs.unlinkSync(passwordFile());
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== 'ENOENT') throw err;
  }
}

export function getPassword(): string | undefined {
  if (!isPasswordStored()) return undefined;
  if (!safeStorage.isEncryptionAvailable()) {
    log.warn('[bsx] password file present but safeStorage is unavailable');
    return undefined;
  }
  const blob = fs.readFileSync(passwordFile());
  return safeStorage.decryptString(blob);
}

export interface ResolvedBsxConfig {
  cloudKey: string;
  username: string;
  password: string;
  rawIdstock: number;
  componentIdstock: number;
}

export function resolveBsxConfig(db: Database): ResolvedBsxConfig {
  const settings = db.getSettings().bsx ?? {};
  const cloudKey = settings.cloudKey?.trim();
  const username = settings.username?.trim();
  const password = getPassword();
  if (!cloudKey) throw new Error('BSX cloud key is not configured');
  if (!username) throw new Error('BSX username is not configured');
  if (!password) throw new Error('BSX password is not stored');
  return {
    cloudKey,
    username,
    password,
    rawIdstock: settings.rawIdstock ?? DEFAULT_RAW_IDSTOCK,
    componentIdstock: settings.componentIdstock ?? DEFAULT_COMPONENT_IDSTOCK,
  };
}

// Returns the BSX settings as the renderer should see them: with hasPassword
// derived from the actual encrypted file, never the password itself.
export function exposedBsxSettings(stored: BsxIntegrationSettings | undefined): BsxIntegrationSettings {
  return {
    cloudKey: stored?.cloudKey,
    username: stored?.username,
    rawIdstock: stored?.rawIdstock ?? DEFAULT_RAW_IDSTOCK,
    componentIdstock: stored?.componentIdstock ?? DEFAULT_COMPONENT_IDSTOCK,
    hasPassword: isPasswordStored(),
  };
}
