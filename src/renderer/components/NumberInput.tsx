import React, { useEffect, useRef, useState } from 'react';

interface Props {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  /** Value sent to onChange when the field is cleared. Default: undefined. */
  emptyValue?: number;
  step?: number | string;
  min?: number;
  max?: number;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
}

const formatValue = (v: number | undefined): string =>
  v === undefined || v === null || Number.isNaN(v) ? '' : String(v);

const NumberInput: React.FC<Props> = ({
  value,
  onChange,
  emptyValue,
  step,
  min,
  max,
  placeholder,
  disabled,
  readOnly,
  className,
  style,
  onBlur,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string>(() => formatValue(value));

  // Sync the displayed text from props only when the field is not focused — while
  // the user is typing we let them clear "0" or pause on a partial number like
  // "1." without the parent re-rendering it back over their cursor.
  useEffect(() => {
    if (document.activeElement === inputRef.current) return;
    setDraft(formatValue(value));
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setDraft(next);

    if (next === '' || next === '-' || next === '.' || next === '-.') {
      onChange(emptyValue);
      return;
    }
    const num = Number(next);
    if (Number.isFinite(num)) onChange(num);
  };

  const handleBlur: React.FocusEventHandler<HTMLInputElement> = (e) => {
    setDraft(formatValue(value));
    onBlur?.(e);
  };

  return (
    <input
      ref={inputRef}
      type="number"
      className={className}
      style={style}
      value={draft}
      step={step}
      min={min}
      max={max}
      placeholder={placeholder}
      disabled={disabled}
      readOnly={readOnly}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
};

export default NumberInput;
