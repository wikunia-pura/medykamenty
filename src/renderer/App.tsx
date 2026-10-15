import React, { useEffect, useState } from 'react';
import Sidebar from './components/Sidebar';
import Footer from './components/Footer';
import UpdateNotification from './components/UpdateNotification';
import BackupNotifier from './components/BackupNotifier';
import ExistingBatchChooser from './components/ExistingBatchChooser';
import { I18nProvider, useT } from './i18n';
import { translations } from './translations';
import ErrorBoundary from './components/ErrorBoundary';
import ModalHeader from './components/ModalHeader';
import { IconInfo } from './components/Icons';
import { useEscapeKey } from './utils/useEscapeKey';
import { NavigationProvider } from './navigation';
import type { EmailBatch, Lang, AppSettings, Order, TaskStatus } from '../shared/types';
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
import { useModalAutoWidth } from './utils/useModalAutoWidth';

const NAV_STACK_LIMIT = 50;

type AppErrorKey =
  | 'actionFailed'
  | 'loadDataFailed'
  | 'aiStatusLoadFailed'
  | 'emailBatchesCheckFailed';

interface NavState {
  stack: ViewKey[];
  index: number;
}

const App: React.FC = () => {
  // Modals widen to fit their content instead of scrolling sideways.
  useModalAutoWidth();
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
  // App.tsx renders the I18nProvider, so it reads its own strings directly.
  const t = translations[lang];
  // Failures of App-level actions and background loads, shown in a bar at the
  // top of the window (click to dismiss) instead of only in the console.
  // Kept as key + detail so it renders in the current language even when the
  // failure happened before the saved language was loaded.
  const [appError, setAppError] = useState<{ key: AppErrorKey; error: string } | null>(null);
  // Result of an action that needs acknowledging (the cloud migration).
  const [notice, setNotice] = useState<{ title: string; text: string } | null>(null);
  // Failure of a workflow-task action from the task banner; shown under it.
  const [taskError, setTaskError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
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

  const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

  const handleSignOut = async () => {
    try {
      await window.electronAPI.authSignOut();
      setSession(null);
    } catch (err) {
      setAppError({ key: 'actionFailed', error: errText(err) });
    }
  };

  const handleRunMigration = async () => {
    if (!migrationInfo) return;
    try {
      const result = await window.electronAPI.migrationRun();
      if (result.ok) {
        const c = result.counts;
        setNotice({
          title: t.migrationDoneTitle,
          text: t.migrationDoneDetails
            .replace('{suppliers}', String(c.suppliers))
            .replace('{rawMaterials}', String(c.rawMaterials))
            .replace('{components}', String(c.components))
            .replace('{products}', String(c.products))
            .replace('{plans}', String(c.productionPlans))
            .replace('{snapshots}', String(c.stockSnapshots))
            .replace('{reports}', String(c.shortageReports))
            .replace('{emailBatches}', String(c.emailBatches)),
        });
        const fresh = await window.electronAPI.migrationGetStatus();
        setMigrationInfo({ hasLocalData: fresh.hasLocalData, migrated: fresh.migrated });
      } else {
        setNotice({
          title: t.migrationFailedTitle,
          text: result.error,
        });
      }
    } catch (err) {
      setNotice({ title: t.migrationFailedTitle, text: errText(err) });
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
      // Fall through to the default generate flow on error, but say so — the
      // new batch may duplicate one that already exists.
      setAppError({ key: 'emailBatchesCheckFailed', error: errText(err) });
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
    extras?: {
      focusReportId?: string;
      focusBatchId?: string;
      planId?: string;
      // The caller's (fresh) copy of the order — saves fetching it again.
      order?: Order;
    },
  ) => {
    let orderName = '';
    let taskStatus: TaskStatus = 'in_progress';
    try {
      const o =
        extras?.order && extras.order.id === orderId
          ? extras.order
          : await window.electronAPI.getOrder(orderId);
      orderName = o?.name ?? '';
      const tk = o?.workflow?.tasks.find((task) => task.id === taskId);
      if (tk) taskStatus = tk.status;
    } catch {
      /* ignore — banner still renders, just without the name */
    }
    setTaskError(null);
    setSelectedOrderId(orderId);
    setOrderTaskCtx({ orderId, taskId, orderName, taskStatus });
    if (extras?.planId) setSelectedPlanId(extras.planId);
    if (extras?.focusReportId) setFocusReportId(extras.focusReportId);
    if (extras?.focusBatchId) setFocusBatchId(extras.focusBatchId);
    setView(target);
  };

  const markTaskDoneAndReturn = async () => {
    if (!orderTaskCtx) return;
    setTaskError(null);
    try {
      await window.electronAPI.updateOrderTask(orderTaskCtx.orderId, orderTaskCtx.taskId, {
        status: 'done',
      });
    } catch (err) {
      // Stay on the task screen: the task is NOT done.
      setTaskError(t.taskStatusUpdateFailed.replace('{error}', errText(err)));
      return;
    }
    setOrderTaskCtx(null);
    setView('orderDetails');
  };

  const reopenTaskAndStay = async () => {
    if (!orderTaskCtx) return;
    setTaskError(null);
    try {
      await window.electronAPI.updateOrderTask(orderTaskCtx.orderId, orderTaskCtx.taskId, {
        status: 'in_progress',
      });
      setOrderTaskCtx({ ...orderTaskCtx, taskStatus: 'in_progress' });
    } catch (err) {
      setTaskError(t.taskStatusUpdateFailed.replace('{error}', errText(err)));
    }
  };

  const backToOrderFromTask = () => {
    setTaskError(null);
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
      setTaskError(null);
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
        setSettingsError(errText(err));
      }
      try {
        const v = await window.electronAPI.getAppVersion();
        setAppVersion(v);
      } catch (err) {
        console.error('Failed to load version', err);
        setAppError({ key: 'loadDataFailed', error: errText(err) });
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
        setAppError({ key: 'aiStatusLoadFailed', error: errText(err) });
      }
      try {
        const m = await window.electronAPI.migrationGetStatus();
        setMigrationInfo({ hasLocalData: m.hasLocalData, migrated: m.migrated });
      } catch (err) {
        console.error('Failed to query migration status', err);
        setAppError({ key: 'loadDataFailed', error: errText(err) });
      }
    })();
  }, [session]);

  const setLang = async (newLang: Lang) => {
    setLangState(newLang);
    if (settings) {
      try {
        const updated = await window.electronAPI.updateSettings({ language: newLang });
        setSettings(updated);
      } catch (err) {
        setAppError({ key: 'actionFailed', error: errText(err) });
      }
    }
  };

  const onSettingsChanged = (s: AppSettings) => {
    setSettings(s);
    setLangState(s.language);
    document.body.classList.toggle('dark-mode', s.darkMode);
  };

  const renderView = () => {
    if (!settings) {
      return (
        <div className="main">
          {settingsError ? (
            <div className="card error-text">
              {t.settingsLoadFailed.replace('{error}', settingsError)}
            </div>
          ) : (
            t.loading
          )}
        </div>
      );
    }
    const taskBanner =
      orderTaskCtx &&
      (view === 'stockImport' ||
        view === 'shortageReport' ||
        view === 'emailGenerator') ? (
        <>
          <OrderTaskBanner
            orderName={orderTaskCtx.orderName}
            taskStatus={orderTaskCtx.taskStatus}
            onBackToOrder={backToOrderFromTask}
            onMarkDone={markTaskDoneAndReturn}
            onReopen={reopenTaskAndStay}
          />
          {taskError && (
            <div className="alert alert-error" onClick={() => setTaskError(null)}>
              {taskError}
            </div>
          )}
        </>
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
            warehouseEmail={settings.warehouseEmail}
            onSettingsChange={onSettingsChanged}
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
        {appError && (
          <div
            className="alert alert-error"
            style={{ margin: '8px 16px' }}
            onClick={() => setAppError(null)}
          >
            {t[appError.key].replace('{error}', appError.error)}
          </div>
        )}
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
            <span>{t.migrationBannerText}</span>
            <button onClick={handleRunMigration}>{t.migrationBannerButton}</button>
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
            {/* Keyed by view: a crash in one screen leaves the sidebar usable, and
                navigating elsewhere clears the error. */}
            <ErrorBoundary key={view} lang={lang}>
              {renderView()}
            </ErrorBoundary>
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
        {notice && (
          <AppNoticeDialog
            title={notice.title}
            text={notice.text}
            onClose={() => setNotice(null)}
          />
        )}
        <Footer appVersion={appVersion} />
      </div>
    </I18nProvider>
  );
};

// One-button acknowledgement dialog in the app's own modal shell (replaces the
// native alert()).
const AppNoticeDialog: React.FC<{ title: string; text: string; onClose: () => void }> = ({
  title,
  text,
  onClose,
}) => {
  const t = useT();
  useEscapeKey(onClose);
  return (
    <div className="modal-overlay" style={{ zIndex: 1000 }} onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <ModalHeader icon={<IconInfo size={18} />} tone="neutral" title={title} onClose={onClose} />
        <div className="modal-body" style={{ whiteSpace: 'pre-wrap' }}>
          {text}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn primary-filled" onClick={onClose}>
            {t.close}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;
