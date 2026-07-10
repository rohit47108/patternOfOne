import {
  createBaselineModel,
  normalizeSignals,
  type BaselineOptions,
} from "./baseline";
import { interpretSession } from "./interpretation";
import { mapSignals, type MappingOptions } from "./mapping";
import {
  createMotifMemory,
  updateMotifMemory,
  type MotifMemoryOptions,
  type MotifMemoryState,
} from "./memory";
import { mixSeed } from "./random";
import type {
  ArtisticParameters,
  BaselineModel,
  DemoProfileName,
  InputMode,
  Motif,
  RawSignals,
  RecordedFrame,
  SessionRecord,
  SignalFrame,
} from "./types";
import { NEUTRAL_PARAMS } from "./types";

export const SESSION_STORAGE_KEY = "pattern-of-one:sessions:v1";
export const MAX_STORED_SESSIONS = 2;
export const MAX_STORED_FRAMES = 360;

const ACCENT_HUES = [8, 28, 38, 148, 168, 184, 202, 214, 342] as const;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function cloneFrame(frame: RecordedFrame): RecordedFrame {
  return {
    t: frame.t,
    signals: { ...frame.signals },
    params: { ...frame.params },
  };
}

function cloneMotif(motif: Motif): Motif {
  return { ...motif };
}

export function accentHueForSeed(seed: number): number {
  return ACCENT_HUES[mixSeed(seed, "accent") % ACCENT_HUES.length];
}

export function createSessionId(seed: number, startedAt: number): string {
  const hash = mixSeed(seed, Math.trunc(startedAt)).toString(36).padStart(7, "0");
  return `portrait-${hash}`;
}

export interface BuildSessionRecordInput {
  id?: string;
  seed: number;
  startedAt: number;
  inputMode: InputMode;
  profile?: DemoProfileName;
  accentHue?: number;
  frames: readonly RecordedFrame[];
  motifs: readonly Motif[];
}

/** Reconcile the last passage with session memory for a stable, living finale. */
export function synthesizeFinalParameters(
  frames: readonly RecordedFrame[],
  motifs: readonly Motif[],
): ArtisticParameters {
  if (frames.length === 0) return { ...NEUTRAL_PARAMS };
  const tailStart = Math.max(0, Math.floor(frames.length * 0.8));
  const tail = frames.slice(tailStart);
  const average = { ...NEUTRAL_PARAMS };
  for (const key of Object.keys(average) as Array<keyof ArtisticParameters>) {
    average[key] =
      tail.reduce((sum, frame) => sum + clamp01(frame.params[key]), 0) / tail.length;
  }
  const recurring = motifs.reduce(
    (sum, motif) => sum + motif.strength * motif.persistence * Math.min(3, motif.occurrences),
    0,
  );
  const remembered = clamp01(recurring / 7);

  return {
    ...average,
    energy: clamp01(average.energy * 0.78 + 0.06),
    rhythm: clamp01(average.rhythm * 0.82 + remembered * 0.08),
    continuity: clamp01(average.continuity + 0.08 + remembered * 0.08),
    volatility: clamp01(average.volatility * 0.62),
    density: clamp01(average.density + remembered * 0.1),
    memory: Math.max(average.memory, remembered),
    illumination: clamp01(average.illumination + remembered * 0.08),
  };
}

export function buildSessionRecord(input: BuildSessionRecordInput): SessionRecord {
  const frames = input.frames.map(cloneFrame).sort((left, right) => left.t - right.t);
  const motifs = input.motifs.map(cloneMotif);
  const interpretation = interpretSession(frames, motifs, input.seed);
  const duration = frames.length === 0 ? 0 : Math.max(0, frames[frames.length - 1].t);

  return {
    version: 1,
    id: input.id ?? createSessionId(input.seed, input.startedAt),
    seed: input.seed,
    startedAt: input.startedAt,
    duration,
    inputMode: input.inputMode,
    profile: input.profile,
    accentHue: input.accentHue ?? accentHueForSeed(input.seed),
    title: interpretation.title,
    observations: interpretation.observations,
    frames,
    motifs,
    finalParams: synthesizeFinalParameters(frames, motifs),
  };
}

