import type { Unit } from '../../shared/types';

// Mass units convert to grams directly; volume units (ml/l) would need a
// density the catalog doesn't carry.
export function isMassUnit(unit: Unit): boolean {
  return unit === 'g' || unit === 'kg';
}

export function toGrams(value: number, unit: Unit): number {
  switch (unit) {
    case 'g':
      return value;
    case 'kg':
      return value * 1000;
    case 'ml':
    case 'l':
      throw new Error(`Cannot convert ${unit} to grams without density`);
  }
}

export function gramsTo(value: number, targetUnit: Unit): number {
  switch (targetUnit) {
    case 'g':
      return value;
    case 'kg':
      return value / 1000;
    case 'ml':
    case 'l':
      throw new Error(`Cannot convert grams to ${targetUnit} without density`);
  }
}

export function ceilToMoq(amount: number, moq: number | undefined): number {
  if (!moq || moq <= 0) return amount;
  return Math.ceil(amount / moq) * moq;
}

export function pricePerGram(pricePerUnit: number, unit: Unit): number {
  switch (unit) {
    case 'g':
      return pricePerUnit;
    case 'kg':
      return pricePerUnit / 1000;
    default:
      throw new Error(`pricePerGram requires mass unit, got ${unit}`);
  }
}
