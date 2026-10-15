import type { DateOnly, Lang, ShortageLine } from '../../shared/types';

interface WarehouseMailInput {
  prepareFor: DateOnly;
  // Order name when the report is linked to one, otherwise the plan name —
  // whatever the warehouse knows the production run by.
  runName: string;
  rawLines: ShortageLine[];
  componentLines: ShortageLine[];
}

const localeFor = (lang: Lang) => (lang === 'pl' ? 'pl-PL' : 'en-GB');

// 'YYYY-MM-DD' → '20.10.2026' / '20/10/2026'. Built from the parts so the
// day never shifts with the machine's timezone.
export function formatPrepareDate(date: DateOnly, lang: Lang): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d).toLocaleDateString(localeFor(lang));
}

function formatQty(line: ShortageLine): string {
  const qty = line.required.toLocaleString('pl-PL', {
    maximumFractionDigits: line.unit === 'pcs' ? 0 : 3,
  });
  return `${qty} ${line.unit === 'pcs' ? 'szt.' : line.unit}`;
}

// Pick list sorted by name so the warehouse can walk it top to bottom.
function listItems(lines: ShortageLine[]): string {
  return lines
    .filter((l) => l.required > 0)
    .sort((a, b) => a.itemName.localeCompare(b.itemName, 'pl'))
    .map((l) => `- ${l.itemName} — ${formatQty(l)}`)
    .join('\n');
}

// "Prepare for day X" mail to the warehouse: every raw material and component
// the run consumes, at the FULL required quantity (overage included) — not the
// shortage, which is what the supplier RFQs carry. Always Polish: the
// warehouse is local, whatever the UI language.
export function buildWarehouseMail(input: WarehouseMailInput): {
  subject: string;
  body: string;
} {
  const { runName } = input;
  const date = formatPrepareDate(input.prepareFor, 'pl');
  const raw = listItems(input.rawLines);
  const components = listItems(input.componentLines);
  const sections = [raw && `Surowce:\n${raw}`, components && `Komponenty:\n${components}`].filter(
    Boolean,
  );
  return {
    subject: `Przygotowanie na ${date} — ${runName}`,
    body: `Dzień dobry,\n\nproszę o przygotowanie na dzień ${date} poniższych surowców i komponentów do produkcji „${runName}”:\n\n${sections.join('\n\n')}\n\nDziękuję.`,
  };
}
