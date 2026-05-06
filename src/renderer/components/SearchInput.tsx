import React from 'react';
import { useT } from '../i18n';
import { IconSearch, IconClose } from './Icons';

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  width?: number | string;
  block?: boolean;
  /** Element rendered inside the input on the right (e.g. inline filter chip). */
  rightAdornment?: React.ReactNode;
}

const SearchInput: React.FC<Props> = ({
  value,
  onChange,
  placeholder,
  width,
  block = false,
  rightAdornment,
}) => {
  const t = useT();
  const style = block ? undefined : { width: width ?? 260 };
  const hasAdornment = !!rightAdornment;
  return (
    <div
      className={`search-input ${block ? 'search-input-block' : ''} ${
        hasAdornment ? 'has-adornment' : ''
      }`}
      style={style}
    >
      <span className="search-input-icon">
        <IconSearch size={14} />
      </span>
      <input
        type="text"
        className="input"
        placeholder={placeholder ?? t.search}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          className="search-input-clear"
          onClick={() => onChange('')}
          aria-label="clear"
          title="clear"
        >
          <IconClose size={12} />
        </button>
      )}
      {rightAdornment && <div className="search-input-adornment">{rightAdornment}</div>}
    </div>
  );
};

export default SearchInput;

export const matchesQuery = (record: unknown, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = collectStrings(record).toLowerCase();
  return haystack.includes(q);
};

function collectStrings(value: unknown, depth = 0): string {
  if (depth > 6) return '';
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map((v) => collectStrings(v, depth + 1)).join(' ');
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .map((v) => collectStrings(v, depth + 1))
      .join(' ');
  }
  return '';
}
