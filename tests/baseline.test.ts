import {
  SIGNAL_KEYS,
  createBaselineModel,
  normalizeSignals,
  updateBaselineStat,
} from "../src/lib/baseline";
import { NEUTRAL_SIGNALS } from "../src/lib/types";

describe("personal baseline", () => {
  it("initializes each typed signal and treats the first sample as its origin", () => {
    const model = createBaselineModel();
    expect(Object.keys(model)).toHaveLength(SIGNAL_KEYS.length);
    expect(model.movement.initialized).toBe(false);

    const result = normalizeSignals(NEUTRAL_SIGNALS, model);
    expect(result.normalized.movement).toBe(0);
    expect(result.baseline.movement.mean).toBe(NEUTRAL_SIGNALS.movement);
    expect(result.baseline.movement.initialized).toBe(true);
  });

  it("uses exponential mean and stable exponential variance", () => {
    const initial = updateBaselineStat(
      { mean: 0, variance: 0.04, initialized: false },
      10,
      { meanAlpha: 0.25, varianceAlpha: 0.5, initialVariance: 0.04 },
    );
    const next = updateBaselineStat(initial.stat, 14, {
      meanAlpha: 0.25,
      varianceAlpha: 0.5,
      initialVariance: 0.04,
      epsilon: 1e-12,
      maximumVariance: 10,
    });

    expect(next.stat.mean).toBeCloseTo(11, 8);
    expect(next.stat.variance).toBeCloseTo(6.02, 8);
    expect(next.normalized).toBeCloseTo(3 / Math.sqrt(6.02), 7);
  });

  it("enforces a variance floor and bounded z-scores", () => {
    let stat = { mean: 0.5, variance: 0, initialized: true };
    for (let index = 0; index < 20; index += 1) {
      stat = updateBaselineStat(stat, 0.5, { minimumVariance: 0.0025 }).stat;
    }
    expect(stat.variance).toBeGreaterThanOrEqual(0.0025);

    const outlier = updateBaselineStat(stat, 1_000_000, {
      meanAlpha: 0.000001,
      varianceAlpha: 0.000001,
      maximumVariance: 0.0025,
      normalizationLimit: 3,
    });
    expect(outlier.normalized).toBe(3);
  });

  it("contains invalid sensor samples instead of spreading NaN", () => {
    const model = createBaselineModel({ movement: 0.25 });
    const raw = { ...NEUTRAL_SIGNALS, movement: Number.NaN, loudness: Infinity };
    const result = normalizeSignals(raw, model);
    expect(result.normalized.movement).toBe(0);
    expect(result.normalized.loudness).toBe(0);
    expect(Number.isFinite(result.baseline.movement.mean)).toBe(true);
    expect(Number.isFinite(result.baseline.loudness.variance)).toBe(true);
  });

  it("does not mutate the prior model", () => {
    const model = createBaselineModel({ movement: 0.1 });
    const snapshot = structuredClone(model);
    normalizeSignals({ ...NEUTRAL_SIGNALS, movement: 0.8 }, model);
    expect(model).toEqual(snapshot);
  });
});
