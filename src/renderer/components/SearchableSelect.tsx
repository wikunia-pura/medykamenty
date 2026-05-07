import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../i18n';
import { IconCheck, IconSearch, IconClose } from './Icons';

export interface SearchableSelectOption {
  value: string;
  label: string;
  hint?: string;
}

interface FooterAction {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
}

interface Props {
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  width?: number | string;
  /** Optional clickable row rendered at the bottom of the popover (e.g. "Add new"). */
  footerAction?: FooterAction;
}

const DROPDOWN_MAX_HEIGHT = 280;

const SearchableSelect: React.FC<Props> = ({
  options,
  value,
  onChange,
  placeholder,
  disabled,
  width,
  footerAction,
}) => {
  const t = useT();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [coords, setCoords] = useState<{ left: number; top: number; width: number } | null>(
    null,
  );

  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.hint ?? '').toLowerCase().includes(q),
    );
  }, [options, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      const idx = Math.max(
        0,
        options.findIndex((o) => o.value === value),
      );
      setActiveIdx(idx);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open, options, value]);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const placeBelow = spaceBelow >= 200 || spaceBelow >= spaceAbove;
      const top = placeBelow
        ? rect.bottom + 4
        : Math.max(8, rect.top - 4 - DROPDOWN_MAX_HEIGHT);
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
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  // Keep the active row scrolled into view.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const child = list?.children[activeIdx] as HTMLElement | undefined;
    if (!list || !child) return;
    const top = child.offsetTop;
    const bottom = top + child.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight)
      list.scrollTop = bottom - list.clientHeight;
  }, [activeIdx, open]);

  const pick = (val: string) => {
    onChange(val);
    setOpen(false);
  };

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = filtered[activeIdx];
      if (opt) pick(opt.value);
    }
  };

  const onTriggerKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="searchable-select-trigger"
        disabled={disabled}
        style={{ width }}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={onTriggerKey}
      >
        <span className={`searchable-select-value${selected ? '' : ' placeholder'}`}>
          {selected ? (
            <>
              {selected.label}
              {selected.hint && (
                <span className="searchable-select-hint">{selected.hint}</span>
              )}
            </>
          ) : (
            placeholder ?? t.search
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
              width: Math.max(coords.width, 240),
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
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIdx(0);
                }}
                onKeyDown={onInputKey}
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
            <div ref={listRef} className="searchable-select-list">
              {filtered.length === 0 && (
                <div className="searchable-select-empty hint">{t.noData}</div>
              )}
              {filtered.map((o, idx) => {
                const isSel = o.value === value;
                const isActive = idx === activeIdx;
                return (
                  <div
                    key={o.value}
                    className={`searchable-select-row${isSel ? ' selected' : ''}${
                      isActive ? ' active' : ''
                    }`}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(o.value)}
                  >
                    <span className="searchable-select-row-name">
                      {o.label}
                      {o.hint && (
                        <span className="searchable-select-hint">{o.hint}</span>
                      )}
                    </span>
                    {isSel && <IconCheck size={13} />}
                  </div>
                );
              })}
            </div>
            {footerAction && (
              <button
                type="button"
                className="searchable-select-footer-action"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setOpen(false);
                  footerAction.onClick();
                }}
              >
                {footerAction.icon}
                <span>{footerAction.label}</span>
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  );
};

export default SearchableSelect;
