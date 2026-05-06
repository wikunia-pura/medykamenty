import React from 'react';
import type {
  RawMaterial,
  PackagingComponent,
  RecipeIngredient,
  RecipePackaging,
} from '../../shared/types';
import { useT } from '../i18n';

interface Props {
  rawMaterials: RawMaterial[];
  components: PackagingComponent[];
  ingredients: RecipeIngredient[];
  packaging: RecipePackaging[];
  onIngredientsChange: (next: RecipeIngredient[]) => void;
  onPackagingChange: (next: RecipePackaging[]) => void;
}

const RecipeEditor: React.FC<Props> = ({
  rawMaterials,
  components,
  ingredients,
  packaging,
  onIngredientsChange,
  onPackagingChange,
}) => {
  const t = useT();

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
        <span className={overflow ? 'error-text' : underflow ? 'warn-text' : 'hint'}>
          Σ {sumPercent.toFixed(2)} %
        </span>
        <div className="spacer" />
        <button
          className="btn btn-sm"
          onClick={addIngredient}
          disabled={ingredients.length >= rawMaterials.length}
        >
          + {t.add}
        </button>
      </div>
      {overflow && <div className="error-text">{t.recipeSumError}</div>}
      {underflow && !overflow && <div className="warn-text hint">{t.recipeSumWarning}</div>}

      <table className="table" style={{ marginBottom: 16 }}>
        <thead>
          <tr>
            <th>{t.name}</th>
            <th className="num">{t.percentage}</th>
            <th className="actions">{t.actionsHeader}</th>
          </tr>
        </thead>
        <tbody>
          {ingredients.length === 0 && (
            <tr>
              <td colSpan={3} className="hint">
                {t.noData}
              </td>
            </tr>
          )}
          {ingredients.map((ing, idx) => (
            <tr key={idx}>
              <td>
                <select
                  value={ing.rawMaterialId}
                  onChange={(e) => updateIngredient(idx, { rawMaterialId: e.target.value })}
                >
                  {rawMaterials.map((rm) => (
                    <option key={rm.id} value={rm.id}>
                      {rm.name}
                      {rm.factorySupplied ? ' (factory)' : ''}
                    </option>
                  ))}
                </select>
              </td>
              <td className="num">
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  style={{ width: 100, textAlign: 'right' }}
                  value={ing.percentage}
                  onChange={(e) =>
                    updateIngredient(idx, { percentage: Number(e.target.value) || 0 })
                  }
                />
              </td>
              <td className="actions">
                <button className="btn btn-sm" onClick={() => removeIngredient(idx)}>
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="row" style={{ marginBottom: 12 }}>
        <strong>{t.packaging}</strong>
        <div className="spacer" />
        <button
          className="btn btn-sm"
          onClick={addPackaging}
          disabled={packaging.length >= components.length}
        >
          + {t.add}
        </button>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>{t.name}</th>
            <th className="num">{t.qtyPerUnit}</th>
            <th className="actions">{t.actionsHeader}</th>
          </tr>
        </thead>
        <tbody>
          {packaging.length === 0 && (
            <tr>
              <td colSpan={3} className="hint">
                {t.noData}
              </td>
            </tr>
          )}
          {packaging.map((pkg, idx) => (
            <tr key={idx}>
              <td>
                <select
                  value={pkg.componentId}
                  onChange={(e) => updatePackaging(idx, { componentId: e.target.value })}
                >
                  {components.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.type})
                    </option>
                  ))}
                </select>
              </td>
              <td className="num">
                <input
                  className="input"
                  type="number"
                  style={{ width: 100, textAlign: 'right' }}
                  value={pkg.qtyPerUnit}
                  onChange={(e) =>
                    updatePackaging(idx, { qtyPerUnit: Number(e.target.value) || 0 })
                  }
                />
              </td>
              <td className="actions">
                <button className="btn btn-sm" onClick={() => removePackaging(idx)}>
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default RecipeEditor;
