/** A tiny deterministic random source used by the portrait and demo engines. */
export type RandomSource = () => number;

const UINT32_RANGE = 0x1_0000_0000;

/**
 * Convert a numeric or textual seed into a stable, non-zero unsigned integer.
 * Text is hashed with FNV-1a so URLs and saved sessions can use readable seeds.
 */
export function normalizeSeed(seed: number | string): number {
  if (typeof seed === "number" && Number.isFinite(seed)) {
    const normalized = Math.trunc(seed) >>> 0;
    return normalized || 0x6d2b79f5;
  }

  const text = String(seed);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0) || 0x6d2b79f5;
}
/** Mix a seed with a stable salt without consuming a random sequence. */
export function mixSeed(seed: number | string, salt: number | string): number {
  let value = normalizeSeed(seed) ^ normalizeSeed(salt);
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return ((value ^ (value >>> 15)) >>> 0) || 0x6d2b79f5;
}

/** Mulberry32: small, fast, and reproducible in every modern JS runtime. */
export function createSeededRandom(seed: number | string): RandomSource {
  let state = normalizeSeed(seed);

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

export function randomBetween(
  random: RandomSource,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
    throw new TypeError("Random bounds must be finite numbers.");
  }

  const low = Math.min(minimum, maximum);
  const high = Math.max(minimum, maximum);
  return low + (high - low) * random();
}

export function randomInteger(
  random: RandomSource,
  minimum: number,
  maximumExclusive: number,
): number {
  const low = Math.ceil(Math.min(minimum, maximumExclusive));
  const high = Math.floor(Math.max(minimum, maximumExclusive));
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) {
    throw new RangeError("Random integer bounds must contain at least one integer.");
  }

  return low + Math.floor(random() * (high - low));
}

export function pickDeterministic<T>(
  values: readonly T[],
  random: RandomSource,
): T {
  if (values.length === 0) {
    throw new RangeError("Cannot pick from an empty collection.");
  }

  return values[randomInteger(random, 0, values.length)];
}
