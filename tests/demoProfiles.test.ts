import {
  generateDemoSignals,
  generateDemoTimeline,
  simulateContrastingSessions,
  simulateDemoSession,
} from "../src/lib/demoProfiles";
import type { RawSignals, SignalKey } from "../src/lib/types";

const SIGNAL_KEYS: SignalKey[] = [
  "movement",
  "leftWrist",
  "rightWrist",
  "reach",
  "headShift",
  "shoulderTilt",
  "symmetry",
  "proximity",
  "stillness",
  "loudness",
  "speech",
  "silence",
  "vocalVariation",
  "rhythm",
  "sudden",
];

function average(frames: RawSignals[], key: SignalKey): number {
  return frames.reduce((sum, frame) => sum + frame[key], 0) / frames.length;
}

describe("deterministic demo participants", () => {
  it("returns identical signals for the same profile, time, and seed", () => {
    expect(generateDemoSignals("measured", 12_345, 77)).toEqual(
      generateDemoSignals("measured", 12_345, 77),
    );
    expect(generateDemoSignals("measured", 12_345, 77)).not.toEqual(
      generateDemoSignals("measured", 12_345, 78),
    );
  });

  it("keeps every synthetic sensor feature in its physical unit interval", () => {
    for (const profile of ["measured", "kinetic"] as const) {
      for (let elapsed = 0; elapsed < 20_000; elapsed += 137) {
        const sample = generateDemoSignals(profile, elapsed, 19);
        for (const key of SIGNAL_KEYS) {
          expect(sample[key]).toBeGreaterThanOrEqual(0);
          expect(sample[key]).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("makes measured and kinetic behavior observably contrast", () => {
    const measured = generateDemoTimeline("measured", 10, 20_000, 100);
    const kinetic = generateDemoTimeline("kinetic", 10, 20_000, 100);
    expect(average(kinetic, "movement")).toBeGreaterThan(average(measured, "movement") * 2);
    expect(average(measured, "silence")).toBeGreaterThan(average(kinetic, "silence"));
    expect(average(kinetic, "vocalVariation")).toBeGreaterThan(
      average(measured, "vocalVariation") * 2,
    );
  });

  it("includes the exact requested endpoint in a timeline", () => {
    const timeline = generateDemoTimeline("measured", 1, 1_025, 100);
    expect(timeline[0].timestamp).toBe(0);
    expect(timeline[timeline.length - 1].timestamp).toBe(1_025);
  });

  it("runs a full profile reproducibly through the portrait pipeline", () => {
    const first = simulateDemoSession("kinetic", 15, 5_000, 100);
    const second = simulateDemoSession("kinetic", 15, 5_000, 100);
    expect(first).toEqual(second);
    expect(first.frames.length).toBeGreaterThan(40);
    expect(first.profile).toBe("kinetic");
    expect(first.inputMode).toBe("demo");
    expect(first.observations).toHaveLength(3);
  });

  it("creates a ready-to-compare pair with distinct final structures", () => {
    const [measured, kinetic] = simulateContrastingSessions(22, 12_000, 100);
    expect(measured.profile).toBe("measured");
    expect(kinetic.profile).toBe("kinetic");
    expect(measured.id).not.toBe(kinetic.id);
    expect(kinetic.finalParams.energy).toBeGreaterThan(measured.finalParams.energy);
    expect(kinetic.motifs).not.toEqual(measured.motifs);
  });
});
