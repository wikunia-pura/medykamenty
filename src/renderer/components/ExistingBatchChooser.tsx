import React from 'react';
import type { EmailBatch } from '../../shared/types';
import { useT } from '../i18n';
import ModalHeader from './ModalHeader';
import { useEscapeKey } from '../utils/useEscapeKey';
import { IconArrowLeft, IconClose, IconMail, IconPlus } from './Icons';

interface Props {
  batches: EmailBatch[];
  onOpen: (batch: EmailBatch) => void;
  onCreateNew: () => void;
  onCancel: () => void;
}

const ExistingBatchChooser: React.FC<Props> = ({
  batches,
  onOpen,
  onCreateNew,
  onCancel,
}) => {
  const t = useT();
  useEscapeKey(onCancel);
  const isSingle = batches.length === 1;
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal modal-md existing-batch-chooser"
        onClick={(e) => e.stopPropagation()}
      >
        <ModalHeader
          icon={<IconMail size={18} />}
          tone="edit"
          title={t.existingBatchChooserTitle}
          subtitle={
            isSingle ? t.existingBatchChooserHintOne : t.existingBatchChooserHint
          }
          onClose={onCancel}
        />
        <div className="modal-body">
          <ul className="existing-batch-list">
            {batches.map((b, idx) => {
              const sent = b.emails.filter((e) => !!e.sentAt).length;
              const total = b.emails.length;
              const allSent = total > 0 && sent === total;
              const isLatest = idx === 0;
              return (
                <li key={b.id} className="existing-batch-row">
                  <button
                    type="button"
                    className="existing-batch-row-btn"
                    onClick={() => onOpen(b)}
                    title={t.existingBatchOpenAction}
                  >
                    <span className="existing-batch-row-main">
                      <span className="existing-batch-row-title">
                        {b.batchName || b.reportName}
                        {isLatest && !isSingle && (
                          <span className="tag" style={{ marginLeft: 8 }}>
                            {t.existingBatchOpenLatestAction}
                          </span>
                        )}
                      </span>
                      <span className="hint existing-batch-row-meta">
                        {new Date(b.generatedAt).toLocaleString()}
                      </span>
                    </span>
                    <span className="existing-batch-row-stats">
                      <span
                        className={`tag ${
                          allSent ? 'success' : sent > 0 ? 'warn' : ''
                        }`}
                      >
                        {sent}/{total} {t.sentCount}
                      </span>
                      <IconArrowLeft
                        size={12}
                        className="existing-batch-row-arrow"
                      />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onCancel}>
            <IconClose size={12} /> {t.existingBatchCancelAction}
          </button>
          <button
            type="button"
            className="btn soft-edit"
            onClick={onCreateNew}
            title={t.existingBatchCreateNewAction}
          >
            <IconPlus size={13} /> {t.existingBatchCreateNewAction}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExistingBatchChooser;
