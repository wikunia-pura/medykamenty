import React, { useMemo, useState } from 'react';
import { useT } from '../i18n';
import type {
  MatchSuggestion,
  RecipeImportResolutionEntry,
  RecipeImportUnresolvedItem,
  RecipeResolveAction,
} from '../../shared/types';
import { useEscapeKey } from '../utils/useEscapeKey';
import ModalHeader from './ModalHeader';
import { IconPlus } from './Icons';

// Resolution UI for raw materials / components a recipe XLSX references but
// the catalog doesn't have. Inspired by the stock import's BulkUnmatchedModal
// but limited to permanent actions: a product needs every raw / component
// resolved, so no `use-once` (temporary link) and no per-row skip. The user
// either picks alias / rename / add-new for every row, or cancels the import.

type ActionType = 'add-new' | 'save-alias' | 'rename-existing';

interface RowChoice {
  // null = no target picked. add-new doesn't need one; save-alias /
  // rename-existing do.
  targetId: string | null;
  action: ActionType;
}

interface Props {
  rawItems: RecipeImportUnresolvedItem[];
  componentItems: RecipeImportUnresolvedItem[];
  busy?: boolean;
  onApply: (resolutions: {
    rawMaterials: RecipeImportResolutionEntry[];
    components: RecipeImportResolutionEntry[];
  }) => void;
  onCancel: () => void;
}

// Compose the per-row decision into the wire type the main process expects.
function buildEntry(
  item: RecipeImportUnresolvedItem,
  choice: RowChoice | undefined,
): RecipeImportResolutionEntry | null {
  if (!choice) return null;
  if (choice.action === 'add-new') {
    return { name: item.name, action: { type: 'add-new' } };
  }
  if (!choice.targetId) return null;
  const action: RecipeResolveAction =
    choice.action === 'save-alias'
      ? { type: 'save-alias', targetId: choice.targetId }
      : { type: 'rename-existing', targetId: choice.targetId };
  return { name: item.name, action };
}

// Default depends on suggestion confidence. Strong top match → pre-pick
// save-alias (matches stock-import's BulkUnmatchedModal default); otherwise
// add-new so we don't nudge the user toward a wrong link.
function defaultChoice(item: RecipeImportUnresolvedItem): RowChoice {
  const top = item.suggestions[0];
  if (top && top.confidence >= 0.75) {
    return { targetId: top.id, action: 'save-alias' };
  }
  return { targetId: null, action: 'add-new' };
}

