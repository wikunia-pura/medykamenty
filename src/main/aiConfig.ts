import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { app } from 'electron';
import log from './utils/logger';
import { DEFAULT_AI_MODEL } from '../shared/constants';

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
