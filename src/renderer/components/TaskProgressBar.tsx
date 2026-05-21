import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TaskInstance, TaskStatus } from '../../shared/types';
import { useT } from '../i18n';
import HoverTooltip from './HoverTooltip';
import { IconCheck, IconClose, IconNote } from './Icons';

export type TaskAction =
  | { kind: 'setStatus'; status: TaskStatus }
  | { kind: 'open' }
  | { kind: 'editNote' };

interface Props {
  tasks: TaskInstance[];
  /** Make each segment clickable; opens a popover with status actions. */
  interactive?: boolean;
  /** Invoked when the user picks an action in the popover. */
  onTaskAction?: (task: TaskInstance, action: TaskAction) => void | Promise<void>;
  size?: 'sm' | 'md';
  /** Show "N/total" counter and percentage above the bar. Default true for md, false for sm. */
  showSummary?: boolean;
}

const taskStatusLabel = (s: TaskStatus, t: ReturnType<typeof useT>): string => {
  switch (s) {
    case 'todo':
      return t.taskStatusTodo;
    case 'in_progress':
      return t.taskStatusInProgress;
    case 'done':
      return t.taskStatusDone;
  }
};

const TaskProgressBar: React.FC<Props> = ({
  tasks,
  interactive = false,
  onTaskAction,
  size = 'md',
  showSummary,
}) => {
  const t = useT();
  const trackRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [openTaskIdx, setOpenTaskIdx] = useState<number | null>(null);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);

  const closePopover = () => {
    setOpenTaskIdx(null);
    setCoords(null);
  };

  // Position the popover under (or above, if no room) the clicked segment.
  useLayoutEffect(() => {
    if (openTaskIdx === null) return;
    const update = () => {
      const track = trackRef.current;
      if (!track) return;
      // Segments are wrapped in HoverTooltip <span>; reach into the actual button.
      const wrapper = track.children[openTaskIdx] as HTMLElement | undefined;
      const seg = (wrapper?.querySelector('.task-progress-seg') as HTMLElement) ?? wrapper;
      if (!seg) return;
      const srect = seg.getBoundingClientRect();
      const pop = popoverRef.current;
      const popHeight = pop?.offsetHeight ?? 180;
      const popWidth = pop?.offsetWidth ?? 260;
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const margin = 6;
      const fitsBelow = srect.bottom + popHeight + margin <= vh;
      const top = fitsBelow
        ? srect.bottom + margin
        : Math.max(8, srect.top - popHeight - margin);
      let left = srect.left + srect.width / 2 - popWidth / 2;
      left = Math.max(8, Math.min(left, vw - popWidth - 8));
      setCoords({ left, top });
    };
    update();
    const id = window.setTimeout(update, 0);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [openTaskIdx]);

  useEffect(() => {
    if (openTaskIdx === null) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (trackRef.current?.contains(target)) return;
      closePopover();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePopover();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openTaskIdx]);

  const total = tasks.length;

  if (total === 0) {
    return (
      <div className={`task-progress task-progress-${size} is-empty`}>
        <span className="task-progress-empty-hint">{t.workflowTemplateNoTasks}</span>
      </div>
    );
  }

  const done = tasks.filter((tk) => tk.status === 'done').length;
  const inProgress = tasks.filter((tk) => tk.status === 'in_progress').length;
  const summaryVisible = showSummary ?? size === 'md';
  const pct = Math.round((done / total) * 100);

  const onSegmentClick = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenTaskIdx((prev) => (prev === idx ? null : idx));
  };

  const runAction = async (task: TaskInstance, action: TaskAction) => {
    closePopover();
    if (onTaskAction) await onTaskAction(task, action);
  };

  const activeTask = openTaskIdx !== null ? tasks[openTaskIdx] : null;

  // Tooltip body for hover preview. Same data as the click popover (sans
  // actions) so users get a glance without committing to clicking.
  const renderTooltip = (task: TaskInstance, idx: number) => (
    <>
      <div className="shortage-tooltip-header">
        <span style={{ opacity: 0.7, marginRight: 4 }}>{idx + 1}.</span>
        {task.name || <span style={{ fontStyle: 'italic' }}>—</span>}
        <span className="workflow-task-status-inline" style={{ marginLeft: 6 }}>
          ({taskStatusLabel(task.status, t)})
        </span>
      </div>
      <div className="task-tooltip-dates">
        {task.startDate} → {task.endDate}
      </div>
      {task.note && <div className="task-tooltip-note">{task.note}</div>}
    </>
  );

  const doneOfText = t.tasksDoneOf
    .replace('{done}', String(done))
    .replace('{total}', String(total));

  return (
    <div className={`task-progress task-progress-${size}`}>
      <div
        ref={trackRef}
        className="task-progress-track"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {tasks.map((task, i) => {
          const cls = `task-progress-seg task-progress-seg-${task.status}${
            openTaskIdx === i ? ' is-open' : ''
          }`;
          // Segment content: name shown on md size, suppressed on sm (too tight).
          const inner =
            size === 'md' ? (
              <span className="task-progress-seg-label">
                <span className="task-progress-seg-num">{i + 1}.</span>
                <span className="task-progress-seg-name">{task.name || '—'}</span>
              </span>
            ) : null;
          const segment = interactive ? (
            <button
              type="button"
              className={cls}
              onClick={(e) => onSegmentClick(i, e)}
            >
              {inner}
            </button>
          ) : (
            <span className={cls}>{inner}</span>
          );
          // Suppress the hover tooltip while the popover for this segment is
          // open — otherwise it stacks under the popover and looks broken.
          if (openTaskIdx === i) {
            return (
              <span key={task.id} className="task-progress-seg-wrap">
                {segment}
              </span>
            );
          }
          return (
            <HoverTooltip
              key={task.id}
              triggerClassName="task-progress-seg-wrap"
              trigger={segment}
              className="task-tooltip"
            >
              {renderTooltip(task, i)}
            </HoverTooltip>
          );
        })}
      </div>

      {summaryVisible && (
        <div className="task-progress-summary">
          <span className="task-progress-summary-item">{doneOfText}</span>
          {inProgress > 0 && (
            <span className="task-progress-summary-item task-progress-summary-active">
              <span className="task-progress-active-dot" aria-hidden />
              {inProgress} {t.taskStatusInProgress.toLowerCase()}
            </span>
          )}
          <span className="task-progress-summary-item task-progress-summary-pct">
            {pct}%
          </span>
        </div>
      )}

      {activeTask &&
        coords &&
        createPortal(
          <div
            ref={popoverRef}
            className="task-action-popover"
            style={{ left: coords.left, top: coords.top }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="task-action-popover-header">
              <span className="task-action-popover-idx">{(openTaskIdx ?? 0) + 1}.</span>
              <span className="task-action-popover-name">{activeTask.name}</span>
              <span className="workflow-task-status-inline" style={{ marginLeft: 6 }}>
                ({taskStatusLabel(activeTask.status, t)})
              </span>
              <button
                type="button"
                className="task-action-popover-close"
                onClick={closePopover}
                aria-label={t.close}
              >
                <IconClose size={12} />
              </button>
            </div>
            <div className="task-action-popover-body">
              <div className="task-action-popover-dates">
                {activeTask.startDate} → {activeTask.endDate}
              </div>
              {activeTask.note && (
                <div className="task-action-popover-note">{activeTask.note}</div>
              )}
            </div>
            <div className="task-action-popover-footer">
              <div className="task-action-popover-actions">
                {activeTask.status !== 'todo' && (
                  <button
                    type="button"
                    className="btn btn-sm task-action-btn"
                    onClick={() =>
                      void runAction(activeTask, { kind: 'setStatus', status: 'todo' })
                    }
                  >
                    ↺ {t.markTodo}
                  </button>
                )}
                {activeTask.status !== 'in_progress' && (
                  <button
                    type="button"
                    className="btn btn-sm soft-edit task-action-btn"
                    onClick={() =>
                      void runAction(activeTask, {
                        kind: 'setStatus',
                        status: 'in_progress',
                      })
                    }
                  >
                    ▶ {t.markInProgress}
                  </button>
                )}
                {activeTask.status !== 'done' && (
                  <button
                    type="button"
                    className="btn btn-sm soft-success task-action-btn"
                    onClick={() =>
                      void runAction(activeTask, { kind: 'setStatus', status: 'done' })
                    }
                  >
                    <IconCheck size={12} /> {t.markDone}
                  </button>
                )}
                {onTaskAction && (
                  <button
                    type="button"
                    className="btn btn-sm task-action-btn task-action-note-btn"
                    onClick={() => void runAction(activeTask, { kind: 'editNote' })}
                    title={activeTask.note ? t.taskEditNote : t.taskAddNote}
                  >
                    <IconNote size={12} />{' '}
                    {activeTask.note ? t.taskEditNote : t.taskAddNote}
                  </button>
                )}
                {activeTask.type !== 'custom' && onTaskAction && (
                  <button
                    type="button"
                    className="btn btn-sm primary task-action-btn"
                    onClick={() => void runAction(activeTask, { kind: 'open' })}
                  >
                    {t.openScreen} →
                  </button>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};

export default TaskProgressBar;
