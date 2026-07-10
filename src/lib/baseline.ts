import type {
  BaselineModel,
  BaselineStat,
  NormalizedSignals,
  RawSignals,
  SignalKey,
} from "./types";

export const SIGNAL_KEYS = [
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
] as const satisfies readonly SignalKey[];

export interface BaselineOptions {
  /** Adaptation rate for the participant's personal mean. */
  meanAlpha: number;
  /** Adaptation rate for exponential variance. */
  varianceAlpha: number;
  /** Starting variance prevents a second sample from producing an extreme z-score. */
  initialVariance: number;
  /** Hard variance floor protects still or quantized sensors. */
  minimumVariance: number;
  /** A corrupt sensor cannot permanently inflate the baseline. */
  maximumVariance: number;
  epsilon: number;
  normalizationLimit: number;
}

export const DEFAULT_BASELINE_OPTIONS: Readonly<BaselineOptions> = {
  meanAlpha: 0.035,
  varianceAlpha: 0.06,
  initialVariance: 0.01,
  minimumVariance: 0.0004,
  maximumVariance: 4,
  epsilon: 1e-6,
  normalizationLimit: 3,
};

export interface BaselineUpdate {
  baseline: BaselineModel;
  normalized: NormalizedSignals;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function validRate(value: number, fallback: number): number {
  return Number.isFinite(value) ? clamp(value, 0.000_001, 1) : fallback;
}

function resolveOptions(options?: Partial<BaselineOptions>): BaselineOptions {
  const defaults = DEFAULT_BASELINE_OPTIONS;
  const suppliedMinimumVariance = options?.minimumVariance;
  const suppliedMaximumVariance = options?.maximumVariance;
  const suppliedInitialVariance = options?.initialVariance;
  const suppliedEpsilon = options?.epsilon;
  const suppliedLimit = options?.normalizationLimit;
  const minimumVariance = Math.max(
    Number.EPSILON,
    Number.isFinite(suppliedMinimumVariance)
      ? Math.abs(suppliedMinimumVariance!)
      : defaults.minimumVariance,
  );
  const maximumVariance = Math.max(
    minimumVariance,
    Number.isFinite(suppliedMaximumVariance)
      ? Math.abs(suppliedMaximumVariance!)
      : defaults.maximumVariance,
  );

  return {
    meanAlpha: validRate(options?.meanAlpha ?? defaults.meanAlpha, defaults.meanAlpha),
    varianceAlpha: validRate(
      options?.varianceAlpha ?? defaults.varianceAlpha,
      defaults.varianceAlpha,
    ),
    initialVariance: clamp(
      Number.isFinite(suppliedInitialVariance)
        ? Math.abs(suppliedInitialVariance!)
        : defaults.initialVariance,
      minimumVariance,
      maximumVariance,
    ),
    minimumVariance,
    maximumVariance,
    epsilon: Math.max(
      Number.EPSILON,
      Number.isFinite(suppliedEpsilon)
        ? Math.abs(suppliedEpsilon!)
        : defaults.epsilon,
    ),
    normalizationLimit: Math.max(
      Number.EPSILON,
      Number.isFinite(suppliedLimit)
        ? Math.abs(suppliedLimit!)
        : defaults.normalizationLimit,
    ),
  };
}

export function createBaselineModel(
  initial?: Partial<Record<SignalKey, number | BaselineStat>>,
  options?: Partial<BaselineOptions>,
): BaselineModel {
  const settings = resolveOptions(options);
  return Object.fromEntries(
    SIGNAL_KEYS.map((key) => {
      const supplied = initial?.[key];
      if (typeof supplied === "number" && Number.isFinite(supplied)) {
        return [
          key,
          {
            mean: supplied,
            variance: settings.initialVariance,
            initialized: true,
          },
        ];
      }

      if (typeof supplied === "object" && supplied !== null) {
        return [
          key,
          {
            mean: Number.isFinite(supplied.mean) ? supplied.mean : 0,
            variance: clamp(
              Number.isFinite(supplied.variance)
                ? Math.abs(supplied.variance)
                : settings.initialVariance,
              settings.minimumVariance,
              settings.maximumVariance,
            ),
            initialized: Boolean(supplied.initialized),
          },
        ];
      }

      return [
        key,
        {
          mean: 0,
          variance: settings.initialVariance,
          initialized: false,
        },
      ];
    }),
  ) as unknown as BaselineModel;
}

export interface SignalBaselineUpdate {
  stat: BaselineStat;
  normalized: number;
}

/**
 * Update one exponentially weighted mean and variance.
 *
 * Variance uses delta * (sample - nextMean), the stable online form of an
 * exponentially weighted central moment. Normalization is the brief's bounded
 * z-score and therefore always lies in [-normalizationLimit, +limit].
 */
export function updateBaselineStat(
  current: BaselineStat,
  sample: number,
  options?: Partial<BaselineOptions>,
): SignalBaselineUpdate {
  const settings = resolveOptions(options);
  const fallback = current.initialized && Number.isFinite(current.mean) ? current.mean : 0;
  const safeSample = Number.isFinite(sample) ? sample : fallback;

  if (!current.initialized || !Number.isFinite(current.mean)) {
    return {
      stat: {
        mean: safeSample,
        variance: settings.initialVariance,
        initialized: true,
      },
      normalized: 0,
    };
  }

  const previousVariance = clamp(
    Number.isFinite(current.variance)
      ? Math.abs(current.variance)
      : settings.initialVariance,
    settings.minimumVariance,
    settings.maximumVariance,
  );
  const delta = safeSample - current.mean;
  const mean = current.mean + settings.meanAlpha * delta;
  const varianceSample = Math.max(0, delta * (safeSample - mean));
  const variance = clamp(
    (1 - settings.varianceAlpha) * previousVariance +
      settings.varianceAlpha * varianceSample,
    settings.minimumVariance,
    settings.maximumVariance,
  );
  const standardDeviation = Math.sqrt(variance + settings.epsilon);
  const normalized = clamp(
    (safeSample - mean) / standardDeviation,
    -settings.normalizationLimit,
    settings.normalizationLimit,
  );

  return {
    stat: { mean, variance, initialized: true },
    normalized: Number.isFinite(normalized) ? normalized : 0,
  };
}

/** Update every signal without mutating the caller's baseline model. */
export function normalizeSignals(
  raw: RawSignals,
  model: BaselineModel,
  options?: Partial<BaselineOptions>,
): BaselineUpdate {
  const baseline = {} as BaselineModel;
  const normalized = {
    timestamp: Number.isFinite(raw.timestamp) ? raw.timestamp : 0,
  } as NormalizedSignals;

  for (const key of SIGNAL_KEYS) {
    const update = updateBaselineStat(model[key], raw[key], options);
    baseline[key] = update.stat;
    normalized[key] = update.normalized;
  }

  return { baseline, normalized };
}

/** Alias retained for call sites that describe the operation as an update. */
export const updateBaselines = normalizeSignals;

/** Stateful convenience wrapper for media loops. */
export class PersonalBaseline {
  private model: BaselineModel;

  public constructor(
    initial?: Partial<Record<SignalKey, number | BaselineStat>>,
    private readonly options?: Partial<BaselineOptions>,
  ) {
    this.model = createBaselineModel(initial, options);
  }

  public update(raw: RawSignals): NormalizedSignals {
    const result = normalizeSignals(raw, this.model, this.options);
    this.model = result.baseline;
    return result.normalized;
  }

  public snapshot(): BaselineModel {
    return createBaselineModel(this.model, this.options);
  }

  public reset(initial?: Partial<Record<SignalKey, number | BaselineStat>>): void {
    this.model = createBaselineModel(initial, this.options);
  }
}
