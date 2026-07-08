import React, { useId } from 'react';

// A "pick one" selector rendered as a recessed track with a raised selected
// chip. Deliberately styled to look nothing like an action button (.btn): in
// these decision tables the choice is only committed later, when the user hits
// the footer's "Zastosuj/Apply" button. A pair of filled buttons made users
// think clicking one performed the action immediately — this reads as a toggle.
//
// Backed by real radio inputs (one <fieldset>-less radiogroup per instance via
// a unique name), so keyboard arrow navigation and screen-reader semantics come
// for free.

export type SegmentTone = 'primary' | 'neutral' | 'danger' | 'success' | 'warning';

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  // Colors the selected chip's text/ring so the choice carries meaning
  // (e.g. green "Utwórz", red "Odrzuć"). Defaults to 'primary'.
  tone?: SegmentTone;
  title?: string;
}

interface Props<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  size?: 'sm' | 'md';
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
}

function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  ariaLabel,
  className,
  disabled,
}: Props<T>) {
  const name = useId();
  return (
    <div
      className={`segmented segmented--${size}${className ? ` ${className}` : ''}`}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <label
            key={o.value}
            title={o.title}
            className={`segmented__option segmented__option--${o.tone ?? 'primary'}${
              selected ? ' is-selected' : ''
            }${disabled ? ' is-disabled' : ''}`}
          >
            <input
              type="radio"
              className="segmented__input"
              name={name}
              value={o.value}
              checked={selected}
              disabled={disabled}
              onChange={() => onChange(o.value)}
            />
            <span className="segmented__label">{o.label}</span>
          </label>
        );
      })}
    </div>
  );
}

export default SegmentedControl;
