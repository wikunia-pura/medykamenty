import { IconChevronDown } from './Icons';

interface Option<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  // Tone class for the pill, e.g. `order-status-in_progress`.
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

// A status pill that is also a select. A bare <select> sizes itself to its
// LONGEST option, so a short status got a wide pill with dead space; here the
// pill shows the current label (sized to it) and a transparent native <select>
// laid over it keeps the native dropdown and keyboard handling.
function BadgeSelect<T extends string>({
  value,
  options,
  onChange,
  className,
  ariaLabel,
  disabled,
}: Props<T>) {
  const current = options.find((o) => o.value === value);
  return (
    <span
      className={`status-inline-select${className ? ` ${className}` : ''}${
        disabled ? ' is-disabled' : ''
      }`}
      // The pill often sits in a clickable row — picking a status must not
      // also open the row.
      onClick={(e) => e.stopPropagation()}
    >
      <span className="status-inline-select-label">{current?.label ?? value}</span>
      <IconChevronDown size={10} />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        aria-label={ariaLabel}
        disabled={disabled}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}

export default BadgeSelect;
