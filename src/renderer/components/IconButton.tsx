import React from 'react';
import HoverTooltip from './HoverTooltip';

interface Props extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  icon: React.ReactNode;
  // What the button does — shown in the app's hover tooltip and read out by
  // screen readers, since there is no visible text.
  label: string;
  align?: 'left' | 'right';
}

// Icon-only .btn whose meaning is explained on hover by the app's own tooltip
// (never a native `title`). The trigger wrapper stretches with its flex row,
// so the button matches the height of text buttons beside it.
const IconButton: React.FC<Props> = ({
  icon,
  label,
  align = 'right',
  className,
  type = 'button',
  ...rest
}) => (
  <HoverTooltip
    align={align}
    className="hover-tooltip-compact"
    triggerClassName="icon-button-trigger"
    trigger={
      <button
        {...rest}
        type={type}
        aria-label={label}
        className={`btn btn-icon-only${className ? ` ${className}` : ''}`}
      >
        {icon}
      </button>
    }
  >
    {label}
  </HoverTooltip>
);

export default IconButton;
