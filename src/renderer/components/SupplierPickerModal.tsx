import React, { useState } from 'react';
import type { Supplier, SupplierType } from '../../shared/types';
import { useT } from '../i18n';
import SearchableSelect from './SearchableSelect';
import ModalHeader from './ModalHeader';
import { IconClose, IconEdit, IconCheck } from './Icons';
import { useEscapeKey } from '../utils/useEscapeKey';

interface Props {
  suppliers: Supplier[];
  // Pre-select this supplier in the picker (omit for an "unassigned" group/email).
  currentSupplierId?: string;
  // Restricts the dropdown to suppliers whose `type` matches (legacy suppliers
  // without a type still appear). Omit to show everyone.
  typeFilter?: SupplierType;
  // Modal title; falls back to a sensible default per the assigned/unassigned state.
  title?: string;
  onCancel: () => void;
  onPick: (supplierId: string) => void | Promise<void>;
}

const SupplierPickerModal: React.FC<Props> = ({
  suppliers,
  currentSupplierId,
  typeFilter,
  title,
  onCancel,
  onPick,
}) => {
  const t = useT();
  const [selected, setSelected] = useState<string>(currentSupplierId ?? '');
  const [saving, setSaving] = useState(false);

  useEscapeKey(() => {
    if (!saving) onCancel();
  });

  const filtered = typeFilter
    ? suppliers.filter((s) => !s.type || s.type === typeFilter)
    : suppliers;

  const options = filtered
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => ({ value: s.id, label: s.name, hint: s.email || undefined }));

  const isUnassigned = !currentSupplierId;
  const confirm = async () => {
    if (!selected || selected === currentSupplierId || saving) return;
    setSaving(true);
    try {
      await onPick(selected);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={() => {
        if (!saving) onCancel();
      }}
    >
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <ModalHeader
          icon={isUnassigned ? <IconCheck size={18} /> : <IconEdit size={18} />}
          tone={isUnassigned ? 'add' : 'edit'}
          title={title ?? (isUnassigned ? t.assignSupplier : t.changeSupplier)}
          onClose={onCancel}
        />
        <div className="modal-body">
          <div className="form-row">
            <label>{t.supplier}</label>
            <SearchableSelect
              options={options}
              value={selected}
              onChange={setSelected}
              placeholder={t.selectSupplier}
              disabled={saving}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onCancel} disabled={saving}>
            <IconClose size={12} /> {t.cancel}
          </button>
          <button
            type="button"
            className="btn primary-filled"
            onClick={() => void confirm()}
            disabled={!selected || selected === currentSupplierId || saving}
          >
            <IconCheck size={13} /> {saving ? t.loading : t.save}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SupplierPickerModal;
