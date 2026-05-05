import React from 'react';

interface Props {
  size?: number;
  withWordmark?: boolean;
  className?: string;
}

// Stylized lotus / palmette inspired by the Cutis brand mark.
// Drawn with `fill="currentColor"` so it adapts to both light and dark themes
// — the parent's text color drives the logo color. Replace this component with
// an <img src="resources/logo.svg" /> tag if a vector file becomes available.
const Logo: React.FC<Props> = ({ size = 28, withWordmark = true, className }) => {
  const iconHeight = size;
  const iconWidth = iconHeight * 1.05;

  const Icon = (
    <svg
      viewBox="0 0 200 180"
      width={iconWidth}
      height={iconHeight}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      <g fill="currentColor" transform="translate(100, 170)">
        {/* Seven petals radiating from a common base, tallest in the centre */}
        <path d="M -4,0 C -7,-40 -7,-95 0,-140 C 7,-95 7,-40 4,0 Z" />
        <path
          d="M -4,0 C -7,-38 -7,-90 0,-130 C 7,-90 7,-38 4,0 Z"
          transform="rotate(-22)"
        />
        <path
          d="M -4,0 C -7,-38 -7,-90 0,-130 C 7,-90 7,-38 4,0 Z"
          transform="rotate(22)"
        />
        <path
          d="M -4,0 C -7,-32 -7,-78 0,-115 C 7,-78 7,-32 4,0 Z"
          transform="rotate(-46)"
        />
        <path
          d="M -4,0 C -7,-32 -7,-78 0,-115 C 7,-78 7,-32 4,0 Z"
          transform="rotate(46)"
        />
        <path
          d="M -4,0 C -6,-26 -6,-62 0,-92 C 6,-62 6,-26 4,0 Z"
          transform="rotate(-72)"
        />
        <path
          d="M -4,0 C -6,-26 -6,-62 0,-92 C 6,-62 6,-26 4,0 Z"
          transform="rotate(72)"
        />
      </g>
    </svg>
  );

  if (!withWordmark) {
    return <span className={className}>{Icon}</span>;
  }

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        lineHeight: 1,
      }}
    >
      {Icon}
      <span
        style={{
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontWeight: 700,
          fontSize: Math.round(size * 0.78),
          letterSpacing: '0.02em',
          position: 'relative',
        }}
      >
        Cutis
        <sup
          style={{
            fontSize: '0.42em',
            fontWeight: 500,
            marginLeft: 2,
            verticalAlign: 'super',
            opacity: 0.75,
          }}
        >
          ®
        </sup>
      </span>
    </span>
  );
};

export default Logo;
