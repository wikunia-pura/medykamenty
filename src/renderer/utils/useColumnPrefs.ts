import { useCallback, useEffect, useMemo, useState } from 'react';

export interface ColumnDef {
  id: string;
  label: string;
  /** Default visibility when no saved preference exists. */
  defaultVisible?: boolean;
  /** If true, column cannot be hidden. Required columns can still be reordered. */
  required?: boolean;
}

interface StoredPrefs {
  visible: string[];
  order: string[];
  // Per-column pixel widths the user set by dragging the column border. Columns
  // absent here fall back to their CSS default width (col-w-* class).
  widths: Record<string, number>;
}

// Smallest a column may be dragged to, in px.
export const MIN_COLUMN_WIDTH = 48;

const STORAGE_PREFIX = 'cutis.columns.';

const loadPrefs = (key: string): StoredPrefs | null => {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Legacy format: bare string[] of visible ids — keep default order.
    if (Array.isArray(parsed)) {
      const visible = parsed.filter((x): x is string => typeof x === 'string');
      return { visible, order: [], widths: {} };
    }
    if (parsed && typeof parsed === 'object') {
      const visible = Array.isArray(parsed.visible)
        ? parsed.visible.filter((x: unknown): x is string => typeof x === 'string')
        : [];
      const order = Array.isArray(parsed.order)
        ? parsed.order.filter((x: unknown): x is string => typeof x === 'string')
        : [];
      const widths: Record<string, number> = {};
      if (parsed.widths && typeof parsed.widths === 'object') {
        for (const [k, v] of Object.entries(parsed.widths as Record<string, unknown>)) {
          if (typeof v === 'number' && Number.isFinite(v) && v > 0) widths[k] = v;
        }
      }
      return { visible, order, widths };
    }
    return null;
  } catch {
    return null;
  }
};

const savePrefs = (key: string, prefs: StoredPrefs) => {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(prefs));
  } catch {
    /* ignore quota errors */
  }
};

const initialVisible = (columns: ColumnDef[], saved: StoredPrefs | null): Set<string> => {
  if (saved?.visible.length) {
    const next = new Set(saved.visible);
    for (const c of columns) if (c.required) next.add(c.id);
    return next;
  }
  return new Set(
    columns.filter((c) => c.required || c.defaultVisible !== false).map((c) => c.id),
  );
};

const initialOrder = (columns: ColumnDef[], saved: StoredPrefs | null): string[] => {
  const known = new Set(columns.map((c) => c.id));
  if (saved?.order.length) {
    // Filter saved order to only existing columns, then append any new columns
    // (added since the prefs were last saved) at the end in their natural order.
    const ordered = saved.order.filter((id) => known.has(id));
    const seen = new Set(ordered);
    for (const c of columns) if (!seen.has(c.id)) ordered.push(c.id);
    return ordered;
  }
  return columns.map((c) => c.id);
};

export function useColumnPrefs(viewKey: string, columns: ColumnDef[]) {
  const [visible, setVisible] = useState<Set<string>>(() =>
    initialVisible(columns, loadPrefs(viewKey)),
  );
  const [order, setOrder] = useState<string[]>(() =>
    initialOrder(columns, loadPrefs(viewKey)),
  );
  const [widths, setWidths] = useState<Record<string, number>>(
    () => loadPrefs(viewKey)?.widths ?? {},
  );

  // If new columns are introduced after the user already has saved prefs,
  // append them so they're not invisible to the picker.
  useEffect(() => {
    setOrder((prev) => {
      const known = new Set(columns.map((c) => c.id));
      const filtered = prev.filter((id) => known.has(id));
      const seen = new Set(filtered);
      const next = [...filtered];
      for (const c of columns) if (!seen.has(c.id)) next.push(c.id);
      return next.length === prev.length && next.every((id, i) => id === prev[i])
        ? prev
        : next;
    });
  }, [columns]);

  useEffect(() => {
    savePrefs(viewKey, { visible: [...visible], order, widths });
  }, [viewKey, visible, order, widths]);

  const toggle = useCallback(
    (id: string) => {
      setVisible((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        for (const c of columns) if (c.required) next.add(c.id);
        return next;
      });
    },
    [columns],
  );

  const reorder = useCallback((fromIndex: number, toIndex: number) => {
    setOrder((prev) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= prev.length ||
        toIndex >= prev.length ||
        fromIndex === toIndex
      ) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  // Set an explicit pixel width for a column (from dragging its border).
  const setWidth = useCallback((id: string, px: number) => {
    setWidths((prev) => {
      const next = Math.max(MIN_COLUMN_WIDTH, Math.round(px));
      if (prev[id] === next) return prev;
      return { ...prev, [id]: next };
    });
  }, []);

  // Drop a column's explicit width → it falls back to the CSS default.
  const resetWidth = useCallback((id: string) => {
    setWidths((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const resetWidths = useCallback(() => setWidths({}), []);

  const reset = useCallback(() => {
    setVisible(initialVisible(columns, null));
    setOrder(columns.map((c) => c.id));
    setWidths({});
  }, [columns]);

  const isVisible = useCallback((id: string) => visible.has(id), [visible]);

  // Columns in user-chosen order; consumers typically render header/cell loops over this.
  const orderedColumns = useMemo(() => {
    const byId = new Map(columns.map((c) => [c.id, c]));
    return order.map((id) => byId.get(id)).filter((c): c is ColumnDef => !!c);
  }, [columns, order]);

  // Just the visible ids in order — the most common iteration target for table rendering.
  const orderedVisibleIds = useMemo(
    () => orderedColumns.filter((c) => visible.has(c.id)).map((c) => c.id),
    [orderedColumns, visible],
  );

  return {
    visible,
    isVisible,
    toggle,
    reorder,
    reset,
    widths,
    setWidth,
    resetWidth,
    resetWidths,
    orderedColumns,
    orderedVisibleIds,
  };
}
