import React from 'react';

interface Props {
  // Data columns to fill with a placeholder bar.
  cells: number;
  rows?: number;
  // Trailing auto-width filler cell (tables using useColumnResize).
  filler?: boolean;
  // Trailing sticky actions cell.
  actions?: boolean;
}

// Varied, deterministic bar widths so the placeholder reads like real data
// (a long name first, shorter values after) rather than a striped grid.
const WIDTHS = [78, 46, 62, 38, 70, 52, 34, 58];

// Shimmering placeholder rows shown while a list loads, in place of the
// table body — the page chrome and column headers are already real.
const SkeletonRows: React.FC<Props> = ({ cells, rows = 8, filler, actions }) => (
  <>
    {Array.from({ length: rows }, (_, r) => (
      <tr key={r} className="skeleton-row" aria-hidden>
        {Array.from({ length: cells }, (_, c) => (
          <td key={c}>
            <span
              className="skeleton-bar"
              style={{ width: `${c === 0 ? 60 + ((r * 7) % 30) : WIDTHS[(r + c) % WIDTHS.length]}%` }}
            />
          </td>
        ))}
        {filler && <td className="col-filler" />}
        {actions && (
          <td className="actions actions-sticky">
            <span className="skeleton-bar skeleton-actions" />
          </td>
        )}
      </tr>
    ))}
  </>
);

export default SkeletonRows;

// A whole placeholder table — real column headers, shimmering body — for
// lists that only render their card once they have rows (report / email
// history), so the first load still shows the shape of what's coming.
export const SkeletonTable: React.FC<{ headers: string[]; actionsHeader?: string }> = ({
  headers,
  actionsHeader,
}) => (
  <div className="table-wrap">
    <table className="table">
      <thead>
        <tr>
          {headers.map((h) => (
            <th key={h}>{h}</th>
          ))}
          {actionsHeader !== undefined && (
            <th className="actions actions-sticky">{actionsHeader}</th>
          )}
        </tr>
      </thead>
      <tbody>
        <SkeletonRows cells={headers.length} actions={actionsHeader !== undefined} />
      </tbody>
    </table>
  </div>
);