export interface PortraitSessionEngineOptions {
  seed: number;
  startedAt?: number;
  baseline?: BaselineModel;
  baselineOptions?: Partial<BaselineOptions>;
  mappingOptions?: Partial<MappingOptions>;
  memoryOptions?: Partial<MotifMemoryOptions>;
}

/** The single deterministic pipeline shared by live input, replay, and demos. */
export class PortraitSessionEngine {
  public readonly seed: number;
  public readonly startedAt: number;

  private baseline: BaselineModel;
  private memory: MotifMemoryState;
  private readonly baselineOptions?: Partial<BaselineOptions>;
  private readonly mappingOptions?: Partial<MappingOptions>;
  private readonly memoryOptions?: Partial<MotifMemoryOptions>;
  private frames: RecordedFrame[] = [];
  private lastParams?: ArtisticParameters;
  private signalOrigin?: number;

  public constructor(options: PortraitSessionEngineOptions | number) {
    const settings = typeof options === "number" ? { seed: options } : options;
    this.seed = settings.seed;
    this.startedAt = settings.startedAt ?? Date.now();
    this.baselineOptions = settings.baselineOptions;
    this.mappingOptions = settings.mappingOptions;
    this.memoryOptions = settings.memoryOptions;
    this.baseline = settings.baseline
      ? createBaselineModel(settings.baseline, settings.baselineOptions)
      : createBaselineModel(undefined, settings.baselineOptions);
    this.memory = createMotifMemory();
  }

  public process(raw: RawSignals): SignalFrame {
    const update = normalizeSignals(raw, this.baseline, this.baselineOptions);
    this.baseline = update.baseline;
    const timestamp = Number.isFinite(raw.timestamp) ? raw.timestamp : 0;
    this.signalOrigin ??= timestamp;
    const t = Math.max(0, timestamp - this.signalOrigin);

    const provisional = mapSignals(
      update.normalized,
      this.memory.strength,
      this.lastParams,
      this.mappingOptions,
    );
    this.memory = updateMotifMemory(
      this.memory,
      update.normalized,
      provisional,
      t,
      this.memoryOptions,
    );
    const params = mapSignals(
      update.normalized,
      this.memory.strength,
      this.lastParams,
      this.mappingOptions,
    );
    this.lastParams = params;

    this.frames.push({
      t,
      signals: { ...update.normalized, timestamp: t },
      params: { ...params },
    });

    return {
      raw: { ...raw },
      normalized: { ...update.normalized },
      params: { ...params },
      motifs: this.memory.motifs.map(cloneMotif),
    };
  }

  public getFrames(): RecordedFrame[] {
    return this.frames.map(cloneFrame);
  }

  public getMotifs(): Motif[] {
    return this.memory.motifs.map(cloneMotif);
  }

  public getMemory(): MotifMemoryState {
    return {
      ...this.memory,
      motifs: this.memory.motifs.map(cloneMotif),
      events: this.memory.events.map((event) => ({ ...event })),
      lastSignals: this.memory.lastSignals ? { ...this.memory.lastSignals } : undefined,
    };
  }

  public getBaseline(): BaselineModel {
    return createBaselineModel(this.baseline, this.baselineOptions);
  }

  public finalize(
    inputMode: InputMode,
    profile?: DemoProfileName,
  ): SessionRecord {
    return buildSessionRecord({
      seed: this.seed,
      startedAt: this.startedAt,
      inputMode,
      profile,
      frames: this.frames,
      motifs: this.memory.motifs,
    });
  }
}

