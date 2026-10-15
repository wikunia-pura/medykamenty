import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { app } from 'electron';
import log from './utils/logger';
import type Database from './database';
import { DEFAULT_AI_MODEL } from '../shared/constants';

// Where the Anthropic key comes from. The release binaries are publicly
// downloadable, so no key is bundled into them: production reads it at runtime
// from the Supabase `app_config` table (readable only by signed-in users). A
// local config/ai-config.yml or ANTHROPIC_API_KEY is a developer override and
// always wins over the cloud key.

interface AiConfigFile {
  ai?: {
    anthropic_api_key?: string;
    model?: string;
    default_provider?: string;
  };
}

interface ResolvedAiConfig {
  available: boolean;
  apiKey?: string;
  model: string;
}

let cached: ResolvedAiConfig | null = null;

function candidatePaths(): string[] {
  const paths: string[] = [];
  if (app.isPackaged) {
    paths.push(path.join(process.resourcesPath, 'ai-config.yml'));
  }
  paths.push(path.join(__dirname, '..', '..', 'config', 'ai-config.yml'));
  paths.push(path.join(process.cwd(), 'config', 'ai-config.yml'));
  return paths;
}

export function loadAiConfig(): ResolvedAiConfig {
  if (cached) return cached;

  for (const p of candidatePaths()) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, 'utf-8');
      const parsed = yaml.load(raw) as AiConfigFile | null;
      const apiKey = parsed?.ai?.anthropic_api_key?.trim();
      const model = parsed?.ai?.model?.trim() || DEFAULT_AI_MODEL;
      if (apiKey && apiKey.length > 0) {
        log.info(`[aiConfig] loaded from ${p}, model=${model}`);
        cached = { available: true, apiKey, model };
        return cached;
      }
      log.info(`[aiConfig] file ${p} found but key empty`);
    } catch (err) {
      log.warn(`[aiConfig] failed to read ${p}:`, err);
    }
  }

  const envKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (envKey) {
    log.info('[aiConfig] using ANTHROPIC_API_KEY from environment');
    cached = { available: true, apiKey: envKey, model: DEFAULT_AI_MODEL };
    return cached;
  }

  log.info('[aiConfig] no key found — AI features disabled');
  cached = { available: false, model: DEFAULT_AI_MODEL };
  return cached;
}

export function isAiAvailable(): boolean {
  return loadAiConfig().available;
}

export function getApiKey(): string | undefined {
  return loadAiConfig().apiKey;
}

export function getModel(): string {
  return loadAiConfig().model;
}

let cloudFetch: Promise<void> | null = null;

/**
 * Fetch the Anthropic key from the shared `app_config` table unless a key is
 * already loaded. Needs a signed-in Supabase session; a failure is logged and
 * not remembered, so the next call retries. Concurrent callers share one fetch.
 */
export function loadCloudAiKey(db: Database): Promise<void> {
  if (isAiAvailable()) return Promise.resolve();
  if (!cloudFetch) {
    cloudFetch = (async () => {
      try {
        const key = (await db.getAppConfigValue('anthropic_api_key'))?.trim();
        if (!key) {
          log.warn('[aiConfig] no anthropic_api_key row in app_config — AI features disabled');
          return;
        }
        if (isAiAvailable()) return; // a local override appeared meanwhile
        cached = { available: true, apiKey: key, model: getModel() };
        log.info('[aiConfig] Anthropic key loaded from Supabase app_config');
      } catch (err) {
        log.warn(
          `[aiConfig] cloud key fetch failed: ${err instanceof Error ? err.message : err}`,
        );
      } finally {
        cloudFetch = null;
      }
    })();
  }
  return cloudFetch;
}
