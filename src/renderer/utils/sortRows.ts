import type { ColumnSort } from './useColumnPrefs';

export type SortValue = string | number | boolean | null | undefined;

const isEmpty = (v: SortValue) => v === null || v === undefined || v === '';

function compareValues(a: SortValue, b: SortValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return String(a).localeCompare(String(b), 'pl', { numeric: true, sensitivity: 'base' });
}

// Rows ordered by one column's value for a header-click sort. Empty values
// (no price, no supplier…) always go last, in both directions, so flipping the
// order never buries the filled-in rows under a block of blanks. The sort is
// stable, and `sort === null` returns the rows in their natural order.
export function sortRows<T>(
  rows: T[],
  sort: ColumnSort | null,
  valueFor: (id: string, row: T) => SortValue,
): T[] {
  if (!sort) return rows;
  const factor = sort.dir === 'asc' ? 1 : -1;
  return rows
    .map((row) => ({ row, value: valueFor(sort.id, row) }))
    .sort((a, b) => {
      const aEmpty = isEmpty(a.value);
      const bEmpty = isEmpty(b.value);
      if (aEmpty || bEmpty) return Number(aEmpty) - Number(bEmpty);
      return compareValues(a.value, b.value) * factor;
    })
    .map((x) => x.row);
}
