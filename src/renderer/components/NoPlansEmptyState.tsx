import React from 'react';
import { useT } from '../i18n';
import { IconPlus } from './Icons';

interface Props {
  hint?: string;
  onAddPlan: () => void;
}

const NoPlansEmptyState: React.FC<Props> = ({ hint, onAddPlan }) => {
  const t = useT();
  return (
    <div className="card highlight-callout" style={{ textAlign: 'center', padding: 32 }}>
      <h2 style={{ marginTop: 0 }}>{t.noPlansYet}</h2>
      <p className="hint" style={{ marginBottom: 20 }}>
        {hint ?? t.selectPlanFirst}
      </p>
      <button className="btn primary-filled" onClick={onAddPlan}>
        <IconPlus size={14} /> {t.addPlanCta}
      </button>
    </div>
  );
};

export default NoPlansEmptyState;
