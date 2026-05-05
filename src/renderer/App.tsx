import React, { useEffect, useState } from 'react';
import Sidebar from './components/Sidebar';
import UpdateNotification from './components/UpdateNotification';
import { I18nProvider } from './i18n';
import type { Lang, AppSettings } from '../shared/types';
import type { ViewKey } from './views/types';
import Dashboard from './views/Dashboard';
import Products from './views/Products';
import RawMaterials from './views/RawMaterials';
import Components from './views/Components';
import Suppliers from './views/Suppliers';
import StockImport from './views/StockImport';
import ProductionPlanView from './views/ProductionPlan';
import ShortageReportView from './views/ShortageReport';
import EmailGenerator from './views/EmailGenerator';
import CostCalculatorView from './views/CostCalculator';
import MaxProducibleView from './views/MaxProducible';
import Settings from './views/Settings';

const App: React.FC = () => {
  const [view, setView] = useState<ViewKey>('dashboard');
  const [lang, setLangState] = useState<Lang>('pl');
  const [appVersion, setAppVersion] = useState('0.0.0');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [aiAvailable, setAiAvailable] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const s = await window.electronAPI.getSettings();
        setSettings(s);
        setLangState(s.language);
        document.body.classList.toggle('dark-mode', s.darkMode);
      } catch (err) {
        console.error('Failed to load settings', err);
      }
      try {
        const v = await window.electronAPI.getAppVersion();
        setAppVersion(v);
      } catch (err) {
        console.error('Failed to load version', err);
      }
      try {
        const ai = await window.electronAPI.isAiAvailable();
        setAiAvailable(ai.available);
      } catch (err) {
        console.error('Failed to query AI availability', err);
      }
    })();
  }, []);

  const setLang = async (newLang: Lang) => {
    setLangState(newLang);
    if (settings) {
      const updated = await window.electronAPI.updateSettings({ language: newLang });
      setSettings(updated);
    }
  };

  const onSettingsChanged = (s: AppSettings) => {
    setSettings(s);
    document.body.classList.toggle('dark-mode', s.darkMode);
  };

  const renderView = () => {
    if (!settings) return <div className="main">Loading…</div>;
    switch (view) {
      case 'dashboard':
        return <Dashboard onNavigate={setView} aiAvailable={aiAvailable} />;
      case 'products':
        return <Products />;
      case 'rawMaterials':
        return <RawMaterials />;
      case 'components':
        return <Components />;
      case 'suppliers':
        return <Suppliers />;
      case 'stockImport':
        return <StockImport aiAvailable={aiAvailable} useAiByDefault={settings.llm.useByDefault} />;
      case 'productionPlan':
        return <ProductionPlanView />;
      case 'shortageReport':
        return <ShortageReportView />;
      case 'emailGenerator':
        return (
          <EmailGenerator
            defaultLanguage={settings.defaultEmailLanguage}
            aiAvailable={aiAvailable}
            useAiByDefault={settings.llm.useByDefault}
          />
        );
      case 'costCalculator':
        return <CostCalculatorView />;
      case 'maxProducible':
        return <MaxProducibleView />;
      case 'settings':
        return <Settings settings={settings} onChange={onSettingsChanged} aiAvailable={aiAvailable} />;
    }
  };

  return (
    <I18nProvider lang={lang} setLang={setLang}>
      <div className="app">
        <UpdateNotification />
        <div className="app-body">
          <Sidebar current={view} onSelect={setView} appVersion={appVersion} />
          {renderView()}
        </div>
      </div>
    </I18nProvider>
  );
};

export default App;
