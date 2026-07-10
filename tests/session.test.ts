import { generateDemoTimeline } from "../src/lib/demoProfiles";
import {
  MAX_STORED_FRAMES,
  PortraitSessionEngine,
  SESSION_STORAGE_KEY,
  buildSessionRecord,
  cleanupSessionResources,
  clearStoredSessions,
  compactSessionRecord,
  loadStoredSessions,
  removeStoredSession,
  saveSession,
  stopMediaTracks,
} from "../src/lib/session";
import type { SessionRecord } from "../src/lib/types";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function run(seed = 31, startedAt = 1_000): SessionRecord {
  const engine = new PortraitSessionEngine({ seed, startedAt });
  for (const raw of generateDemoTimeline("measured", seed, 4_000, 100)) {
    engine.process(raw);
  }
  return engine.finalize("demo", "measured");
}

describe("session pipeline and storage", () => {
  it("replays normalized frames, mappings, motifs, and interpretation identically", () => {
    expect(run()).toEqual(run());
  });

  it("records only normalized features and artistic parameters, never raw media", () => {
    const engine = new PortraitSessionEngine({ seed: 1, startedAt: 100 });
    const raw = generateDemoTimeline("kinetic", 1, 100, 100)[0];
    const frame = engine.process(raw);
    const recorded = engine.getFrames()[0];
    expect(frame.raw).toEqual(raw);
    expect(recorded).toEqual({ t: 0, signals: { ...frame.normalized, timestamp: 0 }, params: frame.params });
    expect(recorded).not.toHaveProperty("raw");
  });

  it("builds a complete record with deterministic title, evidence, accent, and finale", () => {
    const source = run(8, 500);
    const rebuilt = buildSessionRecord({
      seed: source.seed,
      startedAt: source.startedAt,
      inputMode: source.inputMode,
      profile: source.profile,
      frames: source.frames,
      motifs: source.motifs,
    });
    expect(rebuilt.title).toBe(source.title);
    expect(rebuilt.observations).toEqual(source.observations);
    expect(rebuilt.accentHue).toBe(source.accentHue);
    expect(rebuilt.finalParams.volatility).toBeLessThanOrEqual(
      Math.max(...source.frames.map((frame) => frame.params.volatility)),
    );
  });

  it("compacts long replays while preserving their first and final frames", () => {
    const source = run();
    const long: SessionRecord = {
      ...source,
      frames: Array.from({ length: MAX_STORED_FRAMES * 2 }, (_, index) => ({
        ...source.frames[index % source.frames.length],
        t: index * 100,
      })),
    };
    const compact = compactSessionRecord(long);
    expect(compact.frames).toHaveLength(MAX_STORED_FRAMES);
    expect(compact.frames[0].t).toBe(long.frames[0].t);
    expect(compact.frames.at(-1)?.t).toBe(long.frames.at(-1)?.t);
  });

  it("stores at most two newest records and supports removal and privacy reset", () => {
    const storage = new MemoryStorage();
    const oldest = run(1, 1_000);
    const middle = run(2, 2_000);
    const newest = run(3, 3_000);
    saveSession(oldest, storage);
    saveSession(middle, storage);
    const saved = saveSession(newest, storage);
    expect(saved.map((session) => session.id)).toEqual([newest.id, middle.id]);
    expect(loadStoredSessions(storage)).toHaveLength(2);

    expect(removeStoredSession(newest.id, storage).map((session) => session.id)).toEqual([
      middle.id,
    ]);
    clearStoredSessions(storage);
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it("fails closed on corrupt or unavailable local storage", () => {
    const storage = new MemoryStorage();
    storage.setItem(SESSION_STORAGE_KEY, "{not-json");
    expect(loadStoredSessions(storage)).toEqual([]);
    expect(loadStoredSessions(undefined)).toEqual([]);
  });

  it("stops every media track even when one stop throws", () => {
    const stops: string[] = [];
    stopMediaTracks({
      getTracks: () => [
        { stop: () => stops.push("camera") },
        {
          stop: () => {
            stops.push("broken");
            throw new Error("already ended");
          },
        },
        { stop: () => stops.push("microphone") },
      ],
    });
    expect(stops).toEqual(["camera", "broken", "microphone"]);
  });

  it("cleans streams, animation, and audio context together", async () => {
    const track = vi.fn();
    const cancel = vi.fn();
    const close = vi.fn().mockResolvedValue(undefined);
    await cleanupSessionResources({
      streams: [{ getTracks: () => [{ stop: track }] }],
      animationFrameId: 91,
      cancelFrame: cancel,
      audioContext: { state: "running", close },
    });
    expect(track).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith(91);
    expect(close).toHaveBeenCalledOnce();
  });
});
