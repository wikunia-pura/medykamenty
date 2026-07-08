import React, { useCallback } from 'react';
import { MIN_COLUMN_WIDTH } from './useColumnPrefs';

// Column resizing for the data tables that use useColumnPrefs. Each resizable
// header cell gets a drag handle on its right border; dragging updates the
// column's persisted pixel width (see useColumnPrefs.setWidth). Widths are
// applied inline (width + min + max) so they hold under the tables' default
// `table-layout: auto` — a column can't be dragged narrower than its content,
// which is the expected spreadsheet-like behaviour.
export function useColumnResize(setWidth: (id: string, px: number) => void) {
  const startResize = useCallback(
    (e: React.MouseEvent, id: string) => {
      // Don't let the drag start a text selection or a column-reorder.
      e.preventDefault();
      e.stopPropagation();
      const handle = e.currentTarget as HTMLElement;
      const th = handle.parentElement as HTMLElement | null;
      if (!th) return;
      const startX = e.clientX;
      const startW = th.getBoundingClientRect().width;

      const onMove = (ev: MouseEvent) => {
        const px = Math.max(MIN_COLUMN_WIDTH, Math.round(startW + (ev.clientX - startX)));
        setWidth(id, px);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.classList.remove('col-resizing');
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.body.classList.add('col-resizing');
    },
    [setWidth],
  );

  // Wrap a view's existing <th> node: apply the persisted width and append the
  // drag handle, without each view having to change its header markup.
  const decorateHeader = useCallback(
    (th: React.ReactNode, id: string, width?: number): React.ReactNode => {
      if (!React.isValidElement(th)) return th;
      const el = th as React.ReactElement<{
        className?: string;
        style?: React.CSSProperties;
        children?: React.ReactNode;
      }>;
      const style: React.CSSProperties = width
        ? { width, minWidth: width, maxWidth: width, ...(el.props.style ?? {}) }
        : el.props.style ?? {};
      const className = `${el.props.className ?? ''} resizable-th`.trim();
      return React.cloneElement(
        el,
        { className, style },
        el.props.children,
        <span
          key="__resizer"
          className="col-resizer"
          onMouseDown={(ev) => startResize(ev, id)}
          onClick={(ev) => ev.stopPropagation()}
          aria-hidden
        />,
      );
    },
    [startResize],
  );

  return { startResize, decorateHeader };
}
