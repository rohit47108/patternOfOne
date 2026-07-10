import type {
  ArtisticParameters,
  Motif,
  MotifKind,
  NormalizedSignals,
} from "./types";

export interface SignalEvent {
  kind: Exclude<MotifKind, "return"> | "return";
  strength: number;
  timestamp: number;
  phase: number;
  source: string;
}
export interface MotifMemoryState {
  motifs: Motif[];
  /** Events retained for the several-second short-term window. */
  events: SignalEvent[];
  /** Fast response that fades in roughly one second. */
  immediate: number;
  /** Behavior density accumulated across several seconds. */
  shortTerm: number;
  /** Persistent session-level motif strength. */
  session: number;
  /** Combined value intended for the visual mapping layer. */
  strength: number;
  lastSignals?: NormalizedSignals;
  lastUpdatedAt: number | null;
  nextId: number;
}

export interface MotifMemoryOptions {
  immediateHalfLifeMs: number;
  shortTermWindowMs: number;
  motifHalfLifeMs: number;
  returnGapMs: number;
  maximumMotifs: number;
}

export const DEFAULT_MEMORY_OPTIONS: Readonly<MotifMemoryOptions> = {
  immediateHalfLifeMs: 900,
  shortTermWindowMs: 8_000,
  motifHalfLifeMs: 42_000,
  returnGapMs: 4_000,
  maximumMotifs: 24,
};

const EVENT_COOLDOWNS: Readonly<Record<Exclude<MotifKind, "return">, number>> = {
  gesture: 900,
  pulse: 650,
  stillness: 2_200,
  fracture: 1_100,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function unitPositive(value: number): number {
  return clamp01(value / 3);
}

function unitMagnitude(value: number): number {
  return clamp01(Math.abs(value) / 3);
}

function phaseFor(kind: MotifKind, timestamp: number): number {
  const period =
    kind === "pulse"
      ? 1_200
      : kind === "gesture"
        ? 2_800
        : kind === "fracture"
          ? 3_700
          : 5_200;
  const value = ((timestamp % period) + period) % period;
  return value / period;
}

function phaseDistance(left: number, right: number): number {
  const direct = Math.abs(left - right);
  return Math.min(direct, 1 - direct);
}

function hasCrossed(current: number, previous: number, threshold: number): boolean {
  return current >= threshold && previous < threshold;
}

function lastEventAt(
  events: readonly SignalEvent[],
  kind: SignalEvent["kind"],
): number | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].kind === kind) return events[index].timestamp;
  }
  return undefined;
}

/** Detect observable structural events without assigning emotion or identity. */
export function detectSignalEvents(
  signals: NormalizedSignals,
  params: ArtisticParameters,
  previous?: NormalizedSignals,
  now = signals.timestamp,
  recentEvents: readonly SignalEvent[] = [],
): SignalEvent[] {
  const prior = previous;
  const candidates: Array<{
    kind: Exclude<MotifKind, "return">;
    value: number;
    previousValue: number;
    threshold: number;
    source: string;
  }> = [
    {
      kind: "gesture",
      value: Math.max(
        unitPositive(signals.movement),
        unitPositive(signals.reach),
        (unitPositive(signals.leftWrist) + unitPositive(signals.rightWrist)) / 2,
      ),
      previousValue: prior
        ? Math.max(
            unitPositive(prior.movement),
            unitPositive(prior.reach),
            (unitPositive(prior.leftWrist) + unitPositive(prior.rightWrist)) / 2,
          )
        : 0,
      threshold: 0.3,
      source: "movement/reach crossed its personal baseline",
    },
    {
      kind: "pulse",
      value: Math.max(
        unitPositive(signals.rhythm),
        unitPositive(signals.loudness) * 0.86,
        unitPositive(signals.speech) * 0.75,
      ),
      previousValue: prior
        ? Math.max(
            unitPositive(prior.rhythm),
            unitPositive(prior.loudness) * 0.86,
            unitPositive(prior.speech) * 0.75,
          )
        : 0,
      threshold: 0.25,
      source: "voice rhythm rose above its personal baseline",
    },
    {
      kind: "stillness",
      value: Math.max(
        unitPositive(signals.stillness),
        clamp01((params.continuity - 0.72) / 0.28) * 0.7,
      ),
      previousValue: prior ? unitPositive(prior.stillness) : 0,
      threshold: 0.22,
      source: "stillness persisted beyond its recent baseline",
    },
    {
      kind: "fracture",
      value: Math.max(
        unitPositive(signals.sudden),
        unitMagnitude(signals.sudden) * 0.65,
        clamp01((params.volatility - 0.42) / 0.58),
      ),
      previousValue: prior ? unitMagnitude(prior.sudden) : 0,
      threshold: 0.34,
      source: "a sudden deviation interrupted the current structure",
    },
  ];

  const events: SignalEvent[] = [];
  for (const candidate of candidates) {
    if (candidate.value < candidate.threshold) continue;
    const lastTimestamp = lastEventAt(recentEvents, candidate.kind);
    const cooldownElapsed =
      lastTimestamp === undefined || now - lastTimestamp >= EVENT_COOLDOWNS[candidate.kind];
    if (!hasCrossed(candidate.value, candidate.previousValue, candidate.threshold) && !cooldownElapsed) {
      continue;
    }

    const strength = clamp01(
      (candidate.value - candidate.threshold) / (1 - candidate.threshold) * 0.72 + 0.28,
    );
    events.push({
      kind: candidate.kind,
      strength,
      timestamp: now,
      phase: phaseFor(candidate.kind, now),
      source: candidate.source,
    });
  }

  return events;
}

