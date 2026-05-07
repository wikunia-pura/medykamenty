import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
  triggerClassName?: string;
}

const HoverTooltip: React.FC<Props> = ({
  trigger,
  children,
  align = 'left',
  className,
  triggerClassName,
}) => {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    const update = () => {
      const trig = triggerRef.current;
      if (!trig) return;
      const trect = trig.getBoundingClientRect();
      const tt = tooltipRef.current;
      const ttHeight = tt?.offsetHeight ?? 240;
      const ttWidth = tt?.offsetWidth ?? 320;
      const margin = 6;
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const fitsBelow = trect.bottom + ttHeight + margin <= vh;
      const placeBelow = fitsBelow || trect.top < ttHeight + margin;
      let left = align === 'right' ? trect.right - ttWidth : trect.left;
      left = Math.max(8, Math.min(left, vw - ttWidth - 8));
      const top = placeBelow
        ? trect.bottom + margin
        : Math.max(8, trect.top - ttHeight - margin);
      setCoords({ left, top });
    };
    update();
    // Re-measure once the tooltip has actual dimensions in the DOM.
    const id = window.setTimeout(update, 0);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, align]);

  return (
    <>
      <span
        ref={triggerRef}
        className={triggerClassName}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        {trigger}
      </span>
      {open &&
        createPortal(
          <div
            ref={tooltipRef}
            className={`hover-tooltip ${className ?? ''}`}
            style={{
              left: coords?.left ?? -10000,
              top: coords?.top ?? -10000,
              visibility: coords ? 'visible' : 'hidden',
            }}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
};

export default HoverTooltip;
