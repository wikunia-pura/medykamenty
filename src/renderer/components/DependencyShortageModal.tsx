import React, { useState } from 'react';
import { useT } from '../i18n';
import ModalHeader from './ModalHeader';
import SegmentedControl from './SegmentedControl';
import SearchableSelect from './SearchableSelect';
import { IconInfo } from './Icons';
import { useEscapeKey } from '../utils/useEscapeKey';
import type { PackagingComponent } from '../../shared/types';
import { isSecondaryComponent } from '../../shared/types';

// Substitution candidates for a missing packaging component: other secondary
// components of the SAME "typ opakowania" with a compatible capacity unit —
// product-kind swaps stay within the same unit (carton→carton in szt.,
// tape→tape in m); mass-kind swaps allow kg↔l (the calculators convert via
// product density).
export function buildSubstituteCandidates(
  components: PackagingComponent[],
  forId: string,
): { value: string; label: string; hint?: string }[] {
  const from = components.find((c) => c.id === forId);
  if (!from) return [];
  const kind = from.packagingKind ?? 'product';
  const fromUnit = from.capacityUnit ?? 'units';
  const unitOk = (u: string) => (kind === 'mass' ? u === 'kg' || u === 'l' : u === fromUnit);
  return components
    .filter(
      (c) =>
        c.id !== forId &&
        isSecondaryComponent(c.type) &&
        (c.packagingKind ?? 'product') === kind &&
        unitOk(c.capacityUnit ?? 'units') &&
        (c.capacity ?? 0) > 0,
    )
    .map((c) => {
      const unit = c.capacityUnit ?? 'units';
      return {
        value: c.id,
        label: c.name,
        hint: `${(c.capacity ?? 0).toLocaleString()} ${unit === 'units' ? 'szt.' : unit}`,
      };
    });
}

// One row of the shared-packaging shortage prompt — a component consumed via
// the packing scheme (direct tier like a barrel/carton, or pulled in through
// another component's 'dependencies' like tape via carton) that will run
// short. The caller pre-formats `detail` (needed/stock/shortage for the
// shortage report, production cap for max-producible) and supplies the
// substitution candidates (same-kind, unit-compatible secondary components).
export interface DependencyShortageRow {
  componentId: string;
  name: string;
  consumedBy: string[];
  detail: string;
  candidates: { value: string; label: string; hint?: string }[];
}

export interface DependencyShortageDecision {
  // Components whose shortage the user ACCEPTED for this run (a substitute
  // exists outside the catalog math — leave them out of the calculation).
  acceptedIds: string[];
  // Per-run swaps: originalComponentId → substituteComponentId.
  substitutions: Record<string, string>;
}

interface Props {
  rows: DependencyShortageRow[];
  onCancel: () => void;
  // Default (nothing touched) = every shortage counted normally.
  onConfirm: (decision: DependencyShortageDecision) => void;
}

type RowChoice = 'count' | 'accept' | 'substitute';

// Shown before a shortage report / max-producible computation when a
// scheme-consumed packaging component would run short. Per-run decision, not
// persisted: count the shortage normally, accept it, or substitute the
// component with another one for this run.
const DependencyShortageModal: React.FC<Props> = ({ rows, onCancel, onConfirm }) => {
  const t = useT();
  useEscapeKey(onCancel);
  // Default: every shortage counted normally.
  const [choices, setChoices] = useState<Record<string, RowChoice>>({});
  const [substitutes, setSubstitutes] = useState<Record<string, string>>({});

  const choiceFor = (id: string): RowChoice => choices[id] ?? 'count';
  const setChoice = (row: DependencyShortageRow, choice: RowChoice) => {
    setChoices((prev) => ({ ...prev, [row.componentId]: choice }));
    if (choice === 'substitute' && !substitutes[row.componentId] && row.candidates[0]) {
      setSubstitutes((prev) => ({ ...prev, [row.componentId]: row.candidates[0].value }));
    }
  };
  const setAll = (choice: 'count' | 'accept') => {
    const next: Record<string, RowChoice> = {};
    for (const r of rows) next[r.componentId] = choice;
    setChoices(next);
  };

  const confirm = () => {
    const acceptedIds: string[] = [];
    const substitutions: Record<string, string> = {};
    for (const r of rows) {
      const c = choiceFor(r.componentId);
      if (c === 'accept') acceptedIds.push(r.componentId);
      else if (c === 'substitute') {
        const sub = substitutes[r.componentId];
        if (sub) substitutions[r.componentId] = sub;
      }
    }
    onConfirm({ acceptedIds, substitutions });
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <ModalHeader
          icon={<IconInfo size={18} />}
          tone="add"
          title={t.depShortageTitle}
          onClose={onCancel}
        />
        <div className="modal-body">
          <div className="hint" style={{ marginBottom: 12 }}>
            {t.depShortageIntro}
          </div>
          <div className="apply-all-row">
            <span className="apply-all-label">{t.applyToAllLabel}</span>
            <button type="button" className="btn btn-sm" onClick={() => setAll('count')}>
              {t.depShortageCount}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setAll('accept')}>
              {t.depShortageAccept}
            </button>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.name}</th>
                  <th>{t.depShortageConsumedBy}</th>
                  <th>{t.shortage}</th>
                  <th>{t.magazynStockColDecision}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const choice = choiceFor(r.componentId);
                  return (
                    <tr key={r.componentId}>
                      <td className="col-wrap">{r.name}</td>
                      <td className="col-wrap">
                        {r.consumedBy.length > 0 ? (
                          r.consumedBy.join(', ')
                        ) : (
                          <span className="hint">—</span>
                        )}
                      </td>
                      <td className="col-wrap">
                        <span className="hint">{r.detail}</span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <SegmentedControl
                            size="sm"
                            ariaLabel={r.name}
                            value={choice}
                            onChange={(v) => setChoice(r, v)}
                            options={[
                              { value: 'count', label: t.depShortageCount, tone: 'neutral' },
                              { value: 'accept', label: t.depShortageAccept, tone: 'success' },
                              ...(r.candidates.length > 0
                                ? [
                                    {
                                      value: 'substitute' as const,
                                      label: t.depShortageSubstitute,
                                      tone: 'warning' as const,
                                    },
                                  ]
                                : []),
                            ]}
                          />
                          {choice === 'substitute' && (
                            <SearchableSelect
                              options={r.candidates}
                              value={substitutes[r.componentId] ?? ''}
                              onChange={(val) =>
                                setSubstitutes((prev) => ({ ...prev, [r.componentId]: val }))
                              }
                              placeholder={t.depShortageSubstitutePick}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onCancel}>
            {t.cancel}
          </button>
          <button className="btn primary-filled" onClick={confirm}>
            {t.depShortageContinue}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DependencyShortageModal;
