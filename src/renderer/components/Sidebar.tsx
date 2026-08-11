import React, { useEffect, useState } from 'react';
import { useT } from '../i18n';
import Logo from './Logo';
import type { ViewKey } from '../views/types';

type NavGroup =
  | 'dashboard'
  | 'orders'
  | 'workflow'
  | 'plan'
  | 'tools'
  | 'catalog'
  | 'system';

interface NavItem {
  key: ViewKey;
  label: string;
  icon: string;
  group: NavGroup;
}

interface Props {
  current: ViewKey;
  onSelect: (key: ViewKey) => void;
  userEmail?: string;
  onSignOut?: () => void;
}

const groupLabels: Record<NavGroup, string | null> = {
  dashboard: null,
  orders: 'Zamówienia',
  workflow: 'Zapotrzebowanie',
  plan: 'Plan',
  tools: 'Narzędzia',
  catalog: 'Katalog',
  system: 'System',
};

/** Categories are fixed — only items move (within and across categories). */
const GROUP_ORDER: NavGroup[] = [
  'dashboard',
  'orders',
  'workflow',
  'tools',
  'plan',
  'catalog',
  'system',
];

const STORAGE_KEY = 'sidebar.collapsed';
const ORDER_KEY = 'sidebar.itemOrder';

/** Persisted placement of a nav item: its key plus the category it was dropped into. */
interface ItemPlacement {
  key: ViewKey;
  group: NavGroup;
}

const readStoredOrder = (): ItemPlacement[] => {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is ItemPlacement =>
        !!p &&
        typeof (p as ItemPlacement).key === 'string' &&
        GROUP_ORDER.includes((p as ItemPlacement).group),
    );
  } catch {
    return [];
  }
};

/**
 * Merge the stored order with the defaults: unknown keys are dropped and items
 * added in newer app versions land right after the last item of their default
 * category (or at the end when that category is empty).
 */
const mergeOrder = (defaults: NavItem[], stored: ItemPlacement[]): ItemPlacement[] => {
  const known = new Set(defaults.map((d) => d.key));
  const merged: ItemPlacement[] = [];
  const seen = new Set<ViewKey>();
  for (const p of stored) {
    if (!known.has(p.key) || seen.has(p.key)) continue;
    merged.push(p);
    seen.add(p.key);
  }
  for (const d of defaults) {
    if (seen.has(d.key)) continue;
    const placement: ItemPlacement = { key: d.key, group: d.group };
    let insertAt = merged.length;
    for (let i = merged.length - 1; i >= 0; i--) {
      if (merged[i].group === d.group) {
        insertAt = i + 1;
        break;
      }
    }
    merged.splice(insertAt, 0, placement);
    seen.add(d.key);
  }
  return merged;
};

