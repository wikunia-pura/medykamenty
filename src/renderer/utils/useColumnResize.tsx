import React, { useCallback, useState } from 'react';
import { MIN_COLUMN_WIDTH, type ColumnSort } from './useColumnPrefs';
import { IconChevronDown } from '../components/Icons';

interface SortControl {
  sort: ColumnSort | null;
  toggleSort: (id: string) => void;
}

// Clicks on these inside a header cell do their own thing, never a sort.
const HEADER_INTERACTIVE = 'button, input, select, textarea, a, label, .col-resizer';

// Column resizing (and, when given a SortControl, header-click sorting) for the
// data tables that use useColumnPrefs. Each resizable header cell gets a drag
// handle on its right border; dragging updates the column's persisted pixel
// width (see useColumnPrefs.setWidth). Widths are applied inline (width + min +
// max) so they hold under the tables' default `table-layout: auto` — a column
// can't be dragged narrower than its content, which is the expected
// spreadsheet-like behaviour. For the border to follow the cursor 1:1 the table
// needs a trailing `col-filler` cell that soaks up the spare width; without
// it the browser spreads the slack over the sized columns and the border lags.
export function useColumnResize(setWidth: (id: string, px: number) => void, sorting?: SortControl) {
  // Column being dragged — only its grip is highlighted while the cursor runs
  // across other headers.
  const [activeId, setActiveId] = useState<string | null>(null);

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
        setActiveId(null);
        // The click that follows this mouseup lands on whichever header the
        // drag ended over — swallow it so finishing a resize never sorts.
        const swallow = (ev: MouseEvent) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        window.addEventListener('click', swallow, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener('click', swallow, true), 0);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.body.classList.add('col-resizing');
      setActiveId(id);
    },
    [setWidth],
  );

  // Wrap a view's existing <th> node: apply the persisted width, make it a sort
  // toggle and append the drag handle, without each view having to change its
  // header markup.
  const decorateHeader = useCallback(
    (th: React.ReactNode, id: string, width?: number): React.ReactNode => {
      if (!React.isValidElement(th)) return th;
      const el = th as React.ReactElement<{
        className?: string;
        style?: React.CSSProperties;
        children?: React.ReactNode;
        onClick?: React.MouseEventHandler<HTMLElement>;
        'aria-sort'?: React.AriaAttributes['aria-sort'];
      }>;
      const style: React.CSSProperties = width
        ? { width, minWidth: width, maxWidth: width, ...(el.props.style ?? {}) }
        : (el.props.style ?? {});
      const dir = sorting?.sort?.id === id ? sorting.sort.dir : null;
      const classes = [el.props.className, 'resizable-th'];
      if (sorting) classes.push('sortable-th');
      if (dir) classes.push('is-sorted');
      const props: typeof el.props = {
        className: classes.filter(Boolean).join(' '),
        style,
      };
      if (sorting) {
        props.onClick = (ev) => {
          if ((ev.target as HTMLElement).closest(HEADER_INTERACTIVE)) return;
          sorting.toggleSort(id);
        };
        props['aria-sort'] = dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none';
      }
      return React.cloneElement(
        el,
        props,
        el.props.children,
        sorting ? (
          <span key="__sort" className={`sort-indicator${dir ? ` is-${dir}` : ''}`} aria-hidden>
            <IconChevronDown size={12} />
          </span>
        ) : null,
        <span
          key="__resizer"
          className={`col-resizer${activeId === id ? ' is-active' : ''}`}
          onMouseDown={(ev) => startResize(ev, id)}
          onClick={(ev) => ev.stopPropagation()}
          aria-hidden
        />,
      );
    },
    [startResize, activeId, sorting],
  );

  return { startResize, decorateHeader };
}