export function createMotifMemory(): MotifMemoryState {
  return {
    motifs: [],
    events: [],
    immediate: 0,
    shortTerm: 0,
    session: 0,
    strength: 0,
    lastUpdatedAt: null,
    nextId: 1,
  };
}

function resolveOptions(options?: Partial<MotifMemoryOptions>): MotifMemoryOptions {
  const defaults = DEFAULT_MEMORY_OPTIONS;
  return {
    immediateHalfLifeMs: Math.max(1, options?.immediateHalfLifeMs ?? defaults.immediateHalfLifeMs),
    shortTermWindowMs: Math.max(1, options?.shortTermWindowMs ?? defaults.shortTermWindowMs),
    motifHalfLifeMs: Math.max(1, options?.motifHalfLifeMs ?? defaults.motifHalfLifeMs),
    returnGapMs: Math.max(1, options?.returnGapMs ?? defaults.returnGapMs),
    maximumMotifs: Math.max(1, Math.floor(options?.maximumMotifs ?? defaults.maximumMotifs)),
  };
}

function decay(value: number, elapsedMs: number, halfLifeMs: number): number {
  return value * 2 ** (-Math.max(0, elapsedMs) / halfLifeMs);
}

function appendOrReinforceMotif(
  motifs: Motif[],
  event: SignalEvent,
  nextId: number,
): { motifs: Motif[]; nextId: number; returned: boolean } {
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < motifs.length; index += 1) {
    const motif = motifs[index];
    if (motif.kind !== event.kind) continue;
    const distance = phaseDistance(motif.phase, event.phase);
    const permittedDistance = event.kind === "stillness" ? 0.42 : 0.28;
    if (distance <= permittedDistance && distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  if (bestIndex < 0) {
    return {
      motifs: [
        ...motifs,
        {
          id: `motif-${nextId}-${event.kind}`,
          kind: event.kind,
          strength: event.strength,
          persistence: clamp01(0.3 + event.strength * 0.38),
          createdAt: event.timestamp,
          lastSeenAt: event.timestamp,
          occurrences: 1,
          phase: event.phase,
        },
      ],
      nextId: nextId + 1,
      returned: false,
    };
  }

  const existing = motifs[bestIndex];
  const returned = event.timestamp - existing.lastSeenAt >= DEFAULT_MEMORY_OPTIONS.returnGapMs;
  const reinforced: Motif = {
    ...existing,
    strength: clamp01(existing.strength * 0.64 + event.strength * 0.36 + 0.05),
    persistence: clamp01(existing.persistence + 0.1 + event.strength * 0.07),
    lastSeenAt: event.timestamp,
    occurrences: existing.occurrences + 1,
    phase: (existing.phase * Math.min(existing.occurrences, 5) + event.phase) /
      (Math.min(existing.occurrences, 5) + 1),
  };
  const nextMotifs = motifs.slice();
  nextMotifs[bestIndex] = reinforced;
  return { motifs: nextMotifs, nextId, returned };
}

/**
 * Advance immediate, short-term, and session memory. The function is immutable,
 * JSON-serializable, and deterministic for a given frame sequence.
 */
export function updateMotifMemory(
  memory: MotifMemoryState,
  signals: NormalizedSignals,
  params: ArtisticParameters,
  now = signals.timestamp,
  options?: Partial<MotifMemoryOptions>,
): MotifMemoryState {
  const settings = resolveOptions(options);
  const safeNow = Number.isFinite(now)
    ? now
    : (memory.lastUpdatedAt ?? signals.timestamp ?? 0);
  const elapsed = memory.lastUpdatedAt === null ? 0 : Math.max(0, safeNow - memory.lastUpdatedAt);
  const retainedEvents = memory.events.filter(
    (event) => safeNow - event.timestamp <= settings.shortTermWindowMs,
  );
  const detected = detectSignalEvents(
    signals,
    params,
    memory.lastSignals,
    safeNow,
    retainedEvents,
  );

  let motifs = memory.motifs
    .map((motif) => ({
      ...motif,
      persistence: decay(motif.persistence, elapsed, settings.motifHalfLifeMs),
      strength: decay(motif.strength, elapsed, settings.motifHalfLifeMs * 1.8),
    }))
    .filter((motif) => motif.persistence >= 0.025 || motif.occurrences > 1);
  let nextId = memory.nextId;
  const returningEvents: SignalEvent[] = [];

  for (const event of detected) {
    const previousMatch = motifs.find(
      (motif) =>
        motif.kind === event.kind &&
        phaseDistance(motif.phase, event.phase) <= (event.kind === "stillness" ? 0.42 : 0.28),
    );
    const isReturn =
      previousMatch !== undefined &&
      safeNow - previousMatch.lastSeenAt >= settings.returnGapMs;
    const result = appendOrReinforceMotif(motifs, event, nextId);
    motifs = result.motifs;
    nextId = result.nextId;

    if (isReturn) {
      returningEvents.push({
        kind: "return",
        strength: clamp01(event.strength * 0.8 + 0.2),
        timestamp: safeNow,
        phase: event.phase,
        source: `${event.kind} structure returned after an interval`,
      });
    }
  }

  for (const event of returningEvents) {
    const result = appendOrReinforceMotif(motifs, event, nextId);
    motifs = result.motifs;
    nextId = result.nextId;
  }

  motifs = motifs
    .sort((left, right) => {
      const leftWeight = left.persistence * left.strength * (1 + left.occurrences * 0.08);
      const rightWeight = right.persistence * right.strength * (1 + right.occurrences * 0.08);
      return rightWeight - leftWeight || left.createdAt - right.createdAt;
    })
    .slice(0, settings.maximumMotifs);

  const allNewEvents = [...detected, ...returningEvents];
  const eventPeak = allNewEvents.reduce(
    (maximum, event) => Math.max(maximum, event.strength),
    0,
  );
  const immediate = clamp01(
    decay(memory.immediate, elapsed, settings.immediateHalfLifeMs) + eventPeak * 0.58,
  );
  const events = [...retainedEvents, ...allNewEvents];
  const weightedEventDensity = events.reduce((sum, event) => {
    const age = Math.max(0, safeNow - event.timestamp);
    return sum + event.strength * (1 - age / settings.shortTermWindowMs);
  }, 0);
  const shortTerm = clamp01(weightedEventDensity / 5);
  const motifWeight = motifs.reduce(
    (sum, motif) =>
      sum + motif.strength * motif.persistence * Math.min(1.8, 0.55 + motif.occurrences * 0.16),
    0,
  );
  const session = clamp01(motifWeight / 4.5);
  const strength = clamp01(immediate * 0.2 + shortTerm * 0.3 + session * 0.5);

  return {
    motifs,
    events,
    immediate,
    shortTerm,
    session,
    strength,
    lastSignals: { ...signals },
    lastUpdatedAt: safeNow,
    nextId,
  };
}

/** Stateful convenience wrapper for sensor loops. */
export class MotifMemory {
  private state = createMotifMemory();

  public constructor(private readonly options?: Partial<MotifMemoryOptions>) {}

  public update(
    signals: NormalizedSignals,
    params: ArtisticParameters,
    now = signals.timestamp,
  ): MotifMemoryState {
    this.state = updateMotifMemory(this.state, signals, params, now, this.options);
    return this.snapshot();
  }

  public snapshot(): MotifMemoryState {
    return {
      ...this.state,
      motifs: this.state.motifs.map((motif) => ({ ...motif })),
      events: this.state.events.map((event) => ({ ...event })),
      lastSignals: this.state.lastSignals ? { ...this.state.lastSignals } : undefined,
    };
  }

  public reset(): void {
    this.state = createMotifMemory();
  }
}
