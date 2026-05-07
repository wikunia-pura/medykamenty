import React, { useMemo } from 'react';
import type {
  RawMaterial,
  PackagingComponent,
  RecipeIngredient,
  RecipePackaging,
} from '../../shared/types';
import { useT } from '../i18n';
import { IconPlus, IconClose } from './Icons';
import SearchableSelect from './SearchableSelect';
import NumberInput from './NumberInput';
import HoverTooltip from './HoverTooltip';

interface Props {
  rawMaterials: RawMaterial[];
  components: PackagingComponent[];
  ingredients: RecipeIngredient[];
  packaging: RecipePackaging[];
  onIngredientsChange: (next: RecipeIngredient[]) => void;
  onPackagingChange: (next: RecipePackaging[]) => void;
  readOnly?: boolean;
}

const RecipeEditor: React.FC<Props> = ({
  rawMaterials,
  components,
  ingredients,
  packaging,
  onIngredientsChange,
  onPackagingChange,
  readOnly = false,
}) => {
  const t = useT();

  const rawOptions = useMemo(
    () =>
      rawMaterials.map((rm) => ({
        value: rm.id,
        label: rm.name,
        hint: rm.factorySupplied ? '(factory)' : undefined,
      })),
    [rawMaterials],
  );

  const componentOptions = useMemo(
    () =>
      components.map((c) => ({
        value: c.id,
        label: c.name,
        hint: c.type ? `(${c.type})` : undefined,
      })),
    [components],
  );

  const sumPercent = ingredients.reduce((acc, i) => acc + (i.percentage || 0), 0);
  const overflow = sumPercent > 100.0001;
  const underflow = sumPercent < 99.9999;

  const updateIngredient = (idx: number, patch: Partial<RecipeIngredient>) => {
    const next = ingredients.slice();
    next[idx] = { ...next[idx], ...patch };
    onIngredientsChange(next);
  };

  const updatePackaging = (idx: number, patch: Partial<RecipePackaging>) => {
    const next = packaging.slice();
    next[idx] = { ...next[idx], ...patch };
    onPackagingChange(next);
  };

  const removeIngredient = (idx: number) =>
    onIngredientsChange(ingredients.filter((_, i) => i !== idx));
  const removePackaging = (idx: number) =>
    onPackagingChange(packaging.filter((_, i) => i !== idx));

  const addIngredient = () => {
    const firstUnused = rawMaterials.find(
      (rm) => !ingredients.some((i) => i.rawMaterialId === rm.id),
    );
    if (!firstUnused) return;
    onIngredientsChange([...ingredients, { rawMaterialId: firstUnused.id, percentage: 0 }]);
  };

  const addPackaging = () => {
    const firstUnused = components.find(
      (c) => !packaging.some((p) => p.componentId === c.id),
    );
    if (!firstUnused) return;
    onPackagingChange([...packaging, { componentId: firstUnused.id, qtyPerUnit: 1 }]);
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <strong>{t.ingredients}</strong>
        {overflow || underflow ? (
          <HoverTooltip
            triggerClassName={`recipe-sum-pct ${overflow ? 'error-text' : 'warn-text'}`}
            trigger={<>Σ {sumPercent.toFixed(2)} %</>}
          >
            <div>{overflow ? t.recipeSumError : t.recipeSumWarning}</div>
          </HoverTooltip>
        ) : (
          <span className="hint">Σ {sumPercent.toFixed(2)} %</span>
        )}
        <div className="spacer" />
        {!readOnly && (
          <button
            className="btn btn-sm soft-edit"
            onClick={addIngredient}
            disabled={ingredients.length >= rawMaterials.length}
          >
            <IconPlus size={13} /> {t.add}
          </button>
        )}
      </div>

      <table className="table" style={{ marginBottom: 16 }}>
        <thead>
          <tr>
            <th>{t.name}</th>
            <th className="num">{t.percentage}</th>
            {!readOnly && <th className="actions">{t.actionsHeader}</th>}
          </tr>
        </thead>
        <tbody>
          {ingredients.length === 0 && (
            <tr>
              <td colSpan={readOnly ? 2 : 3} className="hint">
                {t.noData}
              </td>
            </tr>
          )}
          {ingredients.map((ing, idx) => (
            <tr key={idx}>
              <td>
                <SearchableSelect
                  options={rawOptions}
                  value={ing.rawMaterialId}
                  onChange={(val) => updateIngredient(idx, { rawMaterialId: val })}
                  placeholder={t.search}
                  disabled={readOnly}
                />
              </td>
              <td className="num">
                <NumberInput
                  className="input"
                  step="0.01"
                  style={{ width: 100 }}
                  value={ing.percentage}
                  emptyValue={0}
                  onChange={(v) => updateIngredient(idx, { percentage: v ?? 0 })}
                  disabled={readOnly}
                />
              </td>
              {!readOnly && (
                <td className="actions">
                  <button
                    className="btn btn-sm soft-danger btn-icon-only"
                    onClick={() => removeIngredient(idx)}
                    title={t.delete}
                  >
                    <IconClose size={12} />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="row" style={{ marginBottom: 12 }}>
        <strong>{t.packaging}</strong>
        <div className="spacer" />
        {!readOnly && (
          <button
            className="btn btn-sm soft-edit"
            onClick={addPackaging}
            disabled={packaging.length >= components.length}
          >
            <IconPlus size={13} /> {t.add}
          </button>
        )}
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>{t.name}</th>
            <th className="num">{t.qtyPerUnit}</th>
            {!readOnly && <th className="actions">{t.actionsHeader}</th>}
          </tr>
        </thead>
        <tbody>
          {packaging.length === 0 && (
            <tr>
              <td colSpan={readOnly ? 2 : 3} className="hint">
                {t.noData}
              </td>
            </tr>
          )}
          {packaging.map((pkg, idx) => (
            <tr key={idx}>
              <td>
                <SearchableSelect
                  options={componentOptions}
                  value={pkg.componentId}
                  onChange={(val) => updatePackaging(idx, { componentId: val })}
                  placeholder={t.search}
                  disabled={readOnly}
                />
              </td>
              <td className="num">
                <NumberInput
                  className="input"
                  style={{ width: 100 }}
                  value={pkg.qtyPerUnit}
                  emptyValue={0}
                  onChange={(v) => updatePackaging(idx, { qtyPerUnit: v ?? 0 })}
                  disabled={readOnly}
                />
              </td>
              {!readOnly && (
                <td className="actions">
                  <button
                    className="btn btn-sm soft-danger btn-icon-only"
                    onClick={() => removePackaging(idx)}
                    title={t.delete}
                  >
                    <IconClose size={12} />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default RecipeEditor;
