import React from 'react';
import sunUrl from '../assets/gg-sun.png';

interface Props {
  size?: number;
  className?: string;
}

const GaduGaduSun: React.FC<Props> = ({ size = 120, className }) => {
  return (
    <img
      className={className}
      src={sunUrl}
      width={size}
      height={size}
      alt="Dostępny"
      style={{ display: 'block', flexShrink: 0, objectFit: 'contain' }}
    />
  );
};

export default GaduGaduSun;
