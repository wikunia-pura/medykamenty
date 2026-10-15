import React, { useState } from 'react';
import type { DateOnly, ShortageLine } from '../../shared/types';
import { useT } from '../i18n';
import ModalHeader from './ModalHeader';
import { IconCheck, IconCopy, IconMail } from './Icons';
import { useEscapeKey } from '../utils/useEscapeKey';
import { buildWarehouseMail } from '../utils/warehouseMail';

// Above this the mailto: link risks being cut by the mail client (Outlook on
// Windows caps the URL around 2k characters), so the modal steers to "Copy".
const MAILTO_SAFE_LENGTH = 1800;

interface Props {
  runName: string;
  rawLines: ShortageLine[];
  componentLines: ShortageLine[];
  // Suppliers whose delivery is still not marked as received — empty means
  // everything is complete and the list can go to the warehouse.
  pendingSuppliers: string[];
  initialDate: DateOnly;
  initialTo: string;
  sentAt?: string;
  onSaveTo: (to: string) => void;
  onToggleSent: (prepareFor: DateOnly | null) => Promise<void>;
  onClose: () => void;
}

const WarehouseMailModal: React.FC<Props> = ({
  runName,
  rawLines,
  componentLines,
  pendingSuppliers,
  initialDate,
  initialTo,
  sentAt,
  onSaveTo,
  onToggleSent,
  onClose,
}) => {
  const t = useT();
  useEscapeKey(onClose);
  const [date, setDate] = useState<DateOnly>(initialDate);
  const [to, setTo] = useState(initialTo);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = (d: DateOnly) =>
    d ? buildWarehouseMail({ prepareFor: d, runName, rawLines, componentLines }) : null;
  const initialMail = generate(initialDate);
  const [subject, setSubject] = useState(initialMail?.subject ?? '');
  const [body, setBody] = useState(initialMail?.body ?? '');

  // The date is the input of the generated text — changing it rebuilds subject
  // and body (manual edits are meant as a last step).
  const regenerate = (d: DateOnly) => {
    const mail = generate(d);
    setSubject(mail?.subject ?? '');
    setBody(mail?.body ?? '');
  };

  const mailtoHref = `mailto:${encodeURIComponent(to.trim())}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;
  const tooLong = mailtoHref.length > MAILTO_SAFE_LENGTH;

  // The last address used is remembered (local settings) and prefilled next
  // time — saved whenever the mail is actually used, not only on blur.
  const rememberTo = () => {
    const next = to.trim();
    if (next && next !== initialTo) onSaveTo(next);
  };

  const copy = async () => {
    rememberTo();
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError(t.copyFailed);
    }
  };

  const toggleSent = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!sentAt) rememberTo();
      await onToggleSent(sentAt ? null : date);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg warehouse-mail-modal" onClick={(e) => e.stopPropagation()}>
        <ModalHeader
          icon={<IconMail size={18} />}
          tone="edit"
          title={t.warehouseMail}
          subtitle={runName}
          onClose={onClose}
        />
        <div className="modal-body">
          <div className={`warehouse-status${pendingSuppliers.length === 0 ? ' is-complete' : ''}`}>
            {pendingSuppliers.length === 0
              ? t.warehouseCompleteBanner
              : t.warehouseAwaitingBanner.replace('{names}', pendingSuppliers.join(', '))}
          </div>
          <div className="hint" style={{ marginBottom: 14 }}>
            {t.warehouseMailHint}
          </div>
          <div className="form-row form-row-required">
            <label>{t.warehousePrepareFor}</label>
            <input
              type="date"
              className="input warehouse-mail-date"
              value={date}
              autoFocus={!date}
              // Chromium opens the calendar only from the small icon at the
              // field's end — open it from a click anywhere on the field.
              onClick={(e) => {
                try {
                  e.currentTarget.showPicker();
                } catch {
                  // Already open, or no user activation — the icon still works.
                }
              }}
              onChange={(e) => {
                setDate(e.target.value);
                regenerate(e.target.value);
              }}
            />
          </div>
          <div className="form-row">
            <label>{t.emailTo}</label>
            <input
              type="email"
              className="input"
              value={to}
              placeholder={t.warehouseEmail}
              onChange={(e) => setTo(e.target.value)}
              onBlur={() => {
                if (to.trim() !== initialTo) onSaveTo(to.trim());
              }}
            />
          </div>
          {date ? (
            <>
              <div className="form-row">
                <label>{t.emailSubject}</label>
                <input
                  className="input"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>
              <div className="form-row">
                <label>{t.emailBody}</label>
                <textarea
                  className="input warehouse-mail-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={Math.min(18, Math.max(8, body.split('\n').length + 1))}
                />
              </div>
              {tooLong && (
                <div className="hint warn-text">
                  {t.warehouseMailTooLong
                    .replace('{open}', t.openInMailClient)
                    .replace('{copy}', t.copy)}
                </div>
              )}
            </>
          ) : (
            <div className="hint">{t.warehousePickDateFirst}</div>
          )}
          {sentAt && (
            <div className="hint" style={{ marginTop: 10 }}>
              {t.sentAtLabel}: {new Date(sentAt).toLocaleString()}
            </div>
          )}
          {error && (
            <div className="error-text" style={{ marginTop: 10 }}>
              {error}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className={`btn ${sentAt ? 'soft-danger' : 'soft-success'}`}
            onClick={() => void toggleSent()}
            disabled={busy || (!sentAt && !date)}
          >
            <IconCheck size={13} /> {sentAt ? t.unmarkSent : t.markSent}
          </button>
          <div className="spacer" />
          <button
            type="button"
            className={`btn ${copied ? 'soft-success' : 'soft-edit'}`}
            onClick={() => void copy()}
            disabled={!date}
          >
            {copied ? <IconCheck size={13} /> : <IconCopy size={13} />} {copied ? t.copied : t.copy}
          </button>
          <button
            type="button"
            className="btn primary-filled"
            onClick={() => {
              rememberTo();
              void window.electronAPI.openExternal(mailtoHref);
            }}
            disabled={!date}
          >
            <IconMail size={13} /> {t.openInMailClient}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WarehouseMailModal;
