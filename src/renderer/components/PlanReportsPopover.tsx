import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ShortageReportEntry, EmailBatch } from '../../shared/types';
import { useT } from '../i18n';

interface Props {
  trigger: React.ReactNode;
  triggerClassName?: string;
  triggerTitle?: string;
  reports: ShortageReportEntry[];
  batches: EmailBatch[];
  onSelectReport: (entry: ShortageReportEntry) => void;
  onSelectBatch: (batch: EmailBatch) => void;
}

const CLOSE_DELAY_MS = 120;

const PlanReportsPopover: React.FC<Props> = ({
  trigger,
  triggerClassName,
  triggerTitle,
  reports,
  batches,
  onSelectReport,
  onSelectBatch,
}) => {
  const t = useT();
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);

  const cancelClose = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };

  useEffect(() => () => cancelClose(), []);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    const update = () => {
      const trig = triggerRef.current;
      if (!trig) return;
      const trect = trig.getBoundingClientRect();
      const pop = popoverRef.current;
      const popHeight = pop?.offsetHeight ?? 200;
      const popWidth = pop?.offsetWidth ?? 320;
      const margin = 6;
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const fitsBelow = trect.bottom + popHeight + margin <= vh;
      const placeBelow = fitsBelow || trect.top < popHeight + margin;
      let left = trect.left;
      left = Math.max(8, Math.min(left, vw - popWidth - 8));
      const top = placeBelow
        ? trect.bottom + margin
        : Math.max(8, trect.top - popHeight - margin);
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
  }, [open]);

  const total = reports.length + batches.length;

  return (
    <>
      <span
        ref={triggerRef}
        className={triggerClassName}
        title={triggerTitle}
        onMouseEnter={() => {
          cancelClose();
          setOpen(true);
        }}
        onMouseLeave={scheduleClose}
      >
        {trigger}
      </span>
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            className="plan-reports-popover"
            style={{
              left: coords?.left ?? -10000,
              top: coords?.top ?? -10000,
              visibility: coords ? 'visible' : 'hidden',
            }}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
            <div className="shortage-tooltip-header">
              {t.planLinkedReports} — {total}
            </div>
            {total === 0 && <div className="hint">{t.planNoLinkedReports}</div>}
            {reports.length > 0 && (
              <>
                <div className="plan-reports-section-title">
                  {t.planLinkedShortageReports} — {reports.length}
                </div>
                <ul className="plan-reports-list">
                  {reports.map((e) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        className="plan-reports-item"
                        onClick={() => onSelectReport(e)}
                      >
                        <span className="plan-reports-item-name">{e.planName}</span>
                        <span className="plan-reports-item-meta">
                          {new Date(e.computedAt).toLocaleString()}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {batches.length > 0 && (
              <>
                <div className="plan-reports-section-title">
                  {t.planLinkedEmailBatches} — {batches.length}
                </div>
                <ul className="plan-reports-list">
                  {batches.map((b) => (
                    <li key={b.id}>
                      <button
                        type="button"
                        className="plan-reports-item"
                        onClick={() => onSelectBatch(b)}
                      >
                        <span className="plan-reports-item-name">
                          {b.emails.length} {b.emails.length === 1 ? 'email' : 'emaile'}
                        </span>
                        <span className="plan-reports-item-meta">
                          {new Date(b.generatedAt).toLocaleString()}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
};

export default PlanReportsPopover;
