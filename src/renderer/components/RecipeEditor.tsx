import React, { useMemo } from 'react';
import type {
  RawMaterial,
  PackagingComponent,
  PackingScheme,
  PackingTier,
  RecipeIngredient,
  RecipePackaging,
} from '../../shared/types';
import { isSecondaryComponent } from '../../shared/types';
import { useT } from '../i18n';
import { IconPlus, IconClose } from './Icons';
import SearchableSelect from './SearchableSelect';
import NumberInput from './NumberInput';
import HoverTooltip from './HoverTooltip';

// When set, only one section of the editor is shown — used by the product
// modal's tabbed layout so each tab renders just its concern. Default 'all'
// preserves the legacy single-pane layout for any other caller.
export type RecipeEditorSection =
  | 'all'
  | 'ingredients'
  | 'packaging'
  | 'packingScheme';

interface Props {
  rawMaterials: RawMaterial[];
  components: PackagingComponent[];
  ingredients: RecipeIngredient[];
  packaging: RecipePackaging[];
  packingScheme?: PackingScheme;
  // Needed to auto-derive consumption for `kg` / `l` capacity-unit tiers
  // (barrel of bulk: kg = capacityMl × density / 1000, l = capacityMl / 1000).
  productCapacityMl: number;
  productDensityGPerMl: number;
  section?: RecipeEditorSection;
  onIngredientsChange: (next: RecipeIngredient[]) => void;
  onPackagingChange: (next: RecipePackaging[]) => void;
  onPackingSchemeChange: (next: PackingScheme | undefined) => void;
  readOnly?: boolean;
}

