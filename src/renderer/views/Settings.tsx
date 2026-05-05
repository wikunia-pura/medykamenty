import React, { useState } from 'react';
import { useT } from '../i18n';
import type { AppSettings, Lang } from '../../shared/types';

interface Props {
  settings: AppSettings;
  onChange: (s: AppSettings) => void;
  aiAvailable: boolean;
}

const SettingsView: React.FC<Props> = ({ settings, onChange, aiAvailable }) => {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const update = async (patch: Partial<AppSettings>) => {
    const next = await window.electronAPI.updateSettings(patch);
    onChange(next);
  };

  const exportData = async () => {
    setBusy('export');
    setInfo(null);
    try {
      const r = await window.electronAPI.exportBackup();
      if (r.ok && r.path) setInfo(`${t.exportData}: ${r.path}`);
    } finally {
      setBusy(null);
    }
  };

  const importData = async (mode: 'merge' | 'replace') => {
    setBusy(`import-${mode}`);
    setInfo(null);
    try {
      const r = await window.electronAPI.importBackup(mode);
      if (r.ok) setInfo(`${t.importData}: ${r.applied ?? 0}`);
    } finally {
      setBusy(null);
    }
  };

  const checkUpdates = async () => {
    setBusy('updates');
    try {
      const r = await window.electronAPI.checkForUpdates();
      if (r.error) setInfo(`${t.error}: ${r.error}`);
      else setInfo(r.message ?? `${t.appVersion}: ${r.info?.version ?? '?'}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="main">
      <h1>{t.settings}</h1>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>{t.appName}</h2>
        <div className="form-row">
          <label>{t.settingsLanguage}</label>
          <select
            value={settings.language}
            onChange={(e) => update({ language: e.target.value as Lang })}
          >
            <option value="pl">Polski</option>
            <option value="en">English</option>
          </select>
        </div>
        <div className="form-row">
          <label>{t.settingsDarkMode}</label>
          <input
            type="checkbox"
            checked={settings.darkMode}
            onChange={(e) => update({ darkMode: e.target.checked })}
          />
        </div>
        <div className="form-row">
          <label>{t.settingsWasteFactor}</label>
          <input
            className="input"
            type="number"
            step="0.01"
            value={settings.wasteFactor}
            onChange={(e) => update({ wasteFactor: Number(e.target.value) || 1 })}
          />
        </div>
        <div className="form-row">
          <label>{t.settingsDefaultCurrency}</label>
          <input
            className="input"
            value={settings.defaultCurrency}
            onChange={(e) => update({ defaultCurrency: e.target.value })}
          />
        </div>
        <div className="form-row">
          <label>{t.settingsDefaultEmailLanguage}</label>
          <select
            value={settings.defaultEmailLanguage}
            onChange={(e) => update({ defaultEmailLanguage: e.target.value as Lang })}
          >
            <option value="pl">PL</option>
            <option value="en">EN</option>
          </select>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>{t.settingsLLM}</h2>
        <div>
          {t.settingsLLMStatus}:{' '}
          {aiAvailable ? (
            <span className="tag success">available</span>
          ) : (
            <span className="tag">unavailable — {t.aiUnavailable}</span>
          )}
        </div>
        <div className="form-row">
          <label>{t.settingsLLMDefault}</label>
          <input
            type="checkbox"
            checked={settings.llm.useByDefault}
            disabled={!aiAvailable}
            onChange={(e) => update({ llm: { useByDefault: e.target.checked } })}
          />
        </div>
        <div className="hint">
          Klucz API jest wstrzykiwany do paczki w trakcie buildu (GitHub Actions). Aby zmienić klucz —
          zaktualizuj sekret <code>ANTHROPIC_API_KEY</code> w repozytorium i wypuść nową wersję.
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>{t.settingsBackup}</h2>
        <div className="btn-row">
          <button className="btn" disabled={busy === 'export'} onClick={exportData}>
            {t.exportData}
          </button>
          <button
            className="btn"
            disabled={busy === 'import-merge'}
            onClick={() => importData('merge')}
          >
            {t.importDataMerge}
          </button>
          <button
            className="btn danger"
            disabled={busy === 'import-replace'}
            onClick={() => importData('replace')}
          >
            {t.importDataReplace}
          </button>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>{t.about}</h2>
        <div className="btn-row">
          <button className="btn" disabled={busy === 'updates'} onClick={checkUpdates}>
            {t.checkForUpdates}
          </button>
          <button
            className="btn"
            onClick={() =>
              window.electronAPI.openExternal('https://github.com/wikunia-pura/medykamenty')
            }
          >
            GitHub
          </button>
        </div>
      </div>

      {info && <div className="card hint">{info}</div>}
    </div>
  );
};

export default SettingsView;
