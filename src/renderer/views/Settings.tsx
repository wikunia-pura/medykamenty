import React, { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { HeaderNav } from '../navigation';
import type { AppSettings, BsxIntegrationSettings, Lang } from '../../shared/types';
import Toggle from '../components/Toggle';
import SearchableSelect from '../components/SearchableSelect';
import NumberInput from '../components/NumberInput';
import ConfirmDialog from '../components/ConfirmDialog';

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

interface Props {
  settings: AppSettings;
  onChange: (s: AppSettings) => void;
}

const SettingsView: React.FC<Props> = ({ settings, onChange }) => {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Typed locally and saved on blur — a per-keystroke async save would drop
  // characters while typing a whole address.
  const [warehouseEmailDraft, setWarehouseEmailDraft] = useState(settings.warehouseEmail ?? '');

  const update = async (patch: Partial<AppSettings>) => {
    setError(null);
    try {
      const next = await window.electronAPI.updateSettings(patch);
      onChange(next);
    } catch (err) {
      setError(`${t.settingsSaveFailed}: ${errorMessage(err)}`);
    }
  };

  const checkUpdates = async () => {
    setBusy('updates');
    setError(null);
    try {
      const r = await window.electronAPI.checkForUpdates();
      if (r.error) setInfo(`${t.error}: ${r.error}`);
      else setInfo(r.message ?? `${t.appVersion}: ${r.info?.version ?? '?'}`);
    } catch (err) {
      setError(`${t.error}: ${errorMessage(err)}`);
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

      {error && <div className="card error-text">{error}</div>}

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
        <div className="form-row">
          <label>{t.warehouseEmail}</label>
          <div>
            <input
              type="email"
              className="input"
              value={warehouseEmailDraft}
              onChange={(e) => setWarehouseEmailDraft(e.target.value)}
              onBlur={() => {
                const next = warehouseEmailDraft.trim();
                if (next !== (settings.warehouseEmail ?? '')) void update({ warehouseEmail: next });
              }}
            />
            <div className="hint" style={{ marginTop: 4 }}>
              {t.warehouseEmailHint}
            </div>
          </div>
        </div>
      </div>

      <BsxSection
        settings={settings}
        onPatch={async (patch) => {
          // Throws on failure — BsxSection reports it next to the control.
          const next = await window.electronAPI.updateSettings({ bsx: patch });
          onChange(next);
        }}
      />

      <BackupSection />

      <div className="card">
        <h2 style={{ marginTop: 0 }}>{t.about}</h2>
        <div className="btn-row">
          <button className="btn" disabled={busy === 'updates'} onClick={checkUpdates}>
            {t.checkForUpdates}
          </button>
          <button
            className="btn"
            onClick={() =>
              void window.electronAPI
                .openExternal('https://github.com/wikunia-pura/medykamenty')
                .catch((err) => setError(`${t.error}: ${errorMessage(err)}`))
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

interface BackupStatusInfo {
  folder: string;
  lastAutoBackup: string | null;
  autoBackupCount: number;
  offsiteConfigured: boolean;
}

// Full data backup: manual export/import of everything the app persists, plus
// visibility into the daily auto-backup (userData/backups + optional GitHub
// off-site push). Restore in 'replace' mode wipes the shared cloud data for
// every install, hence the double confirmation.
const BackupSection: React.FC = () => {
  const t = useT();
  const [status, setStatus] = useState<BackupStatusInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Restore confirmation in steps: merge asks once, replace asks twice (it
  // wipes the shared cloud data for every install).
  const [confirmStep, setConfirmStep] = useState<'merge' | 'replace1' | 'replace2' | null>(
    null,
  );

  const loadStatus = async () => {
    try {
      setStatus(await window.electronAPI.backupGetStatus());
    } catch {
      setStatus(null);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const handleExport = async () => {
    setBusy(true);
    setMessage(null);
    try {
      // ok:false without a path is the user cancelling the save dialog.
      const r = await window.electronAPI.exportBackup();
      if (r.ok && r.path) setMessage(t.backupExported.replace('{path}', r.path));
    } catch (err) {
      setMessage(`${t.backupError}: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async (mode: 'merge' | 'replace') => {
    setConfirmStep(null);
    setBusy(true);
    setMessage(null);
    try {
      const r = await window.electronAPI.importBackup(mode);
      if (r.ok) {
        setMessage(t.backupImported.replace('{applied}', String(r.applied ?? 0)));
        await loadStatus();
      } else if (r.error) {
        setMessage(`${t.backupError}: ${r.error}`);
      }
    } catch (error) {
      setMessage(`${t.backupError}: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>{t.settingsBackup}</h2>
      <div className="hint">
        {status?.lastAutoBackup
          ? t.backupStatusLine
              .replace('{date}', status.lastAutoBackup)
              .replace('{count}', String(status.autoBackupCount))
          : t.backupStatusNone}
      </div>
      <div className="hint" style={{ marginTop: 4 }}>
        {status?.offsiteConfigured ? t.backupOffsiteOn : t.backupOffsiteOff}
      </div>
      <div className="btn-row" style={{ marginTop: 12 }}>
        <button className="btn" disabled={busy} onClick={handleExport}>
          {t.exportData}
        </button>
        <button className="btn" disabled={busy} onClick={() => setConfirmStep('merge')}>
          {t.importDataMerge}
        </button>
        <button
          className="btn soft-danger"
          disabled={busy}
          onClick={() => setConfirmStep('replace1')}
        >
          {t.importDataReplace}
        </button>
        <button
          className="btn"
          onClick={() =>
            void window.electronAPI
              .backupOpenFolder()
              .catch((err) => setMessage(`${t.backupError}: ${errorMessage(err)}`))
          }
        >
          {t.backupOpenFolder}
        </button>
      </div>
      {message && (
        <div className="hint" style={{ marginTop: 8 }}>
          {message}
        </div>
      )}
      {confirmStep === 'merge' && (
        <ConfirmDialog
          message={t.backupImportConfirmMerge}
          onConfirm={() => void handleImport('merge')}
          onCancel={() => setConfirmStep(null)}
        />
      )}
      {confirmStep === 'replace1' && (
        <ConfirmDialog
          danger
          message={t.backupImportConfirmReplace1}
          onConfirm={() => setConfirmStep('replace2')}
          onCancel={() => setConfirmStep(null)}
        />
      )}
      {confirmStep === 'replace2' && (
        <ConfirmDialog
          danger
          message={t.backupImportConfirmReplace2}
          onConfirm={() => void handleImport('replace')}
          onCancel={() => setConfirmStep(null)}
        />
      )}
    </div>
  );
};

interface BsxSectionProps {
  settings: AppSettings;
  onPatch: (patch: Partial<BsxIntegrationSettings>) => Promise<void>;
}

interface BsxWarehouse {
  id: number;
  title: string;
  symbol?: string;
  ownerName?: string;
}

const BsxSection: React.FC<BsxSectionProps> = ({ settings, onPatch }) => {
  const t = useT();
  const bsx = settings.bsx ?? {};
  const [password, setPassword] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [warehouses, setWarehouses] = useState<BsxWarehouse[] | null>(null);
  const [warehousesBusy, setWarehousesBusy] = useState(false);
  const [warehousesError, setWarehousesError] = useState<string | null>(null);
  // Failed save of a BSX field or of the password.
  const [saveError, setSaveError] = useState<string | null>(null);

  const saveField = (field: keyof BsxIntegrationSettings, value: string | number | undefined) => {
    setSaveError(null);
    void onPatch({ [field]: value } as Partial<BsxIntegrationSettings>).catch((err) =>
      setSaveError(`${t.settingsSaveFailed}: ${errorMessage(err)}`),
    );
  };

  const savePassword = async () => {
    if (!password) return;
    setPwBusy(true);
    setSaveError(null);
    try {
      await window.electronAPI.setBsxPassword(password);
      setPassword('');
      // Refresh settings so hasPassword updates without a manual reload.
      await onPatch({});
    } catch (err) {
      setSaveError(`${t.settingsSaveFailed}: ${errorMessage(err)}`);
    } finally {
      setPwBusy(false);
    }
  };

  const clearPassword = async () => {
    setPwBusy(true);
    setSaveError(null);
    try {
      await window.electronAPI.clearBsxPassword();
      await onPatch({});
    } catch (err) {
      setSaveError(`${t.settingsSaveFailed}: ${errorMessage(err)}`);
    } finally {
      setPwBusy(false);
    }
  };

  const test = async () => {
    setTestBusy(true);
    setTestResult(null);
    try {
      const r = await window.electronAPI.testBsxConnection();
      if (r.ok) setTestResult({ ok: true, message: t.bsxConnectionOk });
      else setTestResult({ ok: false, message: `${t.bsxConnectionFailed}: ${r.error}` });
    } catch (err) {
      setTestResult({ ok: false, message: `${t.bsxConnectionFailed}: ${errorMessage(err)}` });
    } finally {
      setTestBusy(false);
    }
  };

  const loadWarehouses = async () => {
    setWarehousesBusy(true);
    setWarehousesError(null);
    try {
      const r = await window.electronAPI.listBsxWarehouses();
      if (r.ok) setWarehouses(r.warehouses);
      else {
        setWarehouses(null);
        setWarehousesError(r.error);
      }
    } catch (err) {
      setWarehouses(null);
      setWarehousesError(errorMessage(err));
    } finally {
      setWarehousesBusy(false);
    }
  };

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>{t.bsxIntegration}</h2>
      {saveError && (
        <div className="error-text" style={{ marginBottom: 8 }}>
          {saveError}
        </div>
      )}
      <div className="form-row">
        <label>{t.bsxCloudKey}</label>
        <input
          className="input"
          value={bsx.cloudKey ?? ''}
          onChange={(e) => saveField('cloudKey', e.target.value || undefined)}
          placeholder="CL-XXXXXXXXXX"
        />
      </div>
      <div className="form-row">
        <label>{t.bsxUsername}</label>
        <input
          className="input"
          value={bsx.username ?? ''}
          onChange={(e) => saveField('username', e.target.value || undefined)}
          placeholder="user@example.com"
        />
      </div>
      <div className="form-row">
        <label>{t.bsxPassword}</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={bsx.hasPassword ? '••••••••' : ''}
            style={{ flex: 1 }}
          />
          <button className="btn" disabled={pwBusy || !password} onClick={savePassword}>
            {t.bsxSetPassword}
          </button>
          {bsx.hasPassword && (
            <button className="btn soft-danger" disabled={pwBusy} onClick={clearPassword}>
              {t.bsxClearPassword}
            </button>
          )}
        </div>
        <div className="hint" style={{ marginTop: 4 }}>
          {bsx.hasPassword ? t.bsxPasswordStored : t.bsxPasswordNotStored}
        </div>
      </div>
      <div className="form-row">
        <label>{t.bsxRawIdstock}</label>
        <NumberInput
          className="input"
          value={bsx.rawIdstock}
          onChange={(v) => saveField('rawIdstock', v ?? undefined)}
        />
      </div>
      <div className="form-row">
        <label>{t.bsxComponentIdstock}</label>
        <NumberInput
          className="input"
          value={bsx.componentIdstock}
          onChange={(v) => saveField('componentIdstock', v ?? undefined)}
        />
      </div>

      <div style={{ marginTop: 4 }}>
        <button className="btn" disabled={warehousesBusy} onClick={loadWarehouses}>
          {warehousesBusy ? '…' : t.bsxShowWarehouses}
        </button>
        {warehousesError && (
          <span className="tag danger" style={{ marginLeft: 8 }}>
            {warehousesError}
          </span>
        )}
        {warehouses && (
          <>
            <div className="hint" style={{ marginTop: 8 }}>
              {t.bsxWarehousesHint}
            </div>
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th className="col-w-sm num">ID</th>
                    <th>{t.name}</th>
                  </tr>
                </thead>
                <tbody>
                  {warehouses.length === 0 && (
                    <tr>
                      <td colSpan={2} className="hint">—</td>
                    </tr>
                  )}
                  {warehouses.map((w) => (
                    <tr key={w.id}>
                      <td className="num">{w.id}</td>
                      <td>{w.title}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="btn-row" style={{ marginTop: 12 }}>
        <button className="btn" disabled={testBusy} onClick={test}>
          {testBusy ? '…' : t.bsxTestConnection}
        </button>
        {testResult && (
          <span className={testResult.ok ? 'tag success' : 'tag danger'}>
            {testResult.message}
          </span>
        )}
      </div>
    </div>
  );
};

export default SettingsView;
