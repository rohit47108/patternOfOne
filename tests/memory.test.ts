import {
  createMotifMemory,
  detectSignalEvents,
  updateMotifMemory,
} from "../src/lib/memory";
import { mapSignals } from "../src/lib/mapping";
import type { NormalizedSignals } from "../src/lib/types";

function signals(timestamp: number, overrides: Partial<NormalizedSignals> = {}): NormalizedSignals {
  return {
    timestamp,
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

describe("temporal event and motif memory", () => {
  it("detects structural gesture, pulse, stillness, and fracture events", () => {
    const frame = signals(1_000, {
      movement: 2.4,
      reach: 2,
      rhythm: 2.2,
      loudness: 1.8,
      stillness: 2,
      sudden: 2.5,
    });
    const events = detectSignalEvents(frame, mapSignals(frame));
    expect(events.map((event) => event.kind)).toEqual([
      "gesture",
      "pulse",
      "stillness",
      "fracture",
    ]);
    expect(events.every((event) => event.strength > 0 && event.strength <= 1)).toBe(true);
  });

  it("accumulates a recurring event into a stronger persistent motif", () => {
    let memory = createMotifMemory();
    const active = signals(0, { movement: 2.4, reach: 2.2 });
    memory = updateMotifMemory(memory, active, mapSignals(active), 0);
    const first = memory.motifs.find((motif) => motif.kind === "gesture")!;

    const repeated = signals(2_800, { movement: 2.4, reach: 2.2 });
    memory = updateMotifMemory(memory, repeated, mapSignals(repeated), 2_800);
    const motif = memory.motifs.find((candidate) => candidate.kind === "gesture")!;
    expect(motif.id).toBe(first.id);
    expect(motif.occurrences).toBe(2);
    expect(motif.persistence).toBeGreaterThan(first.persistence * 0.9);
    expect(memory.shortTerm).toBeGreaterThan(0);
    expect(memory.session).toBeGreaterThan(0);
  });

  it("honors event cooldowns while retaining immediate response", () => {
    let memory = createMotifMemory();
    const first = signals(0, { rhythm: 2.2, loudness: 2 });
    memory = updateMotifMemory(memory, first, mapSignals(first), 0);
    const occurrences = memory.motifs.find((motif) => motif.kind === "pulse")!.occurrences;

    const held = signals(200, { rhythm: 2.2, loudness: 2 });
    memory = updateMotifMemory(memory, held, mapSignals(held), 200);
    expect(memory.motifs.find((motif) => motif.kind === "pulse")!.occurrences).toBe(occurrences);
    expect(memory.immediate).toBeGreaterThan(0);
  });

  it("recognizes a structure that returns after an interval", () => {
    let memory = createMotifMemory();
    const first = signals(0, { movement: 2.5, reach: 2.2 });
    memory = updateMotifMemory(memory, first, mapSignals(first), 0);
    const quiet = signals(2_000);
    memory = updateMotifMemory(memory, quiet, mapSignals(quiet), 2_000);
    const returning = signals(5_600, { movement: 2.5, reach: 2.2 });
    memory = updateMotifMemory(memory, returning, mapSignals(returning), 5_600);
    expect(memory.motifs.some((motif) => motif.kind === "return")).toBe(true);
    expect(memory.events.some((event) => event.kind === "return")).toBe(true);
  });

  it("decays immediate and short-term response on their different timescales", () => {
    let memory = createMotifMemory();
    const active = signals(0, { sudden: 3 });
    memory = updateMotifMemory(memory, active, mapSignals(active), 0);
    const immediate = memory.immediate;
    const quiet = signals(10_000);
    memory = updateMotifMemory(memory, quiet, mapSignals(quiet), 10_000);
    expect(memory.immediate).toBeLessThan(immediate / 100);
    expect(memory.shortTerm).toBe(0);
    expect(memory.motifs.length).toBeGreaterThan(0);
  });

  it("replays identically for the same timestamped sequence", () => {
    const sequence = [
      signals(0),
      signals(1_000, { movement: 2 }),
      signals(2_000),
      signals(3_000, { rhythm: 2.4 }),
    ];
    const play = () =>
      sequence.reduce(
        (memory, frame) => updateMotifMemory(memory, frame, mapSignals(frame), frame.timestamp),
        createMotifMemory(),
      );
    expect(play()).toEqual(play());
  });
});
