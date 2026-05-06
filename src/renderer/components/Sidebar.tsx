import React from 'react';
import { useT } from '../i18n';
import Logo from './Logo';
import type { ViewKey } from '../views/types';

interface NavItem {
  key: ViewKey;
  label: string;
  icon: string;
  group:
    | 'dashboard'
    | 'workflow'
    | 'plan'
    | 'tools'
    | 'catalog'
    | 'system';
  step?: number;
}

interface Props {
  current: ViewKey;
  onSelect: (key: ViewKey) => void;
}

const groupLabels: Record<NonNullable<NavItem['group']>, string | null> = {
  dashboard: null,
  workflow: 'Wizard',
  plan: 'Plan',
  tools: 'Narzędzia',
  catalog: 'Katalog',
  system: 'System',
};

const Sidebar: React.FC<Props> = ({ current, onSelect }) => {
  const t = useT();
  const items: NavItem[] = [
    { key: 'dashboard', label: t.dashboard, icon: '◇', group: 'dashboard' },
    { key: 'stockImport', label: t.stockImport, icon: '⇪', group: 'workflow', step: 1 },
    { key: 'shortageReport', label: t.shortageReport, icon: '⚠', group: 'workflow', step: 2 },
    { key: 'emailGenerator', label: t.emailGenerator, icon: '✉', group: 'workflow', step: 3 },
    { key: 'productionPlan', label: t.productionPlan, icon: '▤', group: 'plan' },
    { key: 'costCalculator', label: t.costCalculator, icon: '$', group: 'tools' },
    { key: 'maxProducible', label: t.maxProducible, icon: '∞', group: 'tools' },
    { key: 'products', label: t.products, icon: '◐', group: 'catalog' },
    { key: 'rawMaterials', label: t.rawMaterials, icon: '⬡', group: 'catalog' },
    { key: 'components', label: t.components, icon: '▦', group: 'catalog' },
    { key: 'suppliers', label: t.suppliers, icon: '◉', group: 'catalog' },
    { key: 'settings', label: t.settings, icon: '⚙', group: 'system' },
  ];

  // Group items in render order
  const groups: { key: NavItem['group']; items: NavItem[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.key === item.group) {
      last.items.push(item);
    } else {
      groups.push({ key: item.group, items: [item] });
    }
  }

  return (
    <div className="sidebar">
      <div className="sidebar-brand">
        <Logo size={40} />
      </div>
      <div className="sidebar-nav">
        {groups.map((g, gi) => {
          const label = groupLabels[g.key];
          const isWorkflow = g.key === 'workflow';
          const isDashboard = g.key === 'dashboard';
          return (
            <div
              key={g.key + gi}
              className={`nav-group nav-group-${g.key}`}
            >
              {label && <div className="nav-group-label">{label}</div>}
              {g.items.map((item) => {
                const active = current === item.key;
                return (
                  <div
                    key={item.key}
                    className={`nav-item ${active ? 'active' : ''} ${
                      isDashboard ? 'nav-item-dashboard' : ''
                    } ${isWorkflow ? 'nav-item-step' : ''}`}
                    onClick={() => onSelect(item.key)}
                  >
                    {isWorkflow ? (
                      <span className={`nav-step-badge ${active ? 'active' : ''}`}>
                        {item.step}
                      </span>
                    ) : (
                      <span className="nav-icon">{item.icon}</span>
                    )}
                    <span className="nav-label">{item.label}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Sidebar;
