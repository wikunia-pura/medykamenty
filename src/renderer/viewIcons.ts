import type { ViewKey } from './views/types';

// One glyph per view, shared by the sidebar and the views' hero banners, so a
// banner carries the same mark as its menu entry. Symbols that also exist as
// emoji (✉ ⚠ ⚙) carry U+FE0E so macOS draws the text glyph, not the colour emoji.
export const VIEW_ICONS: Record<Exclude<ViewKey, 'orderDetails'>, string> = {
  // Shown only in the collapsed sidebar; the expanded Pulpit button is text-only.
  dashboard: '⌂',
  orders: '▤',
  workflowTemplates: '☷',
  stockImport: '⇪',
  shortageReport: '⚠\uFE0E',
  emailGenerator: '✉\uFE0E',
  costCalculator: '$',
  maxProducible: '∞',
  productionPlan: '▤',
  products: '◐',
  rawMaterials: '⬡',
  components: '▦',
  outerPackaging: '▣',
  suppliers: '◉',
  settings: '⚙\uFE0E',
};
