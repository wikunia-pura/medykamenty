import React, { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import type { StockRow, MatchSuggestion } from '../../shared/types';
import { useEscapeKey } from '../utils/useEscapeKey';
import ModalHeader from './ModalHeader';
import { IconPlus, IconTrash } from './Icons';
import type { ResolveAction } from './UnmatchedRowModal';

// Per-row resolution choice in the bulk view. `targetId` is `null` when the
// user wants to add the row as a new catalog entry — there's no existing
// target to point at.
type ActionType = 'add-new' | 'use-once' | 'save-alias' | 'rename-existing';

interface RowChoice {
  suggestions: MatchSuggestion[] | null;
  targetId: string | null;
  action: ActionType;
}

interface Props {
  rows: StockRow[];
  kind: 'raw' | 'component';
  busy?: boolean;
  onApply: (decisions: { row: StockRow; action: ResolveAction }[]) => void;
  onCancel: () => void;
}

const ACTION_LABELS: Record<ActionType, keyof ReturnType<typeof useT>> = {
  'add-new': 'resolveRowActionAddNew',
  'use-once': 'resolveRowActionUseOnce',
  'save-alias': 'resolveRowActionSaveAlias',
  'rename-existing': 'resolveRowActionRename',
};

const BulkUnmatchedModal: React.FC<Props> = ({ rows, kind, busy, onApply, onCancel }) => {
  const t = useT();
  useEscapeKey(onCancel);

  // `choices` is keyed by rowKey. Each row gets a single decision the user
  // can tweak before pressing "Apply all".
  const [choices, setChoices] = useState<Record<string, RowChoice>>(() => {
    const out: Record<string, RowChoice> = {};
    for (const r of rows) {
      out[r.rowKey] = { suggestions: null, targetId: null, action: 'add-new' };
    }
    return out;
  });
  // Rows the user explicitly skipped via the per-row trash button — left in
  // the snapshot as unmatched, not part of `onApply`.
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  // Fetch suggestions for every row once on mount. Concurrent fan-out keeps
  // perceived latency low; the suggestions are independent of each other.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        rows.map((r) =>
          window.electronAPI
            .suggestStockMatches(kind, { name: r.name, mpFirmaSymbol: r.mpFirmaSymbol }, 3)
            .catch(() => [] as MatchSuggestion[]),
        ),
      );
      if (cancelled) return;
      setChoices((prev) => {
        const next = { ...prev };
        rows.forEach((r, i) => {
          const top = results[i][0];
          next[r.rowKey] = {
            suggestions: results[i],
            // Auto-pre-pick the top suggestion only if it's strong; otherwise
            // default to "add as new" so the user isn't nudged into a bad map.
            targetId: top && top.confidence >= 0.75 ? top.id : null,
            action: top && top.confidence >= 0.75 ? 'save-alias' : 'add-new',
          };
        });
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [rows, kind]);

  const setRowAction = (rowKey: string, action: ActionType) => {
    setChoices((prev) => {
      const cur = prev[rowKey];
      const next = { ...cur, action };
      // Switching to "add-new" clears the target; switching to anything else
      // requires a target, so auto-pick the top suggestion if none picked.
      if (action === 'add-new') {
        next.targetId = null;
      } else if (!next.targetId && cur.suggestions && cur.suggestions.length > 0) {
        next.targetId = cur.suggestions[0].id;
      }
      return { ...prev, [rowKey]: next };
    });
  };

  const setRowTarget = (rowKey: string, targetId: string) => {
    setChoices((prev) => {
      const cur = prev[rowKey];
      const next: RowChoice = { ...cur, targetId };
      // If user picks a real suggestion while action was "add-new", flip to a
      // sensible default that uses the target.
      if (cur.action === 'add-new') {
        next.action = 'save-alias';
      }
      return { ...prev, [rowKey]: next };
    });
  };

  const toggleSkip = (rowKey: string) => {
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  };

  const handleApply = () => {
    const decisions: { row: StockRow; action: ResolveAction }[] = [];
    for (const row of rows) {
      if (skipped.has(row.rowKey)) continue;
      const c = choices[row.rowKey];
      if (!c) continue;
      if (c.action === 'add-new') {
        decisions.push({ row, action: { type: 'add-new' } });
      } else if (c.targetId) {
        decisions.push({ row, action: { type: c.action, targetId: c.targetId } });
      }
    }
    onApply(decisions);
  };

  // Summary counts for the apply button — helps the user see at a glance what
  // they're about to do, especially that "rename" is a non-trivial action.
  const summary = useMemo(() => {
    const s = { addNew: 0, useOnce: 0, saveAlias: 0, rename: 0, skipped: skipped.size };
    for (const row of rows) {
      if (skipped.has(row.rowKey)) continue;
      const c = choices[row.rowKey];
      if (!c) continue;
      if (c.action === 'add-new') s.addNew++;
      else if (c.action === 'use-once') s.useOnce++;
      else if (c.action === 'save-alias') s.saveAlias++;
      else if (c.action === 'rename-existing') s.rename++;
    }
    return s;
  }, [rows, choices, skipped]);

  const applyCount =
    summary.addNew + summary.useOnce + summary.saveAlias + summary.rename;

  // Bulk shortcut: change every still-unset (default add-new with no top
  // suggestion) plus every row to a single action. Used by the "set all to…"
  // selector to speed up bulk decisions.
  const setAllAction = (action: ActionType) => {
    setChoices((prev) => {
      const next = { ...prev };
      for (const row of rows) {
        const cur = next[row.rowKey];
        if (!cur) continue;
        if (action === 'add-new') {
          next[row.rowKey] = { ...cur, action: 'add-new', targetId: null };
        } else {
          const hasSuggestion = cur.suggestions && cur.suggestions.length > 0;
          next[row.rowKey] = {
            ...cur,
            action: hasSuggestion ? action : 'add-new',
            targetId: hasSuggestion
              ? cur.targetId ?? cur.suggestions![0].id
              : null,
          };
        }
      }
      return next;
    });
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal modal-lg bulk-resolve-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <ModalHeader
          icon={<IconPlus size={18} />}
          tone="add"
          title={t.bulkResolveTitle.replace('{n}', String(rows.length))}
          subtitle={
            kind === 'raw' ? t.resolveRowSubtitleRaw : t.resolveRowSubtitleComponent
          }
          onClose={onCancel}
        />
        <div className="modal-body">
          <div className="bulk-toolbar">
            <span className="hint">{t.bulkSetAll}</span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setAllAction('save-alias')}
            >
              {t.resolveRowActionSaveAlias}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setAllAction('use-once')}
            >
              {t.resolveRowActionUseOnce}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setAllAction('add-new')}
            >
              {t.resolveRowActionAddNew}
            </button>
          </div>

          <div className="table-wrap bulk-resolve-table-wrap">
            <table className="table bulk-resolve-table">
              <thead>
                <tr>
                  <th className="bulk-col-import">{t.resolveRowFromImport}</th>
                  <th className="bulk-col-target">{t.bulkColMapTo}</th>
                  <th className="bulk-col-action">{t.bulkColAction}</th>
                  <th className="bulk-col-skip">&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const c = choices[row.rowKey];
                  const isSkipped = skipped.has(row.rowKey);
                  const sug = c?.suggestions ?? null;
                  return (
                    <tr
                      key={row.rowKey}
                      className={`bulk-row ${isSkipped ? 'is-skipped' : ''}`}
                    >
                      <td className="bulk-col-import">
                        <div className="bulk-import-name">{row.name}</div>
                        {row.mpFirmaSymbol && (
                          <div className="bulk-import-sym">{row.mpFirmaSymbol}</div>
                        )}
                      </td>
                      <td className="bulk-col-target">
                        {sug === null ? (
                          <span className="hint">…</span>
                        ) : sug.length === 0 ? (
                          <span className="hint">—</span>
                        ) : (
                          <select
                            className="input"
                            value={c?.targetId ?? ''}
                            disabled={isSkipped}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v) setRowTarget(row.rowKey, v);
                            }}
                          >
                            {!c?.targetId && (
                              <option value="">{t.bulkPickTarget}</option>
                            )}
                            {sug.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name} — {Math.round(s.confidence * 100)}%
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="bulk-col-action">
                        <select
                          className="input"
                          value={c?.action ?? 'add-new'}
                          disabled={isSkipped}
                          onChange={(e) =>
                            setRowAction(row.rowKey, e.target.value as ActionType)
                          }
                        >
                          <option value="add-new">{t[ACTION_LABELS['add-new']]}</option>
                          {c?.targetId && (
                            <>
                              <option value="use-once">
                                {t[ACTION_LABELS['use-once']]}
                              </option>
                              <option value="save-alias">
                                {t[ACTION_LABELS['save-alias']]}
                              </option>
                              <option value="rename-existing">
                                {t[ACTION_LABELS['rename-existing']]}
                              </option>
                            </>
                          )}
                        </select>
                      </td>
                      <td className="bulk-col-skip">
                        <button
                          type="button"
                          className={`btn btn-sm ${isSkipped ? 'soft-warn' : 'soft-danger'}`}
                          onClick={() => toggleSkip(row.rowKey)}
                          title={isSkipped ? t.bulkUnskip : t.bulkSkipRow}
                        >
                          <IconTrash size={12} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="bulk-summary">
            {summary.addNew > 0 && (
              <span className="tag">
                {t.resolveRowActionAddNew}: <strong>{summary.addNew}</strong>
              </span>
            )}
            {summary.saveAlias > 0 && (
              <span className="tag success">
                {t.resolveRowActionSaveAlias}: <strong>{summary.saveAlias}</strong>
              </span>
            )}
            {summary.useOnce > 0 && (
              <span className="tag">
                {t.resolveRowActionUseOnce}: <strong>{summary.useOnce}</strong>
              </span>
            )}
            {summary.rename > 0 && (
              <span className="tag warn">
                {t.resolveRowActionRename}: <strong>{summary.rename}</strong>
              </span>
            )}
            {summary.skipped > 0 && (
              <span className="tag danger">
                {t.bulkSkipped}: <strong>{summary.skipped}</strong>
              </span>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onCancel}>
            {t.cancel}
          </button>
          <button
            type="button"
            className="btn primary-filled"
            disabled={busy || applyCount === 0}
            onClick={handleApply}
          >
            {t.bulkApplyAll.replace('{n}', String(applyCount))}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BulkUnmatchedModal;