const Sidebar: React.FC<Props> = ({ current, onSelect, userEmail, onSignOut }) => {
  const t = useT();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const [order, setOrder] = useState<ItemPlacement[]>(() => readStoredOrder());
  const [dragKey, setDragKey] = useState<ViewKey | null>(null);
  const [dropHint, setDropHint] = useState<{ key: ViewKey; pos: 'before' | 'after' } | null>(
    null,
  );
  const [dropGroup, setDropGroup] = useState<NavGroup | null>(null);

  const defaultItems: NavItem[] = [
    { key: 'dashboard', label: t.dashboard, icon: '◇', group: 'dashboard' },
    { key: 'orders', label: t.orders, icon: '▤', group: 'orders' },
    { key: 'workflowTemplates', label: t.workflowTemplates, icon: '☷', group: 'orders' },
    { key: 'stockImport', label: t.stockImport, icon: '⇪', group: 'workflow' },
    { key: 'shortageReport', label: t.shortageReport, icon: '⚠', group: 'workflow' },
    { key: 'emailGenerator', label: t.emailGenerator, icon: '✉', group: 'workflow' },
    { key: 'costCalculator', label: t.costCalculator, icon: '$', group: 'tools' },
    { key: 'maxProducible', label: t.maxProducible, icon: '∞', group: 'tools' },
    { key: 'productionPlan', label: t.productionPlan, icon: '▤', group: 'plan' },
    { key: 'products', label: t.products, icon: '◐', group: 'catalog' },
    { key: 'rawMaterials', label: t.rawMaterials, icon: '⬡', group: 'catalog' },
    { key: 'components', label: t.components, icon: '▦', group: 'catalog' },
    { key: 'outerPackaging', label: t.outerPackaging, icon: '▣', group: 'catalog' },
    { key: 'suppliers', label: t.suppliers, icon: '◉', group: 'catalog' },
    { key: 'settings', label: t.settings, icon: '⚙', group: 'system' },
  ];

  // Items follow the persisted layout; categories keep their fixed order.
  const layout = mergeOrder(defaultItems, order);
  const itemByKey = new Map(defaultItems.map((i) => [i.key, i]));
  const groups = GROUP_ORDER.map((key) => ({
    key,
    items: layout
      .filter((p) => p.group === key)
      .map((p) => itemByKey.get(p.key))
      .filter((i): i is NavItem => !!i),
  }));

  const clearDrag = () => {
    setDragKey(null);
    setDropHint(null);
    setDropGroup(null);
  };

  const applyDrop = (
    targetKey: ViewKey | null,
    group: NavGroup,
    pos: 'before' | 'after',
  ) => {
    if (!dragKey) return;
    if (targetKey === dragKey) {
      clearDrag();
      return;
    }
    const next = layout.filter((p) => p.key !== dragKey);
    const placement: ItemPlacement = { key: dragKey, group };
    const idx = targetKey ? next.findIndex((p) => p.key === targetKey) : -1;
    if (idx < 0) next.push(placement);
    else next.splice(idx + (pos === 'after' ? 1 : 0), 0, placement);
    setOrder(next);
    try {
      localStorage.setItem(ORDER_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    clearDrag();
  };

  const dropPosition = (e: React.DragEvent): 'before' | 'after' => {
    const rect = e.currentTarget.getBoundingClientRect();
    return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  };

  return (
    <div className={`sidebar-slot ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <div className="sidebar">
        <div className="sidebar-brand">
          <Logo size={36} withWordmark={false} className="brand-mark" />
          <Logo size={40} className="brand-full" />
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? '›' : '‹'}
          </button>
        </div>
        <div className="sidebar-nav">
          {groups.map((g) => {
            const label = groupLabels[g.key];
            const isDashboard = g.key === 'dashboard';
            // An emptied category stays visible while dragging so items can be dropped back in.
            if (g.items.length === 0 && !dragKey) return null;
            return (
              <div key={g.key} className={`nav-group nav-group-${g.key}`}>
                {label && <div className="nav-group-label">{label}</div>}
                {g.items.map((item) => {
                  const active = current === item.key;
                  const hint = dropHint?.key === item.key ? dropHint.pos : null;
                  return (
                    <div
                      key={item.key}
                      className={`nav-item ${active ? 'active' : ''} ${
                        isDashboard ? 'nav-item-dashboard' : ''
                      } ${dragKey === item.key ? 'nav-item-dragging' : ''} ${
                        hint ? `nav-item-drop-${hint}` : ''
                      }`}
                      onClick={() => onSelect(item.key)}
                      title={item.label}
                      draggable
                      onDragStart={(e) => {
                        setDragKey(item.key);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', item.key);
                      }}
                      onDragEnd={clearDrag}
                      onDragOver={(e) => {
                        if (!dragKey) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        const pos = dropPosition(e);
                        setDropGroup(null);
                        setDropHint((prev) =>
                          prev && prev.key === item.key && prev.pos === pos
                            ? prev
                            : { key: item.key, pos },
                        );
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        applyDrop(item.key, g.key, dropPosition(e));
                      }}
                    >
                      <span className="nav-icon">{item.icon}</span>
                      <span className="nav-label">{item.label}</span>
                    </div>
                  );
                })}
                {g.items.length === 0 && dragKey && (
                  <div
                    className={`nav-drop-zone ${dropGroup === g.key ? 'over' : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      setDropHint(null);
                      setDropGroup(g.key);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      applyDrop(null, g.key, 'after');
                    }}
                  >
                    <span className="nav-label">Przeciągnij tutaj</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {userEmail && onSignOut && (
          <div className="sidebar-account">
            <div className="sidebar-account-email" title={userEmail}>
              {userEmail}
            </div>
            <button
              type="button"
              className="sidebar-account-signout"
              onClick={onSignOut}
              title="Wyloguj"
            >
              <span className="nav-icon">⎋</span>
              <span className="nav-label">Wyloguj</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Sidebar;
