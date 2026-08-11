import React, { useEffect, useState } from 'react';
import Sidebar from './components/Sidebar';
import Footer from './components/Footer';
import UpdateNotification from './components/UpdateNotification';
import BackupNotifier from './components/BackupNotifier';
import ExistingBatchChooser from './components/ExistingBatchChooser';
import { I18nProvider } from './i18n';
import { NavigationProvider } from './navigation';
import type { EmailBatch, Lang, AppSettings, TaskStatus } from '../shared/types';
import type { ViewKey } from './views/types';
import Dashboard from './views/Dashboard';
import Products from './views/Products';
import RawMaterials from './views/RawMaterials';
import Components from './views/Components';
import Suppliers from './views/Suppliers';
import StockImport from './views/StockImport';
import ProductionPlanView from './views/ProductionPlan';
import ShortageReportView, { resetShortageReportFocus } from './views/ShortageReport';
import EmailGenerator, { resetEmailGeneratorFocus } from './views/EmailGenerator';
import CostCalculatorView from './views/CostCalculator';
import MaxProducibleView from './views/MaxProducible';
import Settings from './views/Settings';
import Login from './views/Login';
import Orders from './views/Orders';
import OrderDetails from './views/OrderDetails';
import WorkflowTemplates from './views/WorkflowTemplates';
import OrderTaskBanner from './components/OrderTaskBanner';

const NAV_STACK_LIMIT = 50;

interface NavState {
  stack: ViewKey[];
  index: number;
}