const RecipeUnresolvedModal: React.FC<Props> = ({
  rawItems,
  componentItems,
  busy,
  onApply,
  onCancel,
}) => {
  const t = useT();
  useEscapeKey(onCancel);

  const [rawChoices, setRawChoices] = useState<Record<string, RowChoice>>(() => {
    const out: Record<string, RowChoice> = {};
    for (const r of rawItems) out[r.name] = defaultChoice(r);
    return out;
  });
  const [compChoices, setCompChoices] = useState<Record<string, RowChoice>>(() => {
    const out: Record<string, RowChoice> = {};
    for (const c of componentItems) out[c.name] = defaultChoice(c);
    return out;
  });

  // When "expanded" is set, render the full per-row resolution panel below
  // the bulk table — gives the user the same focused decision surface as
  // UnmatchedRowModal without leaving the bulk view.
  const [expanded, setExpanded] = useState<{ kind: 'raw' | 'component'; name: string } | null>(
    null,
  );

  const total = rawItems.length + componentItems.length;

  const setRowChoice = (
    kind: 'raw' | 'component',
    name: string,
    update: Partial<RowChoice>,
  ) => {
    if (kind === 'raw') {
      setRawChoices((prev) => ({ ...prev, [name]: { ...prev[name], ...update } }));
    } else {
      setCompChoices((prev) => ({ ...prev, [name]: { ...prev[name], ...update } }));
    }
  };

  // Auto-flip action ↔ target consistency: switching to save-alias /
  // rename-existing requires a target; if none is picked yet, fall back
  // to the top suggestion.
  const setAction = (
    kind: 'raw' | 'component',
    item: RecipeImportUnresolvedItem,
    action: ActionType,
  ) => {
    const choices = kind === 'raw' ? rawChoices : compChoices;
    const cur = choices[item.name];
    let targetId = cur?.targetId ?? null;
    if (action === 'add-new') {
      targetId = null;
    } else if (!targetId && item.suggestions.length > 0) {
      targetId = item.suggestions[0].id;
    }
    setRowChoice(kind, item.name, { action, targetId });
  };

  const setTarget = (
    kind: 'raw' | 'component',
    item: RecipeImportUnresolvedItem,
    targetId: string,
  ) => {
    const choices = kind === 'raw' ? rawChoices : compChoices;
    const cur = choices[item.name];
    // Picking a target while action was add-new flips to save-alias — the
    // user has clearly committed to a target.
    const action: ActionType =
      cur?.action === 'add-new' ? 'save-alias' : cur?.action ?? 'save-alias';
    setRowChoice(kind, item.name, { targetId, action });
  };

  // Bulk shortcut: same as stock import's "Ustaw wszystkim". Rows without a
  // suggestion fall back to add-new (since the alias/use-once/rename actions
  // need a target).
  const setAllAction = (action: ActionType) => {
    const apply = (
      items: RecipeImportUnresolvedItem[],
      setter: React.Dispatch<React.SetStateAction<Record<string, RowChoice>>>,
    ) => {
      setter((prev) => {
        const next = { ...prev };
        for (const item of items) {
          const cur = next[item.name];
          if (!cur) continue;
          if (action === 'add-new') {
            next[item.name] = { ...cur, action: 'add-new', targetId: null };
          } else {
            const hasSuggestion = item.suggestions.length > 0;
            next[item.name] = {
              ...cur,
              action: hasSuggestion ? action : 'add-new',
              targetId: hasSuggestion
                ? cur.targetId ?? item.suggestions[0].id
                : null,
            };
          }
        }
        return next;
      });
    };
    apply(rawItems, setRawChoices);
    apply(componentItems, setCompChoices);
  };

  const handleApply = () => {
    const rawMaterials: RecipeImportResolutionEntry[] = [];
    const components: RecipeImportResolutionEntry[] = [];
    for (const r of rawItems) {
      const e = buildEntry(r, rawChoices[r.name]);
      if (e) rawMaterials.push(e);
    }
    for (const c of componentItems) {
      const e = buildEntry(c, compChoices[c.name]);
      if (e) components.push(e);
    }
    onApply({ rawMaterials, components });
  };

  // Validation: a save-alias / rename-existing row without a target is
  // invalid and would silently drop from the payload.
  const invalid = useMemo(() => {
    const bad: string[] = [];
    for (const r of rawItems) {
      const c = rawChoices[r.name];
      if (c && c.action !== 'add-new' && !c.targetId) bad.push(r.name);
    }
    for (const co of componentItems) {
      const c = compChoices[co.name];
      if (c && c.action !== 'add-new' && !c.targetId) bad.push(co.name);
    }
    return bad;
  }, [rawItems, componentItems, rawChoices, compChoices]);

  // Apply-button counts so the user sees what they're about to do.
  const summary = useMemo(() => {
    const s = { addNew: 0, saveAlias: 0, rename: 0 };
    const tally = (
      items: RecipeImportUnresolvedItem[],
      choices: Record<string, RowChoice>,
    ) => {
      for (const it of items) {
        const c = choices[it.name];
        if (!c) continue;
        if (c.action === 'add-new') s.addNew++;
        else if (c.action === 'save-alias') s.saveAlias++;
        else if (c.action === 'rename-existing') s.rename++;
      }
    };
    tally(rawItems, rawChoices);
    tally(componentItems, compChoices);
    return s;
  }, [rawItems, componentItems, rawChoices, compChoices]);

  const renderRow = (kind: 'raw' | 'component', item: RecipeImportUnresolvedItem) => {
    const choices = kind === 'raw' ? rawChoices : compChoices;
    const c = choices[item.name];
    const isExpanded = expanded?.kind === kind && expanded.name === item.name;
    return (
      <React.Fragment key={`${kind}:${item.name}`}>
        <tr className={`bulk-row ${isExpanded ? 'is-expanded' : ''}`}>
          <td className="bulk-col-import">
            <div className="bulk-import-name">{item.name}</div>
          </td>
          <td className="bulk-col-target">
            {item.suggestions.length === 0 ? (
              <span className="hint">—</span>
            ) : (
              <select
                className="input"
                value={c?.targetId ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) setTarget(kind, item, v);
                }}
              >
                {!c?.targetId && <option value="">{t.bulkPickTarget}</option>}
                {item.suggestions.map((s: MatchSuggestion) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {Math.round(s.confidence * 100)}%
                  </option>
                ))}
              </select>
            )}
          </td>
          <td className="bulk-col-action">
            <select
              className="input"
              value={c?.action ?? 'add-new'}
              onChange={(e) => setAction(kind, item, e.target.value as ActionType)}
            >
              <option value="add-new">{t.resolveRowActionAddNew}</option>
              {item.suggestions.length > 0 && (
                <>
                  <option value="save-alias">{t.resolveRowActionSaveAlias}</option>
                  <option value="rename-existing">{t.resolveRowActionRename}</option>
                </>
              )}
            </select>
          </td>
          <td className="bulk-col-skip">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() =>
                setExpanded(isExpanded ? null : { kind, name: item.name })
              }
              title={t.recipeUnresolvedExpand}
            >
              {isExpanded ? '▾' : '▸'}
            </button>
          </td>
        </tr>
        {isExpanded && (
          <tr className="bulk-row-expand">
            <td colSpan={4}>
              <ExpandedItemPanel
                item={item}
                kind={kind}
                choice={c}
                onChangeAction={(a) => setAction(kind, item, a)}
                onChangeTarget={(id) => setTarget(kind, item, id)}
              />
            </td>
          </tr>
        )}
      </React.Fragment>
    );
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal modal-lg bulk-resolve-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <ModalHeader
          icon={<IconPlus size={18} />}
          tone="add"
          title={t.recipeUnresolvedTitle.replace('{n}', String(total))}
          subtitle={t.recipeUnresolvedSubtitle}
          onClose={onCancel}
        />
        <div className="modal-body">
          <div className="bulk-toolbar">
            <span className="hint">{t.bulkSetAll}</span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setAllAction('save-alias')}
            >
              {t.resolveRowActionSaveAlias}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setAllAction('add-new')}
            >
              {t.resolveRowActionAddNew}
            </button>
          </div>

          <div className="table-wrap bulk-resolve-table-wrap">
            <table className="table bulk-resolve-table">
              <thead>
                <tr>
                  <th className="bulk-col-import">{t.recipeUnresolvedColName}</th>
                  <th className="bulk-col-target">{t.bulkColMapTo}</th>
                  <th className="bulk-col-action">{t.bulkColAction}</th>
                  <th className="bulk-col-skip">&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {rawItems.length > 0 && (
                  <tr className="bulk-section-row">
                    <td colSpan={4}>
                      <strong>{t.recipeUnresolvedSectionRaws}</strong> ({rawItems.length})
                    </td>
                  </tr>
                )}
                {rawItems.map((r) => renderRow('raw', r))}
                {componentItems.length > 0 && (
                  <tr className="bulk-section-row">
                    <td colSpan={4}>
                      <strong>{t.recipeUnresolvedSectionComponents}</strong> (
                      {componentItems.length})
                    </td>
                  </tr>
                )}
                {componentItems.map((c) => renderRow('component', c))}
              </tbody>
            </table>
          </div>

          <div className="bulk-summary">
            {summary.addNew > 0 && (
              <span className="tag">
                {t.resolveRowActionAddNew}: <strong>{summary.addNew}</strong>
              </span>
            )}
            {summary.saveAlias > 0 && (
              <span className="tag success">
                {t.resolveRowActionSaveAlias}: <strong>{summary.saveAlias}</strong>
              </span>
            )}
            {summary.rename > 0 && (
              <span className="tag warn">
                {t.resolveRowActionRename}: <strong>{summary.rename}</strong>
              </span>
            )}
          </div>

          {invalid.length > 0 && (
            <div className="hint" style={{ color: 'var(--danger, #c62828)' }}>
              {t.recipeUnresolvedRequiresTarget}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            {t.recipeUnresolvedCancelAbort}
          </button>
          <button
            type="button"
            className="btn primary-filled"
            disabled={busy || invalid.length > 0}
            onClick={handleApply}
          >
            {t.recipeUnresolvedApplyAll}
          </button>
        </div>
      </div>
    </div>
  );
};

