import React, { useEffect, useState } from 'react';
import { useT } from '../i18n';
import type {
  Product,
  RawMaterial,
  PackagingComponent,
  RecipeIngredient,
  RecipePackaging,
} from '../../shared/types';
import ConfirmDialog from '../components/ConfirmDialog';
import RecipeEditor from '../components/RecipeEditor';

const Products: React.FC = () => {
  const t = useT();
  const [items, setItems] = useState<Product[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [components, setComponents] = useState<PackagingComponent[]>([]);
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    const [list, rms, cs] = await Promise.all([
      window.electronAPI.listProducts(),
      window.electronAPI.listRawMaterials(),
      window.electronAPI.listComponents(),
    ]);
    setItems(list);
    setRawMaterials(rms);
    setComponents(cs);
  };

  useEffect(() => {
    void reload();
  }, []);

  const onAdd = () =>
    setEditing({
      name: '',
      capacityMl: 100,
      densityGPerMl: 1.0,
      ingredients: [],
      packaging: [],
      archived: false,
    });

  const onSave = async () => {
    if (!editing || !editing.name?.trim()) return;
    setError(null);
    const sumPercent = (editing.ingredients ?? []).reduce(
      (acc, i) => acc + (i.percentage || 0),
      0,
    );
    if (sumPercent > 100.0001) {
      setError(t.recipeSumError);
      return;
    }
    const payload = {
      name: editing.name.trim(),
      sku: editing.sku?.trim() || undefined,
      capacityMl: editing.capacityMl ?? 0,
      densityGPerMl: editing.densityGPerMl ?? 1,
      conversionLaborCost: editing.conversionLaborCost,
      ingredients: editing.ingredients ?? [],
      packaging: editing.packaging ?? [],
      notes: editing.notes?.trim() || undefined,
      archived: !!editing.archived,
    };
    try {
      if (editing.id) {
        await window.electronAPI.updateProduct(editing.id, payload);
      } else {
        await window.electronAPI.createProduct(payload);
      }
      setEditing(null);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onDelete = async (p: Product) => {
    setConfirmDelete(null);
    await window.electronAPI.deleteProduct(p.id);
    await reload();
  };

  const onDuplicate = async (p: Product) => {
    const copy = await window.electronAPI.duplicateProduct(p.id);
    setEditing(copy);
    await reload();
  };

  return (
    <div className="main">
      <h1>{t.products}</h1>

      <div className="card">
        <div className="card-header">
          <div className="card-title">{items.length}</div>
          <button className="btn primary" onClick={onAdd}>
            + {t.add}
          </button>
        </div>
        {error && <div className="error-text" style={{ marginBottom: 8 }}>{error}</div>}
        <table className="table">
          <thead>
            <tr>
              <th>{t.name}</th>
              <th>SKU</th>
              <th className="num">{t.capacityMl}</th>
              <th className="num">{t.density}</th>
              <th className="num">{t.ingredients}</th>
              <th className="num">{t.packaging}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="hint">
                  {t.noData}
                </td>
              </tr>
            )}
            {items.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.sku ?? ''}</td>
                <td className="num">{p.capacityMl}</td>
                <td className="num">{p.densityGPerMl}</td>
                <td className="num">{p.ingredients.length}</td>
                <td className="num">{p.packaging.length}</td>
                <td>
                  <button className="btn btn-sm" onClick={() => setEditing(p)}>
                    {t.edit}
                  </button>{' '}
                  <button className="btn btn-sm" onClick={() => onDuplicate(p)}>
                    +
                  </button>{' '}
                  <button className="btn btn-sm" onClick={() => setConfirmDelete(p)}>
                    {t.delete}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
          onClick={() => setEditing(null)}
        >
          <div
            className="card"
            style={{ width: 720, maxWidth: '90vw', maxHeight: '90vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0 }}>
              {editing.id ? t.edit : t.add} — {t.products.toLowerCase()}
            </h2>
            <div className="form-row">
              <label>{t.name}</label>
              <input
                className="input"
                value={editing.name ?? ''}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>SKU</label>
              <input
                className="input"
                value={editing.sku ?? ''}
                onChange={(e) => setEditing({ ...editing, sku: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>{t.capacityMl}</label>
              <input
                className="input"
                type="number"
                step="0.1"
                value={editing.capacityMl ?? 0}
                onChange={(e) => setEditing({ ...editing, capacityMl: Number(e.target.value) })}
              />
            </div>
            <div className="form-row">
              <label>{t.density}</label>
              <input
                className="input"
                type="number"
                step="0.001"
                value={editing.densityGPerMl ?? 1}
                onChange={(e) => setEditing({ ...editing, densityGPerMl: Number(e.target.value) })}
              />
            </div>
            <div className="form-row">
              <label>{t.laborCost}</label>
              <input
                className="input"
                type="number"
                step="0.01"
                value={editing.conversionLaborCost ?? ''}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    conversionLaborCost:
                      e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
              />
            </div>
            <div className="form-row">
              <label>{t.notes}</label>
              <textarea
                value={editing.notes ?? ''}
                onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
              />
            </div>

            <h2>{t.ingredients} & {t.packaging}</h2>
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
            />

            <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn" onClick={() => setEditing(null)}>
                {t.cancel}
              </button>
              <button className="btn primary" onClick={onSave}>
                {t.save}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`${t.delete}: ${confirmDelete.name}?`}
          onConfirm={() => onDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
          danger
        />
      )}
    </div>
  );
};

export default Products;