export function finalizeSession(
  engine: PortraitSessionEngine,
  inputMode: InputMode,
  profile?: DemoProfileName,
): SessionRecord {
  return engine.finalize(inputMode, profile);
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): StorageLike | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function isSessionRecord(value: unknown): value is SessionRecord {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SessionRecord>;
  return (
    candidate.version === 1 &&
    typeof candidate.id === "string" &&
    typeof candidate.seed === "number" &&
    typeof candidate.startedAt === "number" &&
    typeof candidate.title === "string" &&
    Array.isArray(candidate.frames) &&
    Array.isArray(candidate.motifs) &&
    Array.isArray(candidate.observations) &&
    typeof candidate.finalParams === "object" &&
    candidate.finalParams !== null
  );
}

export function loadStoredSessions(storage = browserStorage()): SessionRecord[] {
  if (!storage) return [];
  try {
    const encoded = storage.getItem(SESSION_STORAGE_KEY);
    if (!encoded) return [];
    const parsed: unknown = JSON.parse(encoded);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSessionRecord).sort((left, right) => right.startedAt - left.startedAt);
  } catch {
    return [];
  }
}

export function compactSessionRecord(
  record: SessionRecord,
  maximumFrames = MAX_STORED_FRAMES,
): SessionRecord {
  const limit = Math.max(2, Math.floor(maximumFrames));
  if (record.frames.length <= limit) {
    return { ...record, frames: record.frames.map(cloneFrame), motifs: record.motifs.map(cloneMotif) };
  }

  const frames: RecordedFrame[] = [];
  const lastIndex = record.frames.length - 1;
  for (let index = 0; index < limit; index += 1) {
    const sourceIndex = Math.round((index / (limit - 1)) * lastIndex);
    frames.push(cloneFrame(record.frames[sourceIndex]));
  }
  return {
    ...record,
    frames,
    motifs: record.motifs.map(cloneMotif),
    observations: record.observations.map((observation) => ({ ...observation })),
    finalParams: { ...record.finalParams },
  };
}

export function saveSession(
  record: SessionRecord,
  storage = browserStorage(),
  maximumSessions = MAX_STORED_SESSIONS,
): SessionRecord[] {
  if (!storage) return [];
  const compact = compactSessionRecord(record);
  const existing = loadStoredSessions(storage).filter((session) => session.id !== record.id);
  const sessions = [compact, ...existing]
    .sort((left, right) => right.startedAt - left.startedAt)
    .slice(0, Math.max(1, Math.floor(maximumSessions)));
  try {
    storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions));
    return sessions;
  } catch {
    return existing;
  }
}

export function removeStoredSession(
  id: string,
  storage = browserStorage(),
): SessionRecord[] {
  if (!storage) return [];
  const sessions = loadStoredSessions(storage).filter((session) => session.id !== id);
  try {
    if (sessions.length === 0) storage.removeItem(SESSION_STORAGE_KEY);
    else storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    return sessions;
  }
  return sessions;
}

export function clearStoredSessions(storage = browserStorage()): void {
  try {
    storage?.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Storage is optional; privacy reset remains best-effort if a browser blocks it.
  }
}

export interface StoppableStream {
  getTracks(): Array<{ stop(): void }>;
}

export interface ClosableAudioContext {
  state?: string;
  close(): Promise<unknown> | unknown;
}

export function stopMediaTracks(stream?: StoppableStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // Continue stopping the remaining devices even if one browser track fails.
    }
  }
}

export async function cleanupSessionResources(resources: {
  streams?: Array<StoppableStream | null | undefined>;
  audioContext?: ClosableAudioContext | null;
  animationFrameId?: number | null;
  cancelFrame?: (id: number) => void;
}): Promise<void> {
  for (const stream of resources.streams ?? []) stopMediaTracks(stream);
  if (resources.animationFrameId !== null && resources.animationFrameId !== undefined) {
    const cancel = resources.cancelFrame ??
      (typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : undefined);
    cancel?.(resources.animationFrameId);
  }
  if (resources.audioContext && resources.audioContext.state !== "closed") {
    try {
      await resources.audioContext.close();
    } catch {
      // Cleanup is intentionally idempotent and safe during browser teardown.
    }
  }
}
