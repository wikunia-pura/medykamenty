import React from 'react';
import { useT } from '../i18n';
import { useEscapeKey } from '../utils/useEscapeKey';
import ModalHeader from './ModalHeader';

interface Props {
  blockedBy: string[];
  onClose: () => void;
}

const WarningIcon: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const BlockedByDialog: React.FC<Props> = ({ blockedBy, onClose }) => {
  const t = useT();
  useEscapeKey(onClose);

  const groups: Record<string, string[]> = {};
  for (const entry of blockedBy) {
    const idx = entry.indexOf(':');
    const kind = idx >= 0 ? entry.slice(0, idx) : 'other';
    const name = idx >= 0 ? entry.slice(idx + 1) : entry;
    (groups[kind] ??= []).push(name);
  }
  for (const k of Object.keys(groups)) {
    groups[k] = Array.from(new Set(groups[k])).sort((a, b) => a.localeCompare(b));
  }

  const labelFor = (kind: string): string => {
    switch (kind) {
      case 'raw':
        return t.deleteBlockedByRawMaterials;
      case 'component':
        return t.deleteBlockedByComponents;
      case 'product':
        return t.deleteBlockedByProducts;
      default:
        return kind;
    }
  };

  // Order: products first (top-level), then components, then raw materials.
  const KIND_ORDER = ['product', 'component', 'raw'];
  const kinds = Object.keys(groups).sort((a, b) => {
    const ai = KIND_ORDER.indexOf(a);
    const bi = KIND_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const totalCount = kinds.reduce((sum, k) => sum + groups[k].length, 0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal modal-sm blocked-by-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <ModalHeader
          icon={<WarningIcon size={18} />}
          title={t.blockedByTitle}
          subtitle={t.blockedBySubtitle.replace('{n}', String(totalCount))}
          onClose={onClose}
          tone="danger"
        />
        <div className="modal-body">
          {kinds.length === 0 ? (
            <div className="hint">—</div>
          ) : (
            kinds.map((kind) => (
              <div className="blocked-by-group" key={kind}>
                <div className="blocked-by-group-header">
                  <span className="blocked-by-group-label">{labelFor(kind)}</span>
                  <span className="blocked-by-group-count">{groups[kind].length}</span>
                </div>
                <ul className="blocked-by-list">
                  {groups[kind].map((name) => (
                    <li key={name} className="blocked-by-item">
                      {name}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
        <div className="modal-footer">
          <button className="btn primary" onClick={onClose}>
            {t.close}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BlockedByDialog;