const RecipeEditor: React.FC<Props> = ({
  rawMaterials,
  components,
  ingredients,
  packaging,
  packingScheme,
  productCapacityMl,
  productDensityGPerMl,
  section = 'all',
  onIngredientsChange,
  onPackagingChange,
  onPackingSchemeChange,
  readOnly = false,
}) => {
  const showIngredients = section === 'all' || section === 'ingredients';
  const showPackaging = section === 'all' || section === 'packaging';
  const showScheme = section === 'all' || section === 'packingScheme';
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

  // Primary section uses non-secondary components only. Secondary lives in
  // the packing scheme below.
  const primaryComponentOptions = useMemo(
    () =>
      components
        .filter((c) => !isSecondaryComponent(c.type))
        .map((c) => ({
          value: c.id,
          label: c.name,
          hint: c.type ? `(${c.type})` : undefined,
        })),
    [components],
  );

  // Both kinds attach here: the component's "typ opakowania" decides which
  // production consumes it — 'product' binds to finished units (plan items),
  // 'mass' binds to bulk-mass production (plan bulkMass).
  const kindLabel = (c: PackagingComponent) =>
    (c.packagingKind ?? 'product') === 'mass' ? t.packagingKindMass : t.packagingKindProduct;

  const secondaryComponentOptions = useMemo(
    () =>
      components
        .filter((c) => isSecondaryComponent(c.type))
        .map((c) => ({
          value: c.id,
          label: c.name,
          hint: kindLabel(c),
        })),
    [components, t],
  );

  const componentById = useMemo(
    () => new Map(components.map((c) => [c.id, c])),
    [components],
  );

  const schemeTiers: PackingTier[] = packingScheme?.tiers ?? [];

  const updateTier = (idx: number, patch: Partial<PackingTier>) => {
    const next = schemeTiers.slice();
    next[idx] = { ...next[idx], ...patch };
    onPackingSchemeChange({ tiers: next });
  };

  const removeTier = (idx: number) => {
    const next = schemeTiers.filter((_, i) => i !== idx);
    onPackingSchemeChange(next.length > 0 ? { tiers: next } : undefined);
  };

  const addTier = () => {
    const firstUnused = components.find(
      (c) => isSecondaryComponent(c.type) && !schemeTiers.some((tt) => tt.componentId === c.id),
    );
    if (!firstUnused) return;
    // For 'units'/'m' default consumption=1. For 'kg'/'l' we leave it as 0
    // and let walkSchemeConsumption auto-derive (consumptionOverride
    // defaults to false). The displayed value below shows the derived
    // amount so the user can confirm.
    onPackingSchemeChange({
      tiers: [...schemeTiers, { componentId: firstUnused.id, consumption: 1 }],
    });
  };

  // Default consumption for per_unit + kg/l: product mass / volume (one
  // finished product's worth of bulk).
  const derivedConsumption = (comp: PackagingComponent | undefined): number => {
    if (!comp) return 1;
    const unit = comp.capacityUnit ?? 'units';
    if (unit === 'kg') return (productCapacityMl * productDensityGPerMl) / 1000;
    if (unit === 'l') return productCapacityMl / 1000;
    return 1;
  };

  // Effective consumption per finished product for 'product'-kind packaging —
  // mirrors packingConsumption.ts. 'Mass'-kind binds to bulk production, not
  // finished units, so it has its own display below.
  const effectiveConsumptionPerProduct = (
    comp: PackagingComponent | undefined,
    tier: PackingTier,
  ): number => {
    if (!comp) return 0;
    const unit = comp.capacityUnit ?? 'units';
    // A product always occupies exactly 1 slot — mirrors packingConsumption.ts.
    if (unit === 'units') return 1;
    if ((unit === 'kg' || unit === 'l') && !tier.consumptionOverride) {
      return derivedConsumption(comp);
    }
    return tier.consumption;
  };

  const piecesPerProductDisplay = (
    comp: PackagingComponent | undefined,
    effectiveConsumption: number,
  ): string => {
    if (!comp || !comp.capacity || comp.capacity <= 0) return '?';
    const pieces = effectiveConsumption / comp.capacity;
    if (pieces <= 0 || !Number.isFinite(pieces)) return '?';
    if (pieces >= 1) return `${pieces.toFixed(3)} szt./produkt`;
    return `1 / ${(1 / pieces).toFixed(0)} produkt.`;
  };

  // 'Mass'-kind: how many kg of bulk one piece holds (barrel 120 l × density,
  // bag 25 kg / consumption-per-kg). '?' when the math cannot resolve.
  const bulkKgPerPieceDisplay = (comp: PackagingComponent, tier: PackingTier): string => {
    const unit = comp.capacityUnit ?? 'units';
    const capacity = comp.capacity ?? 0;
    const consumption = tier.consumption || 1;
    if (capacity <= 0 || consumption <= 0) return '?';
    let kgPerPiece = 0;
    if (unit === 'kg') kgPerPiece = capacity / consumption;
    else if (unit === 'l') {
      if (!productDensityGPerMl || productDensityGPerMl <= 0) return '?';
      kgPerPiece = (capacity * productDensityGPerMl) / consumption;
    } else return '?'; // units/m capacity is invalid for mass packaging
    return t.packingMassPerPiece.replace(
      '{kg}',
      kgPerPiece.toLocaleString(undefined, { maximumFractionDigits: 2 }),
    );
  };

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
    // Only offer non-secondary components — secondary goes into the
    // "Opakowanie zbiorcze" section below.
    const firstUnused = components.find(
      (c) => !isSecondaryComponent(c.type) && !packaging.some((p) => p.componentId === c.id),
    );
    if (!firstUnused) return;
    onPackagingChange([...packaging, { componentId: firstUnused.id, qtyPerUnit: 1 }]);
  };

  return (
    <div>
      {showIngredients && (<>
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
      </>)}

      {showPackaging && (<>
      <div className="row" style={{ marginBottom: 12 }}>
        <strong>{t.packaging}</strong>
        <div className="spacer" />
        {!readOnly && (
          <button
            className="btn btn-sm soft-edit"
            onClick={addPackaging}
            disabled={packaging.length >= primaryComponentOptions.length}
          >
            <IconPlus size={13} /> {t.add}
          </button>
        )}
      </div>
      <table className="table" style={{ marginBottom: 16 }}>
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
                  options={primaryComponentOptions}
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
      </>)}

      {showScheme && (<>
      <div className="row" style={{ marginBottom: 12 }}>
        <strong>{t.packingScheme}</strong>
        <span className="hint" style={{ marginLeft: 8 }}>{t.packingSchemeHint}</span>
        <div className="spacer" />
        {!readOnly && (
          <button
            className="btn btn-sm soft-edit"
            onClick={addTier}
            disabled={schemeTiers.length >= secondaryComponentOptions.length}
          >
            <IconPlus size={13} /> {t.add}
          </button>
        )}
      </div>
      <table className="table" style={{ tableLayout: 'fixed' }}>
        <colgroup>
          <col />
          <col style={{ width: 160 }} />
          <col style={{ width: 150 }} />
          <col style={{ width: 200 }} />
          {!readOnly && <col style={{ width: 60 }} />}
        </colgroup>
        <thead>
          <tr>
            <th>{t.name}</th>
            <th>{t.packagingKind}</th>
            <th className="num">{t.packingConsumption}</th>
            <th>{t.packingPerProduct}</th>
            {!readOnly && <th className="actions">{t.actionsHeader}</th>}
          </tr>
        </thead>
        <tbody>
          {schemeTiers.length === 0 && (
            <tr>
              <td colSpan={readOnly ? 4 : 5} className="hint">
                {t.noData}
              </td>
            </tr>
          )}
          {schemeTiers.map((tier, idx) => {
            const comp = componentById.get(tier.componentId);
            const unit = comp?.capacityUnit ?? 'units';
            const unitLabel = unit === 'units' ? t.unitUnits : unit;
            // The component's "typ opakowania" decides the semantics:
            // 'product' — per finished unit; 'mass' — per kg of bulk.
            const isMass = (comp?.packagingKind ?? 'product') === 'mass';
            // Auto-derive only applies to product-kind + kg/l. For mass-kind
            // the user enters consumption per kg of bulk (typically 1).
            const isAutoDeriveCandidate = !isMass && (unit === 'kg' || unit === 'l');
            const isAuto = isAutoDeriveCandidate && !tier.consumptionOverride;
            // 'units' capacity has no per-product slot definition anymore —
            // a product always takes exactly 1 slot.
            const isFixedOneUnit = !isMass && unit === 'units';
            const displayedConsumption = isFixedOneUnit
              ? 1
              : isAuto
                ? derivedConsumption(comp)
                : tier.consumption;
            const effective = effectiveConsumptionPerProduct(comp, {
              ...tier,
              consumption: displayedConsumption,
            });
            const needsReview = !!tier.note;
            const capacityMissing = !comp?.capacity || comp.capacity <= 0;
            const bulkUnitInvalid = isMass && (unit === 'units' || unit === 'm');
            const inputUnitLabel = isMass
              ? `${unitLabel} / kg masy`
              : `${unitLabel} / produkt`;
            return (
              <tr key={idx}>
                <td className="col-wrap">
                  <SearchableSelect
                    options={secondaryComponentOptions}
                    value={tier.componentId}
                    onChange={(val) => {
                      updateTier(idx, {
                        componentId: val,
                        consumptionOverride: false,
                        consumption: 1,
                        note: undefined,
                      });
                    }}
                    placeholder={t.search}
                    disabled={readOnly}
                  />
                  {needsReview && (
                    <div className="warn-text" style={{ fontSize: 11, marginTop: 2 }}>
                      {tier.note}
                    </div>
                  )}
                  {capacityMissing && comp && (
                    <div className="warn-text" style={{ fontSize: 11, marginTop: 2 }}>
                      {t.packingCapacityMissing.replace('{name}', comp.name)}
                    </div>
                  )}
                  {bulkUnitInvalid && (
                    <div className="warn-text" style={{ fontSize: 11, marginTop: 2 }}>
                      {t.packingBulkUnitInvalid}
                    </div>
                  )}
                </td>
                <td>
                  <span className="hint">{comp ? kindLabel(comp) : '—'}</span>
                </td>
                <td className="num">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {isFixedOneUnit ? (
                      <>
                        <div>1</div>
                        <div className="hint" style={{ fontSize: 11 }}>
                          {inputUnitLabel}
                          <br />
                          {t.packingFixedOneUnit}
                        </div>
                      </>
                    ) : (
                      <>
                        <NumberInput
                          className="input"
                          step="0.001"
                          style={{ width: 110 }}
                          value={displayedConsumption}
                          emptyValue={0}
                          onChange={(v) => {
                            const c = v ?? 0;
                            updateTier(idx, {
                              consumption: c,
                              consumptionOverride: isAutoDeriveCandidate ? true : undefined,
                              note: undefined,
                            });
                          }}
                          disabled={readOnly || isAuto}
                        />
                        <div className="hint" style={{ fontSize: 11 }}>
                          {inputUnitLabel}
                        </div>
                      </>
                    )}
                    {isAutoDeriveCandidate && (
                      <label
                        style={{
                          fontSize: 11,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={!!tier.consumptionOverride}
                          disabled={readOnly}
                          onChange={(e) => {
                            const override = e.target.checked;
                            updateTier(idx, {
                              consumptionOverride: override,
                              consumption: override
                                ? displayedConsumption
                                : tier.consumption,
                            });
                          }}
                        />
                        {t.packingConsumptionOverride}
                      </label>
                    )}
                  </div>
                </td>
                <td className="col-wrap">
                  {comp && comp.capacity && comp.capacity > 0 ? (
                    <div className="hint" style={{ fontSize: 11 }}>
                      1 {comp.name} = {comp.capacity.toLocaleString()} {unitLabel}
                      <br />→{' '}
                      {isMass
                        ? bulkKgPerPieceDisplay(comp, { ...tier, consumption: displayedConsumption })
                        : piecesPerProductDisplay(comp, effective)}
                    </div>
                  ) : (
                    <span className="hint">—</span>
                  )}
                </td>
                {!readOnly && (
                  <td className="actions">
                    <button
                      className="btn btn-sm soft-danger btn-icon-only"
                      onClick={() => removeTier(idx)}
                      title={t.delete}
                    >
                      <IconClose size={12} />
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      </>)}
    </div>
  );
};

export default RecipeEditor;
