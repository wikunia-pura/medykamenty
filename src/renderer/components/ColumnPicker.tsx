import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ColumnDef } from '../utils/useColumnPrefs';
import { useT } from '../i18n';

interface Props {
  /** Columns in the user's current order. */
  columns: ColumnDef[];
  isVisible: (id: string) => boolean;
  toggle: (id: string) => void;
  reorder: (fromIndex: number, toIndex: number) => void;
  reset: () => void;
}

const ColumnPicker: React.FC<Props> = ({ columns, isVisible, toggle, reorder, reset }) => {
  const t = useT();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const left = Math.max(8, rect.right - 260);
      const top = rect.bottom + 4;
      setCoords({ left, top });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        popoverRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      )
        return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onDragStart = (idx: number) => (e: React.DragEvent) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    // Some browsers need data set to start the drag.
    e.dataTransfer.setData('text/plain', String(idx));
  };

  const onDragOver = (idx: number) => (e: React.DragEvent) => {
    if (dragIdx === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIdx !== idx) setDragOverIdx(idx);
  };

  const onDrop = (idx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (dragIdx !== null && dragIdx !== idx) reorder(dragIdx, idx);
    setDragIdx(null);
    setDragOverIdx(null);
  };

  const onDragEnd = () => {
    setDragIdx(null);
    setDragOverIdx(null);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-sm"
        onClick={() => setOpen((v) => !v)}
        title={t.columnsConfigure}
      >
        ☰ {t.columns}
      </button>
      {open &&
        coords &&
        createPortal(
          <div
            ref={popoverRef}
            className="column-picker-popover"
            style={{ left: coords.left, top: coords.top }}
          >
            <div className="column-picker-header">
              <span>{t.columns}</span>
              <button type="button" className="btn btn-sm ghost" onClick={reset}>
                {t.reset}
              </button>
            </div>
            <div className="column-picker-list">
              {columns.map((c, idx) => {
                const checked = isVisible(c.id);
                const isDragged = dragIdx === idx;
                const isOver = dragOverIdx === idx && dragIdx !== null && dragIdx !== idx;
                return (
                  <div
                    key={c.id}
                    className={`column-picker-row${c.required ? ' has-required' : ''}${
                      isDragged ? ' dragging' : ''
                    }${isOver ? ' drag-over' : ''}`}
                    draggable
                    onDragStart={onDragStart(idx)}
                    onDragOver={onDragOver(idx)}
                    onDrop={onDrop(idx)}
                    onDragEnd={onDragEnd}
                  >
                    <span className="column-picker-handle" aria-hidden>
                      ⋮⋮
                    </span>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={c.required}
                      onChange={() => toggle(c.id)}
                    />
                    <span className="column-picker-label">{c.label}</span>
                  </div>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
};

export default ColumnPicker;
