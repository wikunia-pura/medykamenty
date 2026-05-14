import React from 'react';
import type {
  Product,
  RawMaterial,
  PackagingComponent,
  RecipeIngredient,
  RecipePackaging,
} from '../../shared/types';
import { useT } from '../i18n';
import ModalHeader from './ModalHeader';
import RecipeEditor from './RecipeEditor';
import NumberInput from './NumberInput';
import { IconPlus, IconEdit, IconEye } from './Icons';
import { useEscapeKey } from '../utils/useEscapeKey';

interface Props {
  editing: Partial<Product>;
  rawMaterials: RawMaterial[];
  components: PackagingComponent[];
  setEditing: (next: Partial<Product>) => void;
  onCancel: () => void;
  onSave: () => void | Promise<void>;
  error?: string | null;
  readOnly?: boolean;
  onEnterEdit?: () => void;
}

const ProductEditorModal: React.FC<Props> = ({
  editing,
  rawMaterials,
  components,
  setEditing,
  onCancel,
  onSave,
  error,
  readOnly = false,
  onEnterEdit,
}) => {
  const t = useT();
  useEscapeKey(onCancel);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className={`modal modal-lg${readOnly ? ' modal-readonly' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <ModalHeader
          icon={
            readOnly ? (
              <IconEye size={18} />
            ) : editing.id ? (
              <IconEdit size={18} />
            ) : (
              <IconPlus size={18} />
            )
          }
          tone={readOnly ? 'edit' : editing.id ? 'edit' : 'add'}
          title={
            readOnly
              ? `${t.preview}: ${editing.name ?? ''}`
              : editing.id
                ? `${t.edit}: ${editing.name ?? ''}`
                : `${t.add} — ${t.products.toLowerCase()}`
          }
          onClose={onCancel}
        />

        {editing.id && (editing.createdAt || editing.updatedAt) && (
          <div className="modal-meta-strip">
            {editing.createdAt && (
              <span>
                <span className="hint">{t.planCreatedAt}:</span>{' '}
                {new Date(editing.createdAt).toLocaleString()}
              </span>
            )}
            {editing.updatedAt && (
              <span>
                <span className="hint">{t.planUpdatedAt}:</span>{' '}
                {new Date(editing.updatedAt).toLocaleString()}
              </span>
            )}
          </div>
        )}

        <div className="modal-body">
          <div className="modal-section">
            <div className="modal-section-header">
              <h3 className="modal-section-title">Podstawowe dane</h3>
            </div>
            <div className="form-row">
              <label>{t.name}</label>
              <input
                className="input"
                value={editing.name ?? ''}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                disabled={readOnly}
              />
            </div>
            <div className="form-row">
              <label>SKU</label>
              <input
                className="input"
                value={editing.sku ?? ''}
                onChange={(e) => setEditing({ ...editing, sku: e.target.value })}
                disabled={readOnly}
              />
            </div>
            <div className="form-row">
              <label>{t.capacityMl}</label>
              <NumberInput
                className="input"
                step="0.1"
                value={editing.capacityMl ?? 0}
                emptyValue={0}
                onChange={(v) => setEditing({ ...editing, capacityMl: v ?? 0 })}
                disabled={readOnly}
              />
            </div>
            <div className="form-row">
              <label>{t.density}</label>
              <NumberInput
                className="input"
                step="0.001"
                value={editing.densityGPerMl ?? 1}
                emptyValue={1}
                onChange={(v) => setEditing({ ...editing, densityGPerMl: v ?? 1 })}
                disabled={readOnly}
              />
            </div>
            <div className="form-row">
              <label>{t.laborCost}</label>
              <NumberInput
                className="input"
                step="0.01"
                value={editing.conversionLaborCost}
                onChange={(v) => setEditing({ ...editing, conversionLaborCost: v })}
                disabled={readOnly}
              />
            </div>
            <div className="form-row">
              <label>{t.moqUnits}</label>
              <NumberInput
                className="input"
                step="1"
                value={editing.moqUnits}
                onChange={(v) => setEditing({ ...editing, moqUnits: v })}
                disabled={readOnly}
              />
            </div>
            <div className="form-row">
              <label>{t.sachetMassKg}</label>
              <NumberInput
                className="input"
                step="0.01"
                value={editing.sachetMassKg}
                onChange={(v) => setEditing({ ...editing, sachetMassKg: v })}
                disabled={readOnly}
              />
            </div>
            <div className="form-row">
              <label>{t.sachetsCount}</label>
              <NumberInput
                className="input"
                step="1"
                value={editing.sachetsCount}
                onChange={(v) => setEditing({ ...editing, sachetsCount: v })}
                disabled={readOnly}
              />
            </div>
            <div className="form-row">
              <label>{t.notes}</label>
              <textarea
                value={editing.notes ?? ''}
                onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                disabled={readOnly}
              />
            </div>
          </div>

          <div className="modal-section">
            <div className="modal-section-header">
              <h3 className="modal-section-title">{t.ingredients} & {t.packaging}</h3>
            </div>
            <RecipeEditor
              rawMaterials={rawMaterials}
              components={components}
              ingredients={editing.ingredients ?? []}
              packaging={editing.packaging ?? []}
              onIngredientsChange={(next: RecipeIngredient[]) =>
                setEditing({ ...editing, ingredients: next })
              }
              onPackagingChange={(next: RecipePackaging[]) =>
                setEditing({ ...editing, packaging: next })
              }
              readOnly={readOnly}
            />
          </div>

          {error && <div className="error-text">{error}</div>}
        </div>

        <div className="modal-footer">
          {readOnly ? (
            <>
              {onEnterEdit && (
                <button className="btn" onClick={onEnterEdit}>
                  <IconEdit size={13} /> {t.edit}
                </button>
              )}
              <button className="btn primary-filled" onClick={onCancel}>
                {t.close}
              </button>
            </>
          ) : (
            <>
              <button className="btn" onClick={onCancel}>
                {t.cancel}
              </button>
              <button
                className="btn primary-filled"
                onClick={() => void onSave()}
                disabled={!editing.name?.trim()}
              >
                {t.save}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProductEditorModal;
