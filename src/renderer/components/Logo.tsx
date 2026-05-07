import React from 'react';
import logoUrl from '../assets/cutis-logo.png';

interface Props {
  size?: number;
  withWordmark?: boolean;
  className?: string;
}

const Logo: React.FC<Props> = ({ size = 28, withWordmark = true, className }) => {
  if (!withWordmark) {
    // Stylized lotus mark drawn as SVG so it stays crisp at any size and
    // doesn't depend on cropping the bundled PNG.
    const VIEW_W = 60;
    const VIEW_H = 50;
    const renderH = (size * VIEW_H) / VIEW_W;
    const petal = 'M -2 0 Q -3 -22 0 -44 Q 3 -22 2 0 Z';
    const petalShort = 'M -2 0 Q -3 -16 0 -34 Q 3 -16 2 0 Z';
    return (
      <svg
        className={className}
        width={size}
        height={renderH}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        fill="currentColor"
        aria-label="Cutis"
        role="img"
        style={{ display: 'block', flexShrink: 0, color: '#ffffff' }}
      >
        <g transform="translate(30 49)">
          <path d={petal} />
          <path d={petal} transform="rotate(-22)" />
          <path d={petal} transform="rotate(22)" />
          <path d={petalShort} transform="rotate(-44)" />
          <path d={petalShort} transform="rotate(44)" />
        </g>
      </svg>
    );
  }

  const aspect = 210 / 150;
  const height = size * 1.25;
  const width = height * aspect;

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        lineHeight: 0,
      }}
    >
      <img
        src={logoUrl}
        alt="Cutis"
        width={width}
        height={height}
        style={{
          display: 'block',
          objectFit: 'contain',
          filter: 'brightness(0) invert(1)',
        }}
      />
    </span>
  );
};

export default Logo;
