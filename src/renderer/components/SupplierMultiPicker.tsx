import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Supplier } from '../../shared/types';
import { useT } from '../i18n';
import { IconStar, IconSearch, IconClose } from './Icons';

interface Props {
  suppliers: Supplier[];
  selectedIds: string[];
  preferredId?: string;
  onChange: (ids: string[], preferred?: string) => void;
}

const POPOVER_MAX_HEIGHT = 360;

const SupplierMultiPicker: React.FC<Props> = ({
  suppliers,
  selectedIds,
  preferredId,
  onChange,
}) => {
  const t = useT();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [coords, setCoords] = useState<{ left: number; top: number; width: number } | null>(
    null,
  );

  // Always sort alphabetically — star/selection does NOT change order, so a
  // user-toggled "preferred" never makes the row jump around in the list.
  const sortedSuppliers = useMemo(
    () => [...suppliers].sort((a, b) => a.name.localeCompare(b.name)),
    [suppliers],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sortedSuppliers;
    return sortedSuppliers.filter((s) => s.name.toLowerCase().includes(q));
  }, [sortedSuppliers, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const placeBelow = spaceBelow >= 240 || spaceBelow >= spaceAbove;
      const top = placeBelow
        ? rect.bottom + 4
        : Math.max(8, rect.top - 4 - POPOVER_MAX_HEIGHT);
      setCoords({ left: rect.left, top, width: rect.width });
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

  const toggle = (id: string) => {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((s) => s !== id)
      : [...selectedIds, id];
    const nextPreferred =
      preferredId && next.includes(preferredId) ? preferredId : next[0];
    onChange(next, nextPreferred);
  };

  const removeChip = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const next = selectedIds.filter((s) => s !== id);
    const nextPreferred =
      preferredId && next.includes(preferredId) ? preferredId : next[0];
    onChange(next, nextPreferred);
  };

  const setPreferred = (id: string) => {
    if (!selectedIds.includes(id)) {
      onChange([...selectedIds, id], id);
    } else {
      onChange(selectedIds, id);
    }
  };

  const selectedSummary = useMemo(() => {
    if (selectedIds.length === 0) return null;
    // Preserve the alphabetical order in the trigger summary.
    return sortedSuppliers.filter((s) => selectedIds.includes(s.id));
  }, [sortedSuppliers, selectedIds]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="searchable-select-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="supplier-picker-trigger-content">
          {selectedSummary && selectedSummary.length > 0 ? (
            <span className="supplier-picker-chips">
              {selectedSummary.map((s) => (
                <span
                  key={s.id}
                  className={`supplier-chip removable${s.id === preferredId ? ' preferred' : ''}`}
                >
                  {s.id === preferredId && (
                    <IconStar size={10} className="supplier-chip-star" />
                  )}
                  <span className="supplier-chip-label">{s.name}</span>
                  <button
                    type="button"
                    className="supplier-chip-remove"
                    onClick={(e) => removeChip(e, s.id)}
                    aria-label="remove"
                  >
                    <IconClose size={10} />
                  </button>
                </span>
              ))}
            </span>
          ) : (
            <span className="searchable-select-value placeholder">
              {t.selectSupplier}
            </span>
          )}
        </span>
        <span className="searchable-select-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open &&
        coords &&
        createPortal(
          <div
            ref={popoverRef}
            className="searchable-select-popover"
            style={{
              left: coords.left,
              top: coords.top,
              width: Math.max(coords.width, 280),
            }}
          >
            <div className="searchable-select-search">
              <span className="searchable-select-search-icon">
                <IconSearch size={14} />
              </span>
              <input
                ref={inputRef}
                type="text"
                className="searchable-select-input"
                placeholder={t.search}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  type="button"
                  className="searchable-select-clear"
                  onClick={() => {
                    setQuery('');
                    inputRef.current?.focus();
                  }}
                  aria-label="clear"
                >
                  <IconClose size={12} />
                </button>
              )}
            </div>
            <div className="supplier-picker-list">
              {filtered.length === 0 && (
                <div className="supplier-picker-empty hint">{t.noData}</div>
              )}
              {filtered.map((s) => {
                const isSelected = selectedIds.includes(s.id);
                const isPreferred = preferredId === s.id;
                return (
                  <div
                    key={s.id}
                    className={`supplier-picker-row${isSelected ? ' selected' : ''}`}
                    onClick={() => toggle(s.id)}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggle(s.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className="supplier-picker-name">{s.name}</span>
                    {isSelected && (
                      <button
                        type="button"
                        className={`supplier-picker-star${isPreferred ? ' active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreferred(s.id);
                        }}
                        title={t.preferredSupplier}
                        aria-label={t.preferredSupplier}
                      >
                        <IconStar size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="supplier-picker-footer hint">
              {selectedIds.length} / {suppliers.length}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
};

export default SupplierMultiPicker;
