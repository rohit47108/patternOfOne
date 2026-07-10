import { mapSignals } from "../src/lib/mapping";
import type { NormalizedSignals } from "../src/lib/types";
import { NEUTRAL_PARAMS } from "../src/lib/types";

function signals(overrides: Partial<NormalizedSignals> = {}): NormalizedSignals {
  return {
    timestamp: 0,
    movement: 0,
    leftWrist: 0,
    rightWrist: 0,
    reach: 0,
    headShift: 0,
    shoulderTilt: 0,
    symmetry: 0,
    proximity: 0,
    stillness: 0,
    loudness: 0,
    speech: 0,
    silence: 0,
    vocalVariation: 0,
    rhythm: 0,
    sudden: 0,
    ...overrides,
  };
}

describe("structural artistic mapping", () => {
  it("maps a participant-relative neutral frame to the neutral visual form", () => {
    expect(mapSignals(signals())).toEqual(NEUTRAL_PARAMS);
  });

  it("combines gesture signals into energy and spatial expansion", () => {
    const active = mapSignals(
      signals({ movement: 2.6, leftWrist: 2, rightWrist: 2.4, reach: 2.8 }),
    );
    expect(active.energy).toBeGreaterThan(NEUTRAL_PARAMS.energy + 0.4);
    expect(active.expansion).toBeGreaterThan(NEUTRAL_PARAMS.expansion + 0.4);
  });

  it("turns left/right tension into structure rather than a literal label", () => {
    const balanced = mapSignals(signals({ leftWrist: 2, rightWrist: 2, symmetry: 1 }));
    const directional = mapSignals(signals({ leftWrist: 3, rightWrist: -3, symmetry: -2 }));
    expect(directional.symmetry).toBeLessThan(balanced.symmetry);
    expect(directional.expansion).toBeGreaterThan(NEUTRAL_PARAMS.expansion);
  });

  it("lets silence remove emission while voice creates pulse and illumination", () => {
    const quiet = mapSignals(signals({ silence: 3, speech: -2, loudness: -2 }));
    const voiced = mapSignals(signals({ silence: -3, speech: 2.5, loudness: 2.7, rhythm: 2 }));
    expect(quiet.silence).toBeGreaterThan(voiced.silence);
    expect(voiced.illumination).toBeGreaterThan(quiet.illumination);
    expect(voiced.rhythm).toBeGreaterThan(quiet.rhythm);
  });

  it("folds persistent motif strength into several related parameters", () => {
    const empty = mapSignals(signals(), 0);
    const remembered = mapSignals(signals(), 0.9);
    expect(remembered.memory).toBe(0.9);
    expect(remembered.continuity).toBeGreaterThan(empty.continuity);
    expect(remembered.density).toBeGreaterThan(empty.density);
  });

  it("bounds extreme input and reduces rapid-motion parameters on request", () => {
    const extreme = signals(
      Object.fromEntries(
        Object.keys(signals()).map((key) => [key, key === "timestamp" ? 0 : 1e9]),
      ) as Partial<NormalizedSignals>,
    );
    const regular = mapSignals(extreme);
    const reduced = mapSignals(extreme, 0, undefined, { reducedMotion: true });
    for (const value of Object.values(regular)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(reduced.energy).toBeLessThan(regular.energy);
    expect(reduced.volatility).toBeLessThan(regular.volatility);
  });
});
