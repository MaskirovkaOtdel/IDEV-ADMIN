/**
 * Decimal helpers.
 *
 * break_infinity.js does NOT expose `Decimal.ZERO`, `Decimal.ONE` or
 * `Decimal.valueOf(x)`:
 *   • ZERO/ONE simply do not exist (they are `undefined`).
 *   • `Decimal.valueOf` resolves to the inherited `Function.prototype.valueOf`,
 *     so it returns the *class itself* instead of a Decimal.
 * Both traps produce silently wrong numbers, or a `t.indexOf is not a function`
 * TypeError deep inside the library.
 *
 * Everything in the game funnels through these helpers so the traps can only be
 * hit once, here.
 */
import Decimal from 'break_infinity.js';

/** 0 as a Decimal. */
export const ZERO: Decimal = Decimal.fromNumber(0);
/** 1 as a Decimal. */
export const ONE: Decimal = Decimal.fromNumber(1);
/** 2 as a Decimal. */
export const TWO: Decimal = Decimal.fromNumber(2);

/**
 * Convert a plain number (or numeric string) to a Decimal.
 * Use this instead of `Decimal.valueOf`, which silently returns the class itself.
 */
export function dec(value: number | string): Decimal {
  return typeof value === 'number' ? Decimal.fromNumber(value) : Decimal.fromString(value);
}

/**
 * break_infinity.js has no `isNaN()`; NaN lives in the mantissa.
 * This is the canonical check for "this Decimal is unusable".
 */
export function isNaNDecimal(value: Decimal | null | undefined): boolean {
  if (!value) return true;
  const mantissa = (value as unknown as { mantissa?: number }).mantissa;
  if (typeof mantissa === 'number') return Number.isNaN(mantissa);
  return false;
}

/** true when the value is a usable, non-NaN Decimal. */
export function isValidDecimal(value: unknown): value is Decimal {
  return value instanceof Decimal && !isNaNDecimal(value);
}

/**
 * Parse anything into a Decimal, returning `fallback` for null/NaN/garbage.
 * Used by save deserialization, which must never throw on hostile input.
 */
export function decSafe(value: unknown, fallback: Decimal = ZERO): Decimal {
  if (value instanceof Decimal) return isNaNDecimal(value) ? fallback : value;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Decimal.fromNumber(value) : fallback;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    try {
      const parsed = Decimal.fromString(value.trim());
      return isNaNDecimal(parsed) ? fallback : parsed;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

/** Clamp a finite number, defaulting to `fallback` for NaN/Infinity. */
export function numSafe(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/** Clamp an owned-count to a sane non-negative integer. */
export function intSafe(value: unknown, fallback = 0): number {
  const n = Math.floor(numSafe(value, fallback));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}
