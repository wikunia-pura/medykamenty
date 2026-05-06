import React, { useRef, useState } from 'react';

interface Props {
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  title: string;
  subtitle: string;
  dragOverLabel: string;
  selectedFiles?: { name: string; path: string }[];
  onFilesSelected: (files: { name: string; path: string }[]) => void;
  onRemoveFile?: (path: string) => void;
  removeFileLabel?: string;
}

const DropZone: React.FC<Props> = ({
  accept = '.xlsx',
  multiple = true,
  disabled = false,
  title,
  subtitle,
  dragOverLabel,
  selectedFiles = [],
  onFilesSelected,
  onRemoveFile,
  removeFileLabel,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    const next: { name: string; path: string }[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i] as File & { path?: string };
      if (!f.path) continue;
      next.push({ name: f.name, path: f.path });
    }
    if (next.length > 0) onFilesSelected(next);
  };

  const onClick = () => {
    if (disabled) return;
    inputRef.current?.click();
  };

  return (
    <div
      className={`drop-zone${dragOver ? ' drag-over' : ''}${disabled ? ' disabled' : ''}`}
      onClick={onClick}
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        e.stopPropagation();
        if (!dragOver) setDragOver(true);
      }}
      onDragEnter={(e) => {
        if (disabled) return;
        e.preventDefault();
        e.stopPropagation();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        if (disabled) return;
        handleFiles(e.dataTransfer.files);
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="drop-zone-icon">⇪</div>
      <div className="drop-zone-title">{dragOver ? dragOverLabel : title}</div>
      <div className="drop-zone-sub">{subtitle}</div>
      {selectedFiles.length > 0 && (
        <div className="drop-zone-files" onClick={(e) => e.stopPropagation()}>
          {selectedFiles.map((f) => (
            <div key={f.path} className="drop-zone-file-chip">
              <span>📄 {f.name}</span>
              {onRemoveFile && (
                <span
                  className="clear"
                  role="button"
                  aria-label={removeFileLabel}
                  title={removeFileLabel}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveFile(f.path);
                  }}
                >
                  ✕
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        style={{ display: 'none' }}
        onChange={(e) => {
          handleFiles(e.target.files);
          if (inputRef.current) inputRef.current.value = '';
        }}
      />
    </div>
  );
};

export default DropZone;
