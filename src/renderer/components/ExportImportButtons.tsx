import React from 'react';
import { useT } from '../i18n';
import { IconExport, IconImport } from './Icons';

interface Props {
  format: 'csv' | 'json';
  onExport: () => void;
  onImport: () => void;
  disableExport?: boolean;
  busy?: boolean;
}

const ExportImportButtons: React.FC<Props> = ({
  format,
  onExport,
  onImport,
  disableExport,
  busy,
}) => {
  const t = useT();
  const exportLabel = format === 'csv' ? t.exportCsv : t.exportLabel;
  const importLabel = format === 'csv' ? t.importCsv : t.importLabel;
  return (
    <>
      <button
        className="btn btn-export"
        onClick={onExport}
        disabled={busy || disableExport}
        title={exportLabel}
      >
        <IconExport size={13} /> {exportLabel}
      </button>
      <button
        className="btn btn-import"
        onClick={onImport}
        disabled={busy}
        title={importLabel}
      >
        <IconImport size={13} /> {importLabel}
      </button>
    </>
  );
};

export default ExportImportButtons;
