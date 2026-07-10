import {
  analyzeSession,
  generateObservations,
  generatePortraitTitle,
  interpretSession,
} from "../src/lib/interpretation";
import type {
  ArtisticParameters,
  Motif,
  NormalizedSignals,
  RecordedFrame,
} from "../src/lib/types";
import { NEUTRAL_PARAMS } from "../src/lib/types";

const EMPTY_SIGNALS: NormalizedSignals = {
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
};

function framesWith(
  first: Partial<ArtisticParameters>,
  last: Partial<ArtisticParameters> = first,
): RecordedFrame[] {
  return Array.from({ length: 12 }, (_, index) => {
    const progress = index / 11;
    const params = Object.fromEntries(
      Object.keys(NEUTRAL_PARAMS).map((key) => {
        const typedKey = key as keyof ArtisticParameters;
        const start = first[typedKey] ?? NEUTRAL_PARAMS[typedKey];
        const end = last[typedKey] ?? NEUTRAL_PARAMS[typedKey];
        return [typedKey, start + (end - start) * progress];
      }),
    ) as unknown as ArtisticParameters;
    return {
      t: index * 1_000,
      signals: { ...EMPTY_SIGNALS, timestamp: index * 1_000 },
      params,
    };
  });
}

function motif(kind: Motif["kind"], occurrences: number): Motif {
  return {
    id: `motif-${kind}`,
    kind,
    strength: 0.8,
    persistence: 0.8,
    createdAt: 0,
    lastSeenAt: 10_000,
    occurrences,
    phase: 0.2,
  };
}

describe("curated interpretation", () => {
  it("selects The Long Interval from sustained negative space", () => {
    const frames = framesWith({ silence: 1, rhythm: 0.02, illumination: 0.1 });
    expect(generatePortraitTitle(frames, [], 42)).toBe("The Long Interval");
  });

  it("selects a rhythm-linked title when pulses dominate", () => {
    const frames = framesWith({ rhythm: 0.95, silence: 0.15, illumination: 0.55 });
    expect(generatePortraitTitle(frames, [motif("pulse", 10)], 42)).toBe(
      "An Unfinished Rhythm",
    );
  });

  it("is reproducible and returns traceable evidence for exactly three observations", () => {
    const frames = framesWith(
      { expansion: 0.2, energy: 0.18, silence: 0.9 },
      { expansion: 0.85, energy: 0.72, silence: 0.3 },
    );
    const motifs = [motif("gesture", 7), motif("pulse", 5)];
    const first = interpretSession(frames, motifs, 99);
    const second = interpretSession(frames, motifs, 99);
    expect(first).toEqual(second);
    expect(first.observations).toHaveLength(3);
    expect(first.observations.every((observation) => observation.evidence.length > 8)).toBe(true);
    expect(first.observations.some((observation) => observation.text.includes("expanded"))).toBe(true);
  });

  it("reports phase changes and motif counts as measured values", () => {
    const frames = framesWith({ continuity: 0.8 }, { continuity: 0.4 });
    const metrics = analyzeSession(frames, [motif("stillness", 4), motif("return", 2)]);
    expect(metrics.continuityChange).toBeLessThan(0);
    expect(metrics.stillnessOccurrences).toBe(4);
    expect(metrics.returnOccurrences).toBe(2);
    expect(metrics.recurrentMotifs).toBe(1);
  });

  it("never emits diagnostic or personality claims", () => {
    const output = generateObservations(framesWith({ volatility: 0.9 }), [motif("fracture", 6)]);
    const publicText = output.map((observation) => observation.text).join(" ").toLowerCase();
    expect(publicText).not.toMatch(/personality|anxious|happy|sad|diagnos/);
  });
});
