import React from 'react';
import { useT, useLang } from '../i18n';
import HoverTooltip from './HoverTooltip';
import { IconHistory } from './Icons';
import type { PriceHistoryEntry } from '../../shared/types';

interface ListProps {
  history?: PriceHistoryEntry[];
  // Falls back to PLN when an entry carries no currency of its own.
  fallbackCurrency?: string;
}

// The last N price changes, newest first. The newest entry always mirrors the
// item's current price — it is flagged so the list reads as a timeline
// ("current since …") rather than a duplicate of the price beside it.
export const PriceHistoryList: React.FC<ListProps> = ({ history, fallbackCurrency }) => {
  const t = useT();
  const lang = useLang();
  const locale = lang === 'pl' ? 'pl-PL' : 'en-US';
  const entries = history ?? [];

  if (entries.length === 0) {
    return <div className="price-history-empty">{t.priceHistoryEmpty}</div>;
  }

  return (
    <ul className="price-history-list">
      {entries.map((e, i) => {
        const when = new Date(e.at);
        return (
          <li key={`${e.at}-${i}`}>
            <span className="price-history-price">
              {e.price.toLocaleString(locale, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{' '}
              {e.currency ?? fallbackCurrency ?? 'PLN'}
            </span>
            <span className="price-history-date">
              {Number.isNaN(when.getTime()) ? e.at : when.toLocaleString(locale)}
            </span>
            {e.source && (
              <span className="tag price-history-source">
                {e.source === 'import' ? t.priceSourceImport : t.priceSourceManual}
              </span>
            )}
            {i === 0 && <span className="tag success">{t.priceHistoryCurrent}</span>}
          </li>
        );
      })}
    </ul>
  );
};

interface TooltipProps extends ListProps {
  align?: 'left' | 'right';
}

// Clock icon that reveals the history on hover. Rendered next to a price
// wherever one is shown — catalogs, cost calculator.
export const PriceHistoryTooltip: React.FC<TooltipProps> = ({
  history,
  fallbackCurrency,
  align = 'right',
}) => {
  const t = useT();
  return (
    <HoverTooltip
      align={align}
      triggerClassName="price-history-icon"
      trigger={<IconHistory size={13} />}
    >
      <div className="shortage-tooltip-header">{t.priceHistory}</div>
      <PriceHistoryList history={history} fallbackCurrency={fallbackCurrency} />
    </HoverTooltip>
  );
};

export default PriceHistoryTooltip;
