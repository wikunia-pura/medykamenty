import React, { useEffect, useState } from 'react';
import { useT } from '../i18n';
import type { StockRow, MatchSuggestion } from '../../shared/types';
import { useEscapeKey } from '../utils/useEscapeKey';
import ModalHeader from './ModalHeader';
import { IconPlus } from './Icons';

export type ResolveAction =
  | { type: 'use-once'; targetId: string }
  | { type: 'save-alias'; targetId: string }
  | { type: 'rename-existing'; targetId: string }
  | { type: 'add-new' };

interface Props {
  row: StockRow;
  kind: 'raw' | 'component';
  /** 1-based position when iterating multiple rows; omit for single-row mode. */
  position?: { index: number; total: number };
  busy?: boolean;
  onResolve: (action: ResolveAction) => void;
  onSkip?: () => void;
  onCancel: () => void;
}

const UnmatchedRowModal: React.FC<Props> = ({
  row,
  kind,
  position,
  busy,
  onResolve,
  onSkip,
  onCancel,
}) => {
  const t = useT();
  useEscapeKey(onCancel);
  const [suggestions, setSuggestions] = useState<MatchSuggestion[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSuggestions(null);
    setSelectedId(null);
    void window.electronAPI
      .suggestStockMatches(kind, { name: row.name, mpFirmaSymbol: row.mpFirmaSymbol }, 3)
      .then((s) => {
        if (cancelled) return;
        setSuggestions(s);
        if (s.length > 0) setSelectedId(s[0].id);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [row.rowKey, row.name, row.mpFirmaSymbol, kind]);

  const selected = suggestions?.find((s) => s.id === selectedId) ?? null;
  const importName = row.name;
  const catalogName = selected?.name ?? '';

  const interpolate = (template: string) =>
    template.replace('{import}', importName).replace('{catalog}', catalogName);

  const handleRename = () => {
    if (!selected) return;
    if (!confirm(interpolate(t.resolveRowRenameConfirm))) return;
    onResolve({ type: 'rename-existing', targetId: selected.id });
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <ModalHeader
          icon={<IconPlus size={18} />}
          tone="add"
          title={t.resolveRowTitle}
          subtitle={
            kind === 'raw' ? t.resolveRowSubtitleRaw : t.resolveRowSubtitleComponent
          }
          onClose={onCancel}
        />
        <div className="modal-body">
          {position && (
            <div className="resolve-progress">
              {t.resolveRowProgress
                .replace('{n}', String(position.index))
                .replace('{total}', String(position.total))}
            </div>
          )}

          <div className="resolve-import-banner">
            <span className="resolve-banner-label">{t.resolveRowFromImport}</span>
            <div className="resolve-banner-value">
              <span className="resolve-banner-name">{row.name}</span>
              {row.mpFirmaSymbol && (
                <span className="resolve-banner-symbol">{row.mpFirmaSymbol}</span>
              )}
            </div>
          </div>

          <div className="resolve-section-label">{t.resolveRowSuggestions}</div>
          <div className="resolve-suggestions">
            {suggestions === null && <div className="hint">…</div>}
            {suggestions !== null && suggestions.length === 0 && (
              <div className="resolve-no-suggestions">{t.resolveRowNoSuggestions}</div>
            )}
            {suggestions?.map((s) => {
              const isActive = s.id === selectedId;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  className={`resolve-suggestion ${isActive ? 'is-selected' : ''}`}
                >
                  <span className="resolve-suggestion-radio" aria-hidden>
                    {isActive ? '●' : '○'}
                  </span>
                  <span className="resolve-suggestion-name">{s.name}</span>
                  <span
                    className={`resolve-suggestion-score ${
                      s.confidence >= 0.85 ? 'high' : s.confidence >= 0.7 ? 'mid' : 'low'
                    }`}
                  >
                    {Math.round(s.confidence * 100)}%
                  </span>
                </button>
              );
            })}
          </div>

          <div className="resolve-divider" aria-hidden />
          <div className="resolve-section-heading">{t.resolveRowPickAction}</div>
          <div className="resolve-actions">
            {selected && (
              <>
                <button
                  type="button"
                  className="resolve-action resolve-action-primary"
                  disabled={busy}
                  onClick={() => onResolve({ type: 'use-once', targetId: selected.id })}
                >
                  <div className="resolve-action-title">{t.resolveRowActionUseOnce}</div>
                  <div className="resolve-action-arrow">
                    {row.name} → <strong>{selected.name}</strong>
                  </div>
                  <div className="resolve-action-hint">{t.resolveRowActionUseOnceHint}</div>
                </button>

                <button
                  type="button"
                  className="resolve-action resolve-action-success"
                  disabled={busy}
                  onClick={() => onResolve({ type: 'save-alias', targetId: selected.id })}
                >
                  <div className="resolve-action-title">{t.resolveRowActionSaveAlias}</div>
                  <div className="resolve-action-arrow">
                    alias <strong>{row.name}</strong> = <strong>{selected.name}</strong>
                  </div>
                  <div className="resolve-action-hint">
                    {interpolate(t.resolveRowActionSaveAliasHint)}
                  </div>
                </button>

                <button
                  type="button"
                  className="resolve-action resolve-action-warn"
                  disabled={busy}
                  onClick={handleRename}
                >
                  <div className="resolve-action-title">{t.resolveRowActionRename}</div>
                  <div className="resolve-action-arrow">
                    <strong>{selected.name}</strong> → <strong>{row.name}</strong>
                  </div>
                  <div className="resolve-action-hint">
                    {interpolate(t.resolveRowActionRenameHint)}
                  </div>
                </button>
              </>
            )}

            <button
              type="button"
              className="resolve-action resolve-action-neutral"
              disabled={busy}
              onClick={() => onResolve({ type: 'add-new' })}
            >
              <div className="resolve-action-title">
                <IconPlus size={13} /> {t.resolveRowActionAddNew}
              </div>
              <div className="resolve-action-arrow">
                {kind === 'raw' ? t.rawMaterials : t.components}: <strong>{row.name}</strong>
              </div>
              <div className="resolve-action-hint">{t.resolveRowActionAddNewHint}</div>
            </button>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onCancel}>
            {t.cancel}
          </button>
          {onSkip && (
            <button type="button" className="btn" onClick={onSkip} disabled={busy}>
              {t.resolveRowSkip}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default UnmatchedRowModal;
