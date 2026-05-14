import React from 'react';
import { useT } from '../i18n';
import { IconPlus } from './Icons';

interface Props {
  hint?: string;
  onGoToProducts: () => void;
}

const NoProductsEmptyState: React.FC<Props> = ({ hint, onGoToProducts }) => {
  const t = useT();
  return (
    <div className="card highlight-callout" style={{ textAlign: 'center', padding: 32 }}>
      <h2 style={{ marginTop: 0 }}>{t.noProductsYet}</h2>
      <p className="hint" style={{ marginBottom: 20 }}>
        {hint ?? t.defineProductsFirstHint}
      </p>
      <button className="btn primary-filled" onClick={onGoToProducts}>
        <IconPlus size={14} /> {t.goToProductsCta}
      </button>
    </div>
  );
};

export default NoProductsEmptyState;
