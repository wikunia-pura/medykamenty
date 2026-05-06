import React from 'react';
import logoUrl from '../assets/cutis-logo.png';

interface Props {
  size?: number;
  withWordmark?: boolean;
  className?: string;
}

const Logo: React.FC<Props> = ({ size = 28, withWordmark = true, className }) => {
  // The source image already includes the wordmark.
  const aspect = 210 / 150;
  const height = withWordmark ? size * 1.25 : size;
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
          // The PNG mark is dark grey on transparent — invert in dark/sidebar contexts.
          filter: 'brightness(0) invert(1)',
        }}
      />
    </span>
  );
};

export default Logo;