const App: React.FC = () => {
  const [nav, setNav] = useState<NavState>({ stack: ['dashboard'], index: 0 });
  const view = nav.stack[nav.index];
  const canGoBack = nav.index > 0;
  const canGoForward = nav.index < nav.stack.length - 1;
  const [sidebarTick, setSidebarTick] = useState(0);

  const pushView = (next: ViewKey) => {
    setNav((prev) => {
      if (prev.stack[prev.index] === next) return prev;
      const truncated = prev.stack.slice(0, prev.index + 1);
      const stack = [...truncated, next];
      if (stack.length > NAV_STACK_LIMIT) {
        const trimmed = stack.slice(stack.length - NAV_STACK_LIMIT);
        return { stack: trimmed, index: trimmed.length - 1 };
      }
      return { stack, index: stack.length - 1 };
    });
  };

  const setView = (next: ViewKey) => {
    setNav((prev) => {
      if (prev.stack[prev.index] === next) return prev;
      // If the caller is navigating to the entry directly before the current
      // one, treat it as Back: decrement the index instead of pushing a
      // duplicate. This makes hardcoded "back to parent" buttons (e.g.
      // OrderDetails → Orders, task screen → OrderDetails) preserve forward
      // history and avoid stacking duplicates.
      if (prev.index > 0 && prev.stack[prev.index - 1] === next) {
        return { ...prev, index: prev.index - 1 };
      }
      const truncated = prev.stack.slice(0, prev.index + 1);
      const stack = [...truncated, next];
      if (stack.length > NAV_STACK_LIMIT) {
        const trimmed = stack.slice(stack.length - NAV_STACK_LIMIT);
        return { stack: trimmed, index: trimmed.length - 1 };
      }
      return { stack, index: stack.length - 1 };
    });
  };

  const handleSidebarSelect = (next: ViewKey) => {
    resetShortageReportFocus();
    resetEmailGeneratorFocus();
    setOrderTaskCtx(null);
    setFocusReportId('');
    setFocusBatchId('');
    setSidebarTick((n) => n + 1);
    pushView(next);
  };

  const goBack = () =>
    setNav((prev) => (prev.index > 0 ? { ...prev, index: prev.index - 1 } : prev));
  const goForward = () =>
    setNav((prev) =>
      prev.index < prev.stack.length - 1 ? { ...prev, index: prev.index + 1 } : prev,
    );

  const [lang, setLangState] = useState<Lang>('pl');
  const [appVersion, setAppVersion] = useState('0.0.0');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [selectedReportId, setSelectedReportId] = useState<string>('');
  const [autoGenerateEmails, setAutoGenerateEmails] = useState(false);
  const [editPlanId, setEditPlanId] = useState<string>('');
  const [planSearchQuery, setPlanSearchQuery] = useState<string>('');
  const [focusReportId, setFocusReportId] = useState<string>('');
  const [focusBatchId, setFocusBatchId] = useState<string>('');
  const [selectedOrderId, setSelectedOrderId] = useState<string>('');
  // Active workflow-task context. When set, the user navigated to a screen
  // (stockImport/shortageReport/emailGenerator) from a workflow task and the
  // top banner offers a way back to the order + a one-click "mark done".
  const [orderTaskCtx, setOrderTaskCtx] = useState<{
    orderId: string;
    taskId: string;
    orderName: string;
    taskStatus: TaskStatus;
  } | null>(null);
  const [session, setSession] = useState<{ email: string; userId: string } | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [migrationInfo, setMigrationInfo] = useState<{
    hasLocalData: boolean;
    migrated: boolean;
  } | null>(null);
  // Pre-navigation chooser: when the user requests email generation for a
  // report that already has 1+ batches, we hold the matches here and let the
  // user decide before moving them off the current view.
  const [pendingEmailChooser, setPendingEmailChooser] = useState<{
    reportId: string;
    batches: EmailBatch[];
  } | null>(null);

  const handleSignedIn = async () => {
    const s = await window.electronAPI.authGetSession();
    setSession(s);
  };

  const handleSignOut = async () => {
    await window.electronAPI.authSignOut();
    setSession(null);
  };

  const handleRunMigration = async () => {
    if (!migrationInfo) return;
    const result = await window.electronAPI.migrationRun();
    if (result.ok) {
      alert(
        `Przeniesiono do chmury:\n` +
          `• Dostawcy: ${result.counts.suppliers}\n` +
          `• Surowce: ${result.counts.rawMaterials}\n` +
          `• Komponenty: ${result.counts.components}\n` +
          `• Produkty: ${result.counts.products}\n` +
          `• Plany: ${result.counts.productionPlans}\n` +
          `• Snapshoty: ${result.counts.stockSnapshots}\n` +
          `• Raporty: ${result.counts.shortageReports}\n` +
          `• Maile RFQ: ${result.counts.emailBatches}`,
      );
      const fresh = await window.electronAPI.migrationGetStatus();
      setMigrationInfo({ hasLocalData: fresh.hasLocalData, migrated: fresh.migrated });
    } else {
      alert(`Błąd migracji:\n${result.error}`);
    }
  };

  // Actually leave the current view and (re)generate fresh emails for the
  // given report. Used both for the no-existing-batches path and for the
  // "Generate new" action inside the chooser.
  const proceedToGenerateEmails = (reportId: string) => {
    if (reportId) setSelectedReportId(reportId);
    setAutoGenerateEmails(true);
    setView('emailGenerator');
  };

  const navigateToEmails = async (reportId: string) => {
    if (!reportId) {
      proceedToGenerateEmails(reportId);
      return;
    }
    try {
      const all = await window.electronAPI.listEmailBatches();
      const existing = all
        .filter((b) => b.reportId === reportId)
        .sort(
          (a, b) =>
            new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime(),
        );
      if (existing.length > 0) {
        // Don't navigate — wait for the user to pick an option in the modal.
        setPendingEmailChooser({ reportId, batches: existing });
        return;
      }
    } catch (err) {
      console.error('Failed to check existing email batches', err);
      // Fall through to the default generate flow on error.
    }
    proceedToGenerateEmails(reportId);
  };

  const navigateToReport = (planId: string, reportId: string) => {
    if (planId) setSelectedPlanId(planId);
    setFocusReportId(reportId);
    setView('shortageReport');
  };

  const navigateToBatch = (batchId: string) => {
    setFocusBatchId(batchId);
    setView('emailGenerator');
  };

  const openOrder = (id: string) => {
    setSelectedOrderId(id);
    setOrderTaskCtx(null);
    setView('orderDetails');
  };

  const navigateForTask = async (
    target: 'stockImport' | 'shortageReport' | 'emailGenerator',
    orderId: string,
    taskId: string,
    extras?: { focusReportId?: string; focusBatchId?: string; planId?: string },
  ) => {
    let orderName = '';
    let taskStatus: TaskStatus = 'in_progress';
    try {
      const o = await window.electronAPI.getOrder(orderId);
      orderName = o?.name ?? '';
      const tk = o?.workflow?.tasks.find((task) => task.id === taskId);
      if (tk) taskStatus = tk.status;
    } catch {
      /* ignore — banner still renders, just without the name */
    }
    setSelectedOrderId(orderId);
    setOrderTaskCtx({ orderId, taskId, orderName, taskStatus });
    if (extras?.planId) setSelectedPlanId(extras.planId);
    if (extras?.focusReportId) setFocusReportId(extras.focusReportId);
    if (extras?.focusBatchId) setFocusBatchId(extras.focusBatchId);
    setView(target);
  };

  const markTaskDoneAndReturn = async () => {
    if (!orderTaskCtx) return;
    try {
      await window.electronAPI.updateOrderTask(orderTaskCtx.orderId, orderTaskCtx.taskId, {
        status: 'done',
      });
    } catch (err) {
      console.error('Failed to mark task done', err);
    }
    setOrderTaskCtx(null);
    setView('orderDetails');
  };

  const reopenTaskAndStay = async () => {
    if (!orderTaskCtx) return;
    try {
      await window.electronAPI.updateOrderTask(orderTaskCtx.orderId, orderTaskCtx.taskId, {
        status: 'in_progress',
      });
      setOrderTaskCtx({ ...orderTaskCtx, taskStatus: 'in_progress' });
    } catch (err) {
      console.error('Failed to reopen task', err);
    }
  };

  const backToOrderFromTask = () => {
    setOrderTaskCtx(null);
    setView('orderDetails');
  };

  // Clear the workflow-task banner whenever the user navigates away from the
  // three special-task screens. Without this, history nav (Alt+←/→), row
  // clicks, or any path that bypasses the banner's "back" button would leave
  // orderTaskCtx stuck, and the banner would re-appear on the next visit to
  // a task screen even though the user didn't actually click a task.
  useEffect(() => {
    if (
      view !== 'stockImport' &&
      view !== 'shortageReport' &&
      view !== 'emailGenerator'
    ) {
      setOrderTaskCtx(null);
    }
  }, [view]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return;
      }
      if (!ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
      if (ev.key === 'ArrowLeft') {
        ev.preventDefault();
        goBack();
      } else if (ev.key === 'ArrowRight') {
        ev.preventDefault();
        goForward();
      }
    };
    const onMouseDown = (ev: MouseEvent) => {
      if (ev.button === 3) {
        ev.preventDefault();
        goBack();
      } else if (ev.button === 4) {
        ev.preventDefault();
        goForward();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onMouseDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onMouseDown);
    };
  }, []);

  // Load local settings (dark mode, language) + version immediately so the
  // login screen respects them — these don't require a session.
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
        const s = await window.electronAPI.authGetSession();
        setSession(s);
      } finally {
        setSessionChecked(true);
      }
    })();
  }, []);

  // After signing in, fetch AI availability + migration status (these need DB / auth).
  useEffect(() => {
    if (!session) return;
    void (async () => {
      try {
        const ai = await window.electronAPI.isAiAvailable();
        setAiAvailable(ai.available);
      } catch (err) {
        console.error('Failed to query AI availability', err);
      }
      try {
        const m = await window.electronAPI.migrationGetStatus();
        setMigrationInfo({ hasLocalData: m.hasLocalData, migrated: m.migrated });
      } catch (err) {
        console.error('Failed to query migration status', err);
      }
    })();
  }, [session]);

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
    const taskBanner =
      orderTaskCtx &&
      (view === 'stockImport' ||
        view === 'shortageReport' ||
        view === 'emailGenerator') ? (
        <OrderTaskBanner
          orderName={orderTaskCtx.orderName}
          taskStatus={orderTaskCtx.taskStatus}
          onBackToOrder={backToOrderFromTask}
          onMarkDone={markTaskDoneAndReturn}
          onReopen={reopenTaskAndStay}
        />
      ) : null;
    switch (view) {
      case 'dashboard':
        return (
          <Dashboard
            key={`dashboard-${sidebarTick}`}
            onNavigate={setView}
            onNavigateToReport={navigateToReport}
            onOpenOrder={openOrder}
            onNavigateForTask={navigateForTask}
          />
        );
      case 'products':
        return <Products />;
      case 'rawMaterials':
        return <RawMaterials />;
      case 'components':
        return <Components key="components" kind="primary" />;
      case 'outerPackaging':
        return <Components key="outerPackaging" kind="secondary" />;
      case 'suppliers':
        return <Suppliers />;
      case 'stockImport':
        return <StockImport onNavigate={setView} taskBanner={taskBanner} />;
      case 'orders':
        return (
          <Orders onOpenOrder={openOrder} onNavigateForTask={navigateForTask} />
        );
      case 'orderDetails':
        return selectedOrderId ? (
          <OrderDetails
            key={`order-${selectedOrderId}`}
            orderId={selectedOrderId}
            onBack={() => (canGoBack ? goBack() : setView('orders'))}
            onNavigateToReport={navigateToReport}
            onNavigateToEmails={navigateToEmails}
            onNavigateToBatch={navigateToBatch}
            onNavigateForTask={navigateForTask}
          />
        ) : (
          <Orders onOpenOrder={openOrder} onNavigateForTask={navigateForTask} />
        );
      case 'workflowTemplates':
        return <WorkflowTemplates />;
      case 'productionPlan':
        return (
          <ProductionPlanView
            editPlanId={editPlanId}
            onEditPlanIdConsumed={() => setEditPlanId('')}
            initialSearch={planSearchQuery}
            onInitialSearchConsumed={() => setPlanSearchQuery('')}
            onNavigateToReport={navigateToReport}
            onNavigateToBatch={navigateToBatch}
            onNavigate={setView}
          />
        );
      case 'shortageReport':
        return (
          <ShortageReportView
            key={`shortageReport-${sidebarTick}`}
            selectedPlanId={selectedPlanId}
            onSelectPlan={setSelectedPlanId}
            onNavigate={setView}
            onNavigateToEmails={navigateToEmails}
            focusReportId={focusReportId}
            onFocusReportConsumed={() => setFocusReportId('')}
            orderTaskContextOrderId={orderTaskCtx?.orderId}
            onNavigateToOrder={openOrder}
            taskBanner={taskBanner}
          />
        );
      case 'emailGenerator':
        return (
          <EmailGenerator
            key={`emailGenerator-${sidebarTick}`}
            defaultLanguage={settings.defaultEmailLanguage}
            aiAvailable={aiAvailable}
            useAiByDefault={aiAvailable}
            selectedReportId={selectedReportId}
            onSelectReport={setSelectedReportId}
            autoGenerate={autoGenerateEmails}
            onAutoGenerateConsumed={() => setAutoGenerateEmails(false)}
            onNavigate={setView}
            onNavigateToReport={navigateToReport}
            focusBatchId={focusBatchId}
            onFocusBatchConsumed={() => setFocusBatchId('')}
            taskBanner={taskBanner}
          />
        );
      case 'costCalculator':
        return <CostCalculatorView onNavigate={setView} />;
      case 'maxProducible':
        return <MaxProducibleView />;
      case 'settings':
        return <Settings settings={settings} onChange={onSettingsChanged} />;
    }
  };

  if (!sessionChecked) {
    return <div className="app" />;
  }

  if (!session) {
    return (
      <I18nProvider lang={lang} setLang={setLang}>
        <div className="app">
          {/* Also on the login screen: without a session the exit backup is the
              one that fails, and that warning must not be swallowed. */}
          <BackupNotifier />
          <Login onSignedIn={handleSignedIn} />
        </div>
      </I18nProvider>
    );
  }

  return (
    <I18nProvider lang={lang} setLang={setLang}>
      <div className="app">
        <UpdateNotification />
        <BackupNotifier />
        {migrationInfo && migrationInfo.hasLocalData && !migrationInfo.migrated && (
          <div
            style={{
              padding: '12px 16px',
              background: '#fff3cd',
              color: '#664d03',
              borderBottom: '1px solid #ffe69c',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <span>
              Wykryto dane z poprzedniej wersji aplikacji. Prześlij je raz do chmury, aby były
              współdzielone z innymi użytkownikami.
            </span>
            <button onClick={handleRunMigration}>Prześlij dane do chmury</button>
          </div>
        )}
        <NavigationProvider
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          goBack={goBack}
          goForward={goForward}
        >
          <div className="app-body">
            <Sidebar
              current={view}
              onSelect={handleSidebarSelect}
              userEmail={session.email}
              onSignOut={handleSignOut}
            />
            {renderView()}
          </div>
        </NavigationProvider>
        {pendingEmailChooser && (
          <ExistingBatchChooser
            batches={pendingEmailChooser.batches}
            onOpen={(b) => {
              setPendingEmailChooser(null);
              navigateToBatch(b.id);
            }}
            onCreateNew={() => {
              const reportId = pendingEmailChooser.reportId;
              setPendingEmailChooser(null);
              proceedToGenerateEmails(reportId);
            }}
            onCancel={() => setPendingEmailChooser(null)}
          />
        )}
        <Footer appVersion={appVersion} />
      </div>
    </I18nProvider>
  );
};

export default App;
