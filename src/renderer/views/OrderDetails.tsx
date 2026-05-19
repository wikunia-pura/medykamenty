import React, { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { HeaderNav } from '../navigation';
import type {
  EmailBatch,
  Order,
  OrderStatus,
  Product,
  ProductionPlan,
  ShortageLine,
  ShortageReportEntry,
  TaskInstance,
  TaskStatus,
  TaskType,
  WorkflowTemplate,
} from '../../shared/types';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingOverlay from '../components/LoadingOverlay';
import ModalHeader from '../components/ModalHeader';
import OrderEditorModal from '../components/OrderEditorModal';
import {
  IconEdit,
  IconPlus,
  IconClose,
  IconCheck,
  IconArrowLeft,
  IconMail,
  IconTrash,
} from '../components/Icons';
import NumberInput from '../components/NumberInput';
import HoverTooltip from '../components/HoverTooltip';
import PlanEditorModal from '../components/PlanEditorModal';
import TaskProgressBar, { type TaskAction } from '../components/TaskProgressBar';
import { useEscapeKey } from '../utils/useEscapeKey';

interface Props {
  orderId: string;
  onBack: () => void;
  onNavigateToReport: (planId: string, reportId: string) => void;
  onNavigateToEmails: (reportId: string) => void;
  onNavigateToBatch: (batchId: string) => void;
  onNavigateForTask: (
    view: 'stockImport' | 'shortageReport' | 'emailGenerator',
    orderId: string,
    taskId: string,
    extras?: { planId?: string },
  ) => void;
}

const OrderDetails: React.FC<Props> = ({
  orderId,
  onBack,
  onNavigateToReport,
  onNavigateToEmails,
  onNavigateToBatch,
  onNavigateForTask,
}) => {
  const t = useT();
  const [order, setOrder] = useState<Order | null>(null);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [plans, setPlans] = useState<ProductionPlan[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [reports, setReports] = useState<ShortageReportEntry[]>([]);
  const [batches, setBatches] = useState<EmailBatch[]>([]);
  const [editingPlan, setEditingPlan] = useState<Partial<ProductionPlan> | null>(null);
  const [confirmDeleteBatch, setConfirmDeleteBatch] = useState<EmailBatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Gate the "linked plan / report deleted" tags so they don't flash during
  // the initial render before reload() populates plans/reports/batches.
  const [dataLoaded, setDataLoaded] = useState(false);
  const [confirmDeleteReport, setConfirmDeleteReport] =
    useState<ShortageReportEntry | null>(null);
  const [addingTask, setAddingTask] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskInstance | null>(null);
  const [picking, setPicking] = useState<'template' | 'newReport' | null>(null);
  const [editingOrder, setEditingOrder] = useState<Partial<Order> | null>(null);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const reload = async () => {
    try {
      const [o, tpls, pls, prods, reps, bs] = await Promise.all([
        window.electronAPI.getOrder(orderId),
        window.electronAPI.listWorkflowTemplates(),
        window.electronAPI.listPlans(),
        window.electronAPI.listProducts(),
        window.electronAPI.listShortageReports(),
        window.electronAPI.listEmailBatches(),
      ]);
      setOrder(o ?? null);
      setTemplates(tpls);
      setPlans(pls);
      setProducts(prods);
      setReports(reps.filter((r) => r.orderId === orderId));
      setBatches(bs.filter((b) => b.orderId === orderId));
      setDataLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const openPlanModal = (planId: string) => {
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    setEditingPlan({ ...plan });
  };

  useEffect(() => {
    void reload();
  }, [orderId]);

  if (!order) {
    return (
      <div className="main">
        <div className="page-header">
          <HeaderNav />
          <button type="button" className="btn btn-sm" onClick={onBack}>
            <IconArrowLeft size={12} /> {t.backToList}
          </button>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : t.loading}
      </div>
    );
  }

  const taskStatusLabel = (s: TaskStatus): string => {
    switch (s) {
      case 'todo':
        return t.taskStatusTodo;
      case 'in_progress':
        return t.taskStatusInProgress;
      case 'done':
        return t.taskStatusDone;
    }
  };

  const attachTemplate = async (templateId: string) => {
    setBusy(true);
    try {
      const updated = await window.electronAPI.attachWorkflowToOrder(orderId, templateId);
      setOrder(updated);
      setPicking(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const setTaskStatus = async (task: TaskInstance, next: TaskStatus) => {
    // Soft sequence warning: marking done out of order is allowed but flagged.
    if (next === 'done' && order.workflow) {
      const idx = order.workflow.tasks.findIndex((tk) => tk.id === task.id);
      const earlierUndone = order.workflow.tasks
        .slice(0, idx)
        .some((tk) => tk.status !== 'done');
      if (earlierUndone) {
        if (!confirm(t.taskSkipWarning)) return;
      }
    }
    setBusy(true);
    try {
      const updated = await window.electronAPI.updateOrderTask(orderId, task.id, {
        status: next,
      });
      setOrder(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onTaskClick = async (task: TaskInstance) => {
    if (task.type === 'custom') return;
    // Auto-start when entering the linked screen.
    if (task.status === 'todo') {
      try {
        const updated = await window.electronAPI.updateOrderTask(orderId, task.id, {
          status: 'in_progress',
        });
        setOrder(updated);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return;
      }
    }
    const view =
      task.type === 'import_stock'
        ? 'stockImport'
        : task.type === 'generate_shortage'
          ? 'shortageReport'
          : 'emailGenerator';
    onNavigateForTask(view, orderId, task.id);
  };

  const onDragStart = (idx: number) => (e: React.DragEvent) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  };

  const onDragOver = (idx: number) => (e: React.DragEvent) => {
    if (dragIdx === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIdx !== idx) setDragOverIdx(idx);
  };

  const onDrop = (idx: number) => async (e: React.DragEvent) => {
    e.preventDefault();
    if (dragIdx !== null && dragIdx !== idx) {
      setBusy(true);
      try {
        const updated = await window.electronAPI.reorderOrderTasks(orderId, dragIdx, idx);
        setOrder(updated);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    }
    setDragIdx(null);
    setDragOverIdx(null);
  };

  const onDragEnd = () => {
    setDragIdx(null);
    setDragOverIdx(null);
  };

  const commitTitleRename = async () => {
    if (titleDraft === null) return;
    const next = titleDraft.trim();
    setTitleDraft(null);
    if (!next || next === order.name) return;
    setBusy(true);
    try {
      const updated = await window.electronAPI.updateOrder(orderId, { name: next });
      setOrder(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const saveEditedOrder = async () => {
    if (!editingOrder) return;
    const name = (editingOrder.name ?? '').trim();
    const startDate = editingOrder.startDate;
    if (!name || !startDate) return;
    setBusy(true);
    try {
      const updated = await window.electronAPI.updateOrder(orderId, {
        name,
        startDate,
        status: editingOrder.status ?? order.status,
        notes: editingOrder.notes,
      });
      setOrder(updated);
      setEditingOrder(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const wf = order.workflow;

  return (
    <div className="main">
      <div className="focus-bar">
          <button className="btn" onClick={onBack} title={t.orders}>
            <IconArrowLeft size={14} /> {t.orders}
          </button>
          <div className="focus-bar-text">
            {titleDraft !== null ? (
              <input
                autoFocus
                className="focus-bar-title-input"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => void commitTitleRename()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void commitTitleRename();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setTitleDraft(null);
                  }
                }}
              />
            ) : (
              <h1
                className="focus-bar-title focus-bar-title-editable"
                onClick={() => setTitleDraft(order.name)}
                title={t.edit}
              >
                {order.name}
                <IconEdit size={13} className="focus-bar-title-pencil" />
              </h1>
            )}
            <span className="focus-bar-meta">
              <span className="hint">{t.orderStartDate}:</span> {order.startDate}
            </span>
            <span className="focus-bar-meta">
              <span className="hint">{t.orderStatus}:</span>{' '}
              <select
                className={`status-inline-select order-status-${order.status}`}
                value={order.status}
                onChange={async (e) => {
                  const next = e.target.value as OrderStatus;
                  setBusy(true);
                  try {
                    const updated = await window.electronAPI.updateOrder(orderId, {
                      status: next,
                    });
                    setOrder(updated);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  } finally {
                    setBusy(false);
                  }
                }}
                title={t.changeStatus}
              >
                <option value="draft">{t.orderStatusDraft}</option>
                <option value="in_progress">{t.orderStatusInProgress}</option>
                <option value="completed">{t.orderStatusCompleted}</option>
                <option value="cancelled">{t.orderStatusCancelled}</option>
              </select>
            </span>
          </div>
          <div className="btn-row">
            <button
              type="button"
              className="btn"
              onClick={() => setEditingOrder({ ...order })}
            >
              <IconEdit size={12} /> {t.edit}
            </button>
          </div>
      </div>

      {error && (
        <div className="alert alert-error" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      {order.notes && (
        <div className="card order-header-notes-card">
          <strong>{t.orderNotes}:</strong>
          <p className="order-header-notes-text">{order.notes}</p>
        </div>
      )}

      <div className="card">
        <div className="section-header">
          <h2>{t.workflow}</h2>
          {wf ? (
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-sm soft-edit"
                onClick={() => setAddingTask(true)}
              >
                <IconPlus size={13} /> {t.addTask}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setPicking('template')}
              disabled={templates.length === 0}
            >
              <IconPlus size={12} /> {t.attachWorkflow}
            </button>
          )}
        </div>

        {!wf ? (
          <p className="empty-hint">{t.noWorkflowAttached}</p>
        ) : wf.tasks.length === 0 ? (
          <p className="empty-hint">{t.workflowTemplateNoTasks}</p>
        ) : (
          <>
            <TaskProgressBar
              tasks={wf.tasks}
              size="md"
              interactive
              onTaskAction={async (task, action: TaskAction) => {
                if (action.kind === 'setStatus') {
                  await setTaskStatus(task, action.status);
                } else if (action.kind === 'open') {
                  await onTaskClick(task);
                }
              }}
            />
            <div className="workflow-section-divider" aria-hidden />
            <div className="workflow-task-list">
            {wf.tasks.map((task, idx) => {
              const isDragged = dragIdx === idx;
              const isOver = dragOverIdx === idx && dragIdx !== null && dragIdx !== idx;
              const clickable = task.type !== 'custom';
              return (
                <div
                  key={task.id}
                  id={`task-${task.id}`}
                  className={`workflow-task-row instance status-${task.status}${
                    isDragged ? ' dragging' : ''
                  }${isOver ? ' drag-over' : ''}`}
                  draggable
                  onDragStart={onDragStart(idx)}
                  onDragOver={onDragOver(idx)}
                  onDrop={onDrop(idx)}
                  onDragEnd={onDragEnd}
                >
                  <span className="workflow-task-idx">{idx + 1}.</span>
                  <div className="workflow-task-main">
                    <div className="workflow-task-name-row">
                      {clickable ? (
                        <a
                          href="#"
                          className="link workflow-task-name-link"
                          onClick={(e) => {
                            e.preventDefault();
                            void onTaskClick(task);
                          }}
                        >
                          {task.name}
                        </a>
                      ) : (
                        <span className="workflow-task-name-text">{task.name}</span>
                      )}
                      <span className="workflow-task-status-inline">
                        ({taskStatusLabel(task.status)})
                      </span>
                      <span className="workflow-task-sep" aria-hidden>
                        ·
                      </span>
                      <span className="workflow-task-dates">
                        {task.startDate} → {task.endDate}
                      </span>
                    </div>
                  </div>
                  <div className="workflow-task-status-controls">
                    {task.status === 'todo' && (
                      <button
                        type="button"
                        className="btn btn-sm soft-edit"
                        onClick={() => setTaskStatus(task, 'in_progress')}
                        title={t.markInProgress}
                      >
                        ▶ {t.markInProgress}
                      </button>
                    )}
                    {task.status === 'in_progress' && (
                      <>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => setTaskStatus(task, 'todo')}
                          title={t.markTodo}
                        >
                          ↺ {t.markTodo}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm soft-success"
                          onClick={() => setTaskStatus(task, 'done')}
                          title={t.markDone}
                        >
                          <IconCheck size={13} /> {t.markDone}
                        </button>
                      </>
                    )}
                    {task.status === 'done' && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setTaskStatus(task, 'todo')}
                        title={t.markTodo}
                      >
                        ↺ {t.markTodo}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-sm soft-edit"
                      onClick={() => setEditingTask(task)}
                      title={t.edit}
                    >
                      <IconEdit size={13} /> {t.edit}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm soft-danger"
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const updated = await window.electronAPI.deleteOrderTask(
                            orderId,
                            task.id,
                          );
                          setOrder(updated);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : String(err));
                        } finally {
                          setBusy(false);
                        }
                      }}
                      title={t.delete}
                    >
                      <IconTrash size={13} /> {t.delete}
                    </button>
                  </div>
                </div>
              );
            })}
            </div>
          </>
        )}
      </div>

      <div className="card">
        <div className="section-header">
          <h2>
            {t.ordersReports}
            <span className="page-header-count" style={{ marginLeft: 8 }}>
              {reports.length}
            </span>
          </h2>
          <button
            type="button"
            className="btn primary"
            onClick={() => setPicking('newReport')}
            disabled={plans.length === 0}
          >
            <IconPlus size={13} /> {t.newReport}
          </button>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t.reportName}</th>
                <th>{t.selectedPlan}</th>
                <th>{t.computedAtLabel}</th>
                <th>{t.shortageReport}</th>
                <th className="actions actions-sticky">{t.actionsHeader}</th>
              </tr>
            </thead>
            <tbody>
              {reports.length === 0 && (
                <tr>
                  <td colSpan={5} className="hint">
                    {t.ordersReportsEmpty}
                  </td>
                </tr>
              )}
              {reports.map((r) => {
                const missing = [...r.report.rawLines, ...r.report.componentLines]
                  .filter((l) => l.shortage > 0)
                  .sort((a, b) => b.shortage - a.shortage);
                const groups = r.report.groups.length;
                const linkedPlan = plans.find((p) => p.id === r.planId);
                const livePlanName = linkedPlan?.name ?? r.planName;
                const planMissing = dataLoaded && !!r.planId && !linkedPlan;
                return (
                  <tr
                    key={r.id}
                    className="row-clickable"
                    onClick={() => onNavigateToReport(r.planId, r.id)}
                    title={t.preview}
                  >
                    <td className="col-name col-wrap">{r.reportName}</td>
                    <td className="col-wrap" onClick={(ev) => ev.stopPropagation()}>
                      <div className="cell-with-end-tag">
                        {planMissing && (
                          <span className="tag danger" title={t.linkedPlanDeleted}>
                            {t.linkedPlanDeletedTag}
                          </span>
                        )}
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => openPlanModal(r.planId)}
                          title={planMissing ? t.linkedPlanDeleted : t.openPlan}
                          disabled={planMissing}
                        >
                          {livePlanName}
                        </button>
                      </div>
                    </td>
                    <td className="hint">
                      {new Date(r.computedAt).toLocaleString()}
                    </td>
                    <td>
                      {missing.length === 0 ? (
                        <span className="tag success">{t.noShortages}</span>
                      ) : (
                        <HoverTooltip
                          trigger={
                            <span className="shortage-summary">
                              <strong className="shortage-count">
                                {missing.length}
                              </strong>
                              <span className="hint">
                                {missing.length === 1
                                  ? 'brakująca pozycja'
                                  : 'brakujących pozycji'}
                                {' · '}
                                {groups} {groups === 1 ? 'dostawca' : 'dostawców'}
                              </span>
                            </span>
                          }
                        >
                          <div className="shortage-tooltip-header">
                            {t.shortageReport} — {missing.length}{' '}
                            {missing.length === 1 ? 'pozycja' : 'pozycji'}
                          </div>
                          <ul className="shortage-tooltip-list">
                            {missing.map((line: ShortageLine) => (
                              <li key={`${line.itemKind}-${line.itemId}`}>
                                <span className="shortage-tooltip-name">
                                  {line.itemName}
                                </span>
                                <span className="shortage-tooltip-amount">
                                  {line.shortage.toFixed(
                                    line.unit === 'pcs' ? 0 : 2,
                                  )}{' '}
                                  {line.unit}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </HoverTooltip>
                      )}
                    </td>
                    <td
                      className="actions actions-sticky"
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      <div className="btn-row">
                        <button
                          className="btn btn-sm soft-danger"
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await window.electronAPI.updateShortageReport(r.id, {
                                orderId: null,
                              });
                              await reload();
                            } catch (err) {
                              setError(
                                err instanceof Error ? err.message : String(err),
                              );
                            } finally {
                              setBusy(false);
                            }
                          }}
                          title={t.unlinkOrder}
                        >
                          <IconClose size={13} /> {t.unlinkOrder}
                        </button>
                        <button
                          className="btn btn-sm soft-edit"
                          onClick={() => onNavigateToReport(r.planId, r.id)}
                          title={t.edit}
                        >
                          <IconEdit size={13} /> {t.edit}
                        </button>
                        <button
                          className="btn btn-sm soft-danger"
                          onClick={() => setConfirmDeleteReport(r)}
                          title={t.delete}
                        >
                          <IconTrash size={13} /> {t.delete}
                        </button>
                        <button
                          className="btn btn-sm soft-success"
                          onClick={() => onNavigateToEmails(r.id)}
                          disabled={r.report.groups.length === 0}
                          title={t.generateEmails}
                        >
                          <IconMail size={13} /> {t.generateEmails}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="section-header">
          <h2>
            {t.emailBatchTitle}
            <span className="page-header-count" style={{ marginLeft: 8 }}>
              {batches.length}
            </span>
          </h2>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t.reportName}</th>
                <th>{t.selectedPlan}</th>
                <th>{t.generatedAtLabel}</th>
                <th>{t.suppliers}</th>
                <th className="actions actions-sticky">{t.actionsHeader}</th>
              </tr>
            </thead>
            <tbody>
              {batches.length === 0 && (
                <tr>
                  <td colSpan={5} className="hint">
                    {t.noData}
                  </td>
                </tr>
              )}
              {batches.map((b) => {
                const sent = b.emails.filter((e) => !!e.sentAt).length;
                const total = b.emails.length;
                const allSent = total > 0 && sent === total;
                const linkedPlan = plans.find((p) => p.id === b.planId);
                const livePlanName = linkedPlan?.name ?? b.planName;
                const planMissing = dataLoaded && !!b.planId && !linkedPlan;
                const reportMissing =
                  dataLoaded &&
                  !!b.reportId &&
                  !reports.some((r) => r.id === b.reportId);
                return (
                  <tr
                    key={b.id}
                    className="row-clickable"
                    onClick={() => onNavigateToBatch(b.id)}
                    title={t.preview}
                  >
                    <td className="col-name col-wrap">
                      <div className="cell-with-end-tag">
                        {reportMissing && (
                          <span
                            className="tag danger"
                            title={t.linkedReportDeleted}
                          >
                            {t.linkedReportDeletedTag}
                          </span>
                        )}
                        <button
                          type="button"
                          className="link-button"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            onNavigateToReport(b.planId, b.reportId);
                          }}
                          title={
                            reportMissing
                              ? t.linkedReportDeleted
                              : t.goToShortageReport
                          }
                          disabled={reportMissing}
                        >
                          {b.reportName}
                        </button>
                      </div>
                    </td>
                    <td className="col-wrap" onClick={(ev) => ev.stopPropagation()}>
                      <div className="cell-with-end-tag">
                        {planMissing && (
                          <span className="tag danger" title={t.linkedPlanDeleted}>
                            {t.linkedPlanDeletedTag}
                          </span>
                        )}
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => openPlanModal(b.planId)}
                          title={planMissing ? t.linkedPlanDeleted : t.openPlan}
                          disabled={planMissing}
                        >
                          {livePlanName}
                        </button>
                      </div>
                    </td>
                    <td className="hint">
                      {new Date(b.generatedAt).toLocaleString()}
                    </td>
                    <td>
                      <HoverTooltip
                        trigger={
                          <span className="email-batch-summary">
                            <span className="count-bubble">{total}</span>
                            <span
                              className={`tag ${
                                allSent ? 'success' : sent > 0 ? 'warn' : ''
                              }`}
                            >
                              {sent}/{total} {t.sentCount}
                            </span>
                          </span>
                        }
                      >
                        <div className="shortage-tooltip-header">
                          {t.suppliers} — {sent}/{total} {t.sentCount}
                        </div>
                        <ul className="shortage-tooltip-list">
                          {b.emails.map((e) => (
                            <li key={e.id}>
                              <span className="shortage-tooltip-name">
                                {e.supplierName}
                                {e.to && (
                                  <span className="hint" style={{ marginLeft: 6 }}>
                                    &lt;{e.to}&gt;
                                  </span>
                                )}
                              </span>
                              <span className={`tag ${e.sentAt ? 'success' : ''}`}>
                                {e.sentAt ? (
                                  <>
                                    <IconCheck size={10} /> {t.sentBadge}
                                  </>
                                ) : (
                                  '—'
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </HoverTooltip>
                    </td>
                    <td
                      className="actions actions-sticky"
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      <div className="btn-row">
                        <button
                          className="btn btn-sm"
                          onClick={() => onNavigateToBatch(b.id)}
                          title={t.preview}
                        >
                          <IconMail size={13} /> {t.preview}
                        </button>
                        <button
                          className="btn btn-sm soft-danger"
                          onClick={() => setConfirmDeleteBatch(b)}
                          title={t.delete}
                        >
                          <IconTrash size={13} /> {t.delete}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {picking === 'template' && (
        <PickerDialog
          title={t.selectWorkflowTemplate}
          options={templates.map((tpl) => ({
            id: tpl.id,
            label: tpl.name,
            sub: `${tpl.tasks.length} ${t.tasks.toLowerCase()}`,
          }))}
          onCancel={() => setPicking(null)}
          onPick={(id) => void attachTemplate(id)}
        />
      )}

      {picking === 'newReport' && (
        <PickerDialog
          title={t.selectPlan}
          options={plans.map((p) => ({ id: p.id, label: p.name }))}
          onCancel={() => setPicking(null)}
          onPick={async (planId) => {
            setPicking(null);
            setBusy(true);
            try {
              await window.electronAPI.computeShortages(planId, orderId);
              await reload();
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
          footer={
            <button
              type="button"
              className="btn"
              onClick={() => {
                setPicking(null);
                // Hand control over to the shortage-report view; the user can
                // pick any existing report (and we already let them link it
                // back to an order from that screen).
                onNavigateToReport('', '');
              }}
            >
              {t.goToReportsView} →
            </button>
          }
        />
      )}

      {addingTask && (
        <TaskEditorDialog
          mode="add"
          onCancel={() => setAddingTask(false)}
          onSave={async (input) => {
            setBusy(true);
            try {
              const updated = await window.electronAPI.addOrderTask(orderId, input);
              setOrder(updated);
              setAddingTask(false);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {editingTask && (
        <TaskEditorDialog
          mode="edit"
          initial={editingTask}
          onCancel={() => setEditingTask(null)}
          onSave={async (patch) => {
            setBusy(true);
            try {
              const updated = await window.electronAPI.updateOrderTask(
                orderId,
                editingTask.id,
                {
                  name: patch.name,
                  type: patch.type,
                  ...(patch.startDate ? { startDate: patch.startDate } : {}),
                  ...(patch.endDate ? { endDate: patch.endDate } : {}),
                },
              );
              setOrder(updated);
              setEditingTask(null);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {confirmDeleteReport && (
        <ConfirmDialog
          message={`${t.deleteReportConfirm}: ${confirmDeleteReport.reportName}?`}
          danger
          onConfirm={async () => {
            const id = confirmDeleteReport.id;
            setConfirmDeleteReport(null);
            setBusy(true);
            try {
              await window.electronAPI.deleteShortageReport(id);
              await reload();
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
          onCancel={() => setConfirmDeleteReport(null)}
        />
      )}

      {confirmDeleteBatch && (
        <ConfirmDialog
          message={`${t.deleteBatchConfirm}: ${confirmDeleteBatch.reportName} (${new Date(
            confirmDeleteBatch.generatedAt,
          ).toLocaleString()})?`}
          danger
          onConfirm={async () => {
            const id = confirmDeleteBatch.id;
            setConfirmDeleteBatch(null);
            setBusy(true);
            try {
              await window.electronAPI.deleteEmailBatch(id);
              await reload();
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
          onCancel={() => setConfirmDeleteBatch(null)}
        />
      )}

      {editingPlan && (
        <PlanEditorModal
          editing={editingPlan}
          products={products}
          setEditing={setEditingPlan}
          onCancel={() => setEditingPlan(null)}
          onSave={async () => {
            /* read-only preview only — saves intentionally not wired here */
            setEditingPlan(null);
          }}
          readOnly
        />
      )}

      {editingOrder && (
        <OrderEditorModal
          editing={editingOrder}
          setEditing={setEditingOrder}
          onCancel={() => setEditingOrder(null)}
          onSave={saveEditedOrder}
        />
      )}

      {busy && <LoadingOverlay message={t.loaderProcessing} />}
    </div>
  );
};

// Lightweight pick-from-list dialog. Avoids pulling in a heavier select widget
// for the rare attach-template / pick-plan flows.
const PickerDialog: React.FC<{
  title: string;
  options: { id: string; label: string; sub?: string }[];
  onCancel: () => void;
  onPick: (id: string) => void;
  /** Rendered below the option list (e.g. a "go to full view" link). */
  footer?: React.ReactNode;
  /** Icon for the modal header (defaults to plus). */
  icon?: React.ReactNode;
}> = ({ title, options, onCancel, onPick, footer, icon }) => {
  const t = useT();
  useEscapeKey(onCancel);
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <ModalHeader
          icon={icon ?? <IconPlus size={18} />}
          tone="add"
          title={title}
          onClose={onCancel}
        />
        <div className="modal-body picker-list">
          {options.length === 0 ? (
            <p className="empty-hint">{t.noData}</p>
          ) : (
            options.map((o) => (
              <button
                key={o.id}
                type="button"
                className="picker-item"
                onClick={() => onPick(o.id)}
              >
                <span className="picker-item-label">{o.label}</span>
                {o.sub && <span className="picker-item-sub">{o.sub}</span>}
              </button>
            ))
          )}
        </div>
        {footer && <div className="picker-footer">{footer}</div>}
      </div>
    </div>
  );
};

const TaskEditorDialog: React.FC<{
  mode: 'add' | 'edit';
  initial?: TaskInstance;
  onCancel: () => void;
  onSave: (input: {
    name: string;
    type: TaskType;
    durationDays: number;
    startDate?: string;
    endDate?: string;
  }) => void | Promise<void>;
}> = ({ mode, initial, onCancel, onSave }) => {
  const t = useT();
  useEscapeKey(onCancel);
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<TaskType>(initial?.type ?? 'custom');
  const [durationDays, setDurationDays] = useState<number>(1);
  const [startDate, setStartDate] = useState<string>(initial?.startDate ?? '');
  const [endDate, setEndDate] = useState<string>(initial?.endDate ?? '');

  const typeOptions: { value: TaskType; label: string }[] = [
    { value: 'custom', label: t.taskTypeCustom },
    { value: 'import_stock', label: t.taskTypeImportStock },
    { value: 'generate_shortage', label: t.taskTypeGenerateShortage },
    { value: 'generate_emails', label: t.taskTypeGenerateEmails },
  ];

  const canSave =
    !!name.trim() && (mode === 'add' || (startDate && endDate && startDate <= endDate));

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <ModalHeader
          icon={mode === 'add' ? <IconPlus size={18} /> : <IconEdit size={18} />}
          tone={mode === 'add' ? 'add' : 'edit'}
          title={mode === 'add' ? t.addTask : t.edit}
          onClose={onCancel}
        />
        <div className="modal-body">
          <div className="form-row">
            <label className="form-label">{t.taskNamePlaceholder}</label>
            <input
              type="text"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="form-row">
            <label className="form-label">{t.taskType}</label>
            <select value={type} onChange={(e) => setType(e.target.value as TaskType)}>
              {typeOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {mode === 'add' ? (
            <div className="form-row">
              <label className="form-label">
                {t.taskDuration} ({t.days})
              </label>
              <NumberInput
                className="input"
                value={durationDays}
                onChange={(v) => setDurationDays(Math.max(1, v ?? 1))}
                min={1}
              />
            </div>
          ) : (
            <>
              <div className="form-row">
                <label className="form-label">{t.taskStartDate}</label>
                <input
                  type="date"
                  className="input"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="form-row">
                <label className="form-label">{t.taskEndDate}</label>
                <input
                  type="date"
                  className="input"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onCancel}>
            {t.cancel}
          </button>
          <button
            type="button"
            className="btn primary-filled"
            disabled={!canSave}
            onClick={() =>
              onSave({
                name: name.trim(),
                type,
                durationDays,
                ...(mode === 'edit' ? { startDate, endDate } : {}),
              })
            }
          >
            {t.save}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OrderDetails;
