import React from 'react';
import { useT } from '../i18n';
import Logo from './Logo';
import type { ViewKey } from '../views/types';

interface NavItem {
  key: ViewKey;
  label: string;
  icon: string;
  group?: 'main' | 'data' | 'system';
}

interface Props {
  current: ViewKey;
  onSelect: (key: ViewKey) => void;
  appVersion: string;
}

const Sidebar: React.FC<Props> = ({ current, onSelect, appVersion }) => {
  const t = useT();
  const items: NavItem[] = [
    { key: 'dashboard', label: t.dashboard, icon: '◇', group: 'main' },
    { key: 'stockImport', label: t.stockImport, icon: '⇪', group: 'main' },
    { key: 'productionPlan', label: t.productionPlan, icon: '▤', group: 'main' },
    { key: 'shortageReport', label: t.shortageReport, icon: '⚠', group: 'main' },
    { key: 'emailGenerator', label: t.emailGenerator, icon: '✉', group: 'main' },
    { key: 'costCalculator', label: t.costCalculator, icon: '$', group: 'main' },
    { key: 'maxProducible', label: t.maxProducible, icon: '∞', group: 'main' },
    { key: 'products', label: t.products, icon: '◐', group: 'data' },
    { key: 'rawMaterials', label: t.rawMaterials, icon: '⬡', group: 'data' },
    { key: 'components', label: t.components, icon: '▦', group: 'data' },
    { key: 'suppliers', label: t.suppliers, icon: '◉', group: 'data' },
    { key: 'settings', label: t.settings, icon: '⚙', group: 'system' },
  ];

  let prevGroup: string | undefined;
  return (
    <div className="sidebar">
      <div className="sidebar-brand">
        <Logo size={26} />
      </div>
      <div className="sidebar-nav">
        {items.map((item) => {
          const showDivider = prevGroup !== undefined && item.group !== prevGroup;
          prevGroup = item.group;
          return (
            <React.Fragment key={item.key}>
              {showDivider && <div className="nav-divider" />}
              <div
                className={`nav-item ${current === item.key ? 'active' : ''}`}
                onClick={() => onSelect(item.key)}
              >
                <span style={{ width: 16, display: 'inline-block', textAlign: 'center' }}>
                  {item.icon}
                </span>
                {item.label}
              </div>
            </React.Fragment>
          );
        })}
      </div>
      <div className="sidebar-footer">
        {t.version} {appVersion}
      </div>
    </div>
  );
};

export default Sidebar;
