import React, { useState } from 'react';
import { useT } from '../i18n';
import { HeaderNav } from '../navigation';
import type { AppSettings, Lang } from '../../shared/types';
import Toggle from '../components/Toggle';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingOverlay from '../components/LoadingOverlay';
import SearchableSelect from '../components/SearchableSelect';
import NumberInput from '../components/NumberInput';

interface Props {
  settings: AppSettings;
  onChange: (s: AppSettings) => void;
  aiAvailable: boolean;
}

const SettingsView: React.FC<Props> = ({ settings, onChange, aiAvailable }) => {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [loaderMessage, setLoaderMessage] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [wipeMessage, setWipeMessage] = useState<string | null>(null);
  const [confirmDemo, setConfirmDemo] = useState(false);
  const [demoMessage, setDemoMessage] = useState<string | null>(null);

  const update = async (patch: Partial<AppSettings>) => {
    const next = await window.electronAPI.updateSettings(patch);
    onChange(next);
  };

  const exportData = async () => {
    setBusy('export');
    setLoaderMessage(t.loaderExporting);
    setInfo(null);
    try {
      const r = await window.electronAPI.exportBackup();
      if (r.ok && r.path) setInfo(`${t.exportData}: ${r.path}`);
    } finally {
      setBusy(null);
      setLoaderMessage(null);
    }
  };

  const importData = async (mode: 'merge' | 'replace') => {
    setBusy(`import-${mode}`);
    setLoaderMessage(t.loaderImporting);
    setInfo(null);
    try {
      const r = await window.electronAPI.importBackup(mode);
      if (r.ok) setInfo(`${t.importData}: ${r.applied ?? 0}`);
    } finally {
      setBusy(null);
      setLoaderMessage(null);
    }
  };

  const runDemo = async () => {
    setConfirmDemo(false);
    setBusy('demo');
    setLoaderMessage(t.loaderSeeding);
    setDemoMessage(null);
    try {
      await window.electronAPI.seedDemo();
      setDemoMessage(t.loadDemoSuccess);
    } catch (err) {
      setDemoMessage((err as Error).message);
    } finally {
      setBusy(null);
      setLoaderMessage(null);
    }
  };

  const runWipe = async () => {
    setConfirmWipe(false);
    setBusy('wipe');
    setLoaderMessage(t.loaderWiping);
    setWipeMessage(null);
    try {
      await window.electronAPI.wipeData();
      setWipeMessage(t.wipeDataSuccess);
    } catch (err) {
      setWipeMessage((err as Error).message);
    } finally {
      setBusy(null);
      setLoaderMessage(null);
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
      <div className="page-header">
        <HeaderNav />
        <h1>{t.settings}</h1>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>{t.appName}</h2>
        <div className="form-row">
          <label>{t.settingsLanguage}</label>
          <SearchableSelect
            options={[
              { value: 'pl', label: 'Polski' },
              { value: 'en', label: 'English' },
            ]}
            value={settings.language}
            onChange={(val) => update({ language: val as Lang })}
          />
        </div>
        <div className="form-row">
          <label>{t.settingsDarkMode}</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 6 }}>
            <Toggle
              checked={settings.darkMode}
              onChange={(v) => update({ darkMode: v })}
              ariaLabel={t.settingsDarkMode}
            />
            <span className="hint">{settings.darkMode ? t.settingsDarkMode : t.settingsLightMode}</span>
          </div>
        </div>
        <div className="form-row">
          <label>{t.settingsWasteFactor}</label>
          <NumberInput
            className="input"
            step="0.01"
            value={settings.wasteFactor}
            emptyValue={1}
            onChange={(v) => update({ wasteFactor: v ?? 1 })}
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
          <SearchableSelect
            options={[
              { value: 'pl', label: 'PL' },
              { value: 'en', label: 'EN' },
            ]}
            value={settings.defaultEmailLanguage}
            onChange={(val) => update({ defaultEmailLanguage: val as Lang })}
          />
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
          <div style={{ paddingTop: 6 }}>
            <Toggle
              checked={settings.llm.useByDefault}
              disabled={!aiAvailable}
              onChange={(v) => update({ llm: { useByDefault: v } })}
              ariaLabel={t.settingsLLMDefault}
            />
          </div>
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
        <h2 style={{ marginTop: 0 }}>{t.loadDemoTitle}</h2>
        <div className="hint" style={{ marginBottom: 12 }}>{t.loadDemoBody}</div>
        <div className="btn-row">
          <button
            className="btn"
            disabled={busy === 'demo'}
            onClick={() => setConfirmDemo(true)}
          >
            {busy === 'demo' ? t.loading : t.loadDemoButton}
          </button>
        </div>
        {demoMessage && (
          <div className="hint" style={{ marginTop: 12 }}>
            {demoMessage}
          </div>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>{t.wipeDataTitle}</h2>
        <div className="hint" style={{ marginBottom: 12 }}>{t.wipeDataBody}</div>
        <div className="btn-row">
          <button
            className="btn danger"
            disabled={busy === 'wipe'}
            onClick={() => setConfirmWipe(true)}
          >
            {busy === 'wipe' ? t.loading : t.wipeDataButton}
          </button>
        </div>
        {wipeMessage && (
          <div className="hint" style={{ marginTop: 12 }}>
            {wipeMessage}
          </div>
        )}
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

      {confirmWipe && (
        <ConfirmDialog
          message={t.wipeDataConfirm}
          onConfirm={runWipe}
          onCancel={() => setConfirmWipe(false)}
          danger
        />
      )}

      {confirmDemo && (
        <ConfirmDialog
          message={t.loadDemoConfirm}
          onConfirm={runDemo}
          onCancel={() => setConfirmDemo(false)}
          danger
        />
      )}

      {loaderMessage && <LoadingOverlay message={loaderMessage} />}
    </div>
  );
};

export default SettingsView;