// Focused "single row" view rendered inline under the table row. Shows the
// AI suggestions as radio buttons + the action cards, equivalent to
// `UnmatchedRowModal` but without re-fetching suggestions (they came with
// the analysis).
const ExpandedItemPanel: React.FC<{
  item: RecipeImportUnresolvedItem;
  kind: 'raw' | 'component';
  choice: RowChoice | undefined;
  onChangeAction: (a: ActionType) => void;
  onChangeTarget: (id: string) => void;
}> = ({ item, kind, choice, onChangeAction, onChangeTarget }) => {
  const t = useT();
  const selected = item.suggestions.find((s) => s.id === (choice?.targetId ?? ''));
  const interpolate = (template: string) =>
    template
      .replace('{import}', item.name)
      .replace('{catalog}', selected?.name ?? '');

  return (
    <div className="resolve-expanded">
      <div className="resolve-section-label">{t.resolveRowSuggestions}</div>
      <div className="resolve-suggestions">
        {item.suggestions.length === 0 && (
          <div className="resolve-no-suggestions">{t.resolveRowNoSuggestions}</div>
        )}
        {item.suggestions.map((s) => {
          const isActive = s.id === (choice?.targetId ?? '');
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onChangeTarget(s.id)}
              className={`resolve-suggestion ${isActive ? 'is-selected' : ''}`}
            >
              <span className="resolve-suggestion-radio" aria-hidden>
                {isActive ? '●' : '○'}
              </span>
              <span className="resolve-suggestion-name">{s.name}</span>
              <span
                className={`resolve-suggestion-score ${
                  s.confidence >= 0.85
                    ? 'high'
                    : s.confidence >= 0.7
                      ? 'mid'
                      : 'low'
                }`}
              >
                {Math.round(s.confidence * 100)}%
              </span>
            </button>
          );
        })}
      </div>

      <div className="resolve-section-heading">{t.resolveRowPickAction}</div>
      <div className="resolve-actions">
        {selected && (
          <>
            <button
              type="button"
              className={`resolve-action resolve-action-success ${choice?.action === 'save-alias' ? 'is-selected' : ''}`}
              onClick={() => onChangeAction('save-alias')}
            >
              <div className="resolve-action-title">{t.resolveRowActionSaveAlias}</div>
              <div className="resolve-action-arrow">
                alias <strong>{item.name}</strong> = <strong>{selected.name}</strong>
              </div>
              <div className="resolve-action-hint">
                {interpolate(t.resolveRowActionSaveAliasHint)}
              </div>
            </button>

            <button
              type="button"
              className={`resolve-action resolve-action-warn ${choice?.action === 'rename-existing' ? 'is-selected' : ''}`}
              onClick={() => onChangeAction('rename-existing')}
            >
              <div className="resolve-action-title">{t.resolveRowActionRename}</div>
              <div className="resolve-action-arrow">
                <strong>{selected.name}</strong> → <strong>{item.name}</strong>
              </div>
              <div className="resolve-action-hint">
                {interpolate(t.resolveRowActionRenameHint)}
              </div>
            </button>
          </>
        )}

        <button
          type="button"
          className={`resolve-action resolve-action-neutral ${choice?.action === 'add-new' ? 'is-selected' : ''}`}
          onClick={() => onChangeAction('add-new')}
        >
          <div className="resolve-action-title">
            <IconPlus size={13} /> {t.resolveRowActionAddNew}
          </div>
          <div className="resolve-action-arrow">
            {kind === 'raw' ? t.rawMaterials : t.components}: <strong>{item.name}</strong>
          </div>
          <div className="resolve-action-hint">{t.resolveRowActionAddNewHint}</div>
        </button>
      </div>
    </div>
  );
};

export default RecipeUnresolvedModal;
