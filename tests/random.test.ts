import {
  createSeededRandom,
  mixSeed,
  normalizeSeed,
  pickDeterministic,
  randomBetween,
  randomInteger,
} from "../src/lib/random";

describe("deterministic random helpers", () => {
  it("replays the same sequence for the same numeric or text seed", () => {
    const first = createSeededRandom("one temporary encounter");
    const second = createSeededRandom("one temporary encounter");
    expect(Array.from({ length: 8 }, first)).toEqual(Array.from({ length: 8 }, second));
  });

  it("separates mixed streams without consuming their parent", () => {
    expect(mixSeed(42, "measured")).toBe(mixSeed(42, "measured"));
    expect(mixSeed(42, "measured")).not.toBe(mixSeed(42, "kinetic"));
    expect(normalizeSeed(0)).not.toBe(0);
  });

  it("keeps floats and integers inside their requested bounds", () => {
    const random = createSeededRandom(12);
    for (let index = 0; index < 100; index += 1) {
      expect(randomBetween(random, 5, -2)).toBeGreaterThanOrEqual(-2);
      expect(randomBetween(random, 5, -2)).toBeLessThanOrEqual(5);
      expect(randomInteger(random, 3, 8)).toBeGreaterThanOrEqual(3);
      expect(randomInteger(random, 3, 8)).toBeLessThan(8);
    }
  });

  it("picks reproducibly and rejects an empty collection", () => {
    const values = ["seed", "field", "trace"] as const;
    expect(pickDeterministic(values, createSeededRandom(9))).toBe(
      pickDeterministic(values, createSeededRandom(9)),
    );
    expect(() => pickDeterministic([], createSeededRandom(9))).toThrow(RangeError);
  });
});
