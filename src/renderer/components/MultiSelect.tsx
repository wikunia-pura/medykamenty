import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../i18n';
import { IconCheck, IconSearch, IconClose } from './Icons';

export interface MultiSelectOption {
  value: string;
  label: string;
  hint?: string;
}

interface Props {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  selectAllLabel?: string;
  clearLabel?: string;
  selectedCountLabel?: string;
  width?: number | string;
}

const POPOVER_MAX_HEIGHT = 360;

const MultiSelect: React.FC<Props> = ({
  options,
  selected,
  onChange,
  placeholder,
  selectAllLabel,
  clearLabel,
  selectedCountLabel,
  width,
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q),
    );
  }, [options, query]);

  const selectedOptions = useMemo(
    () => options.filter((o) => selected.includes(o.value)),
    [options, selected],
  );

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
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target))
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

  const toggle = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );
  };

  const removeChip = (e: React.MouseEvent, value: string) => {
    e.stopPropagation();
    onChange(selected.filter((v) => v !== value));
  };

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((o) => selected.includes(o.value));
  const toggleAll = () => {
    if (allFilteredSelected) {
      const ids = new Set(filtered.map((o) => o.value));
      onChange(selected.filter((v) => !ids.has(v)));
    } else {
      const next = new Set(selected);
      filtered.forEach((o) => next.add(o.value));
      onChange(Array.from(next));
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="searchable-select-trigger"
        style={{ width }}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="multi-select-trigger-content">
          {selectedOptions.length > 0 ? (
            <>
              <span className="multi-select-chips">
                {selectedOptions.map((o) => (
                  <span key={o.value} className="multi-select-chip">
                    <span className="multi-select-chip-label">{o.label}</span>
                    <button
                      type="button"
                      className="multi-select-chip-remove"
                      onClick={(e) => removeChip(e, o.value)}
                      aria-label="remove"
                    >
                      <IconClose size={10} />
                    </button>
                  </span>
                ))}
              </span>
              <span className="multi-select-trigger-count">
                {selectedOptions.length}
                {selectedCountLabel ? ` ${selectedCountLabel}` : ''}
              </span>
            </>
          ) : (
            <span className="searchable-select-value placeholder">
              {placeholder ?? t.search}
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
                placeholder={placeholder ?? t.search}
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
            <div className="multi-select-toolbar">
              <button
                type="button"
                className="multi-select-toolbar-btn"
                onClick={toggleAll}
                disabled={filtered.length === 0}
              >
                {allFilteredSelected ? clearLabel ?? 'Clear' : selectAllLabel ?? 'Select all'}
              </button>
              <span className="multi-select-toolbar-count hint">
                {selected.length} {selectedCountLabel ?? 'selected'}
              </span>
            </div>
            <div className="multi-select-list">
              {filtered.length === 0 && (
                <div className="searchable-select-empty hint">{t.noData}</div>
              )}
              {filtered.map((o) => {
                const isSel = selected.includes(o.value);
                return (
                  <div
                    key={o.value}
                    className={`multi-select-row${isSel ? ' selected' : ''}`}
                    onClick={() => toggle(o.value)}
                  >
                    <span className={`multi-select-checkbox${isSel ? ' checked' : ''}`}>
                      {isSel && <IconCheck size={11} />}
                    </span>
                    <span className="multi-select-row-name">
                      {o.label}
                      {o.hint && (
                        <span className="searchable-select-hint">{o.hint}</span>
                      )}
                    </span>
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

export default MultiSelect;
