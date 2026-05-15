import React, { useState } from 'react';
import { useT } from '../i18n';
import { HeaderNav } from '../navigation';
import type { AppSettings, Lang } from '../../shared/types';
import Toggle from '../components/Toggle';
import SearchableSelect from '../components/SearchableSelect';

interface Props {
  settings: AppSettings;
  onChange: (s: AppSettings) => void;
}

const SettingsView: React.FC<Props> = ({ settings, onChange }) => {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const update = async (patch: Partial<AppSettings>) => {
    const next = await window.electronAPI.updateSettings(patch);
    onChange(next);
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
