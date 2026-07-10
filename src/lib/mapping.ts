import type { ArtisticParameters, NormalizedSignals } from "./types";
import { NEUTRAL_PARAMS } from "./types";

export interface MappingOptions {
  /** 0 applies a new frame immediately; values near 1 retain more history. */
  smoothing: number;
  reducedMotion: boolean;
}

export const DEFAULT_MAPPING_OPTIONS: Readonly<MappingOptions> = {
  smoothing: 0.18,
  reducedMotion: false,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Convert the bounded z-score domain [-3, 3] into [-1, 1]. */
function delta(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(-1, value / 3));
}

function positive(value: number): number {
  return Math.max(0, delta(value));
}

function magnitude(value: number): number {
  return Math.abs(delta(value));
}

function blend(previous: number, next: number, smoothing: number): number {
  return clamp01(previous * smoothing + next * (1 - smoothing));
}

/**
 * Translate participant-relative changes into a small structural vocabulary.
 * No parameter is a diagnosis or an emotion label; each combines several
 * signals so the output reads as a coherent organism rather than a dashboard.
 */
export function mapSignals(
  signals: NormalizedSignals,
  memoryStrength = 0,
  previous?: ArtisticParameters,
  options?: Partial<MappingOptions>,
): ArtisticParameters {
  const smoothing = previous
    ? clamp01(options?.smoothing ?? DEFAULT_MAPPING_OPTIONS.smoothing)
    : 0;
  const reducedMotion = options?.reducedMotion ?? DEFAULT_MAPPING_OPTIONS.reducedMotion;

  const movement = positive(signals.movement);
  const movementChange = magnitude(signals.movement);
  const wrists = (positive(signals.leftWrist) + positive(signals.rightWrist)) / 2;
  const wristDifference = Math.abs(delta(signals.leftWrist) - delta(signals.rightWrist));
  const reach = positive(signals.reach);
  const voice = positive(signals.loudness);
  const speech = positive(signals.speech);
  const rhythmSignal = positive(signals.rhythm);
  const sudden = Math.max(positive(signals.sudden), magnitude(signals.sudden) * 0.55);
  const stillness = positive(signals.stillness);
  const silenceChange = delta(signals.silence);
  const variation = Math.max(
    positive(signals.vocalVariation),
    movementChange * 0.45,
  );
  const memory = clamp01(memoryStrength);

  const target: ArtisticParameters = {
    energy: clamp01(
      NEUTRAL_PARAMS.energy +
        movement * 0.43 +
        wrists * 0.18 +
        voice * 0.16 +
        rhythmSignal * 0.09 -
        Math.max(0, -delta(signals.movement)) * 0.08,
    ),
    expansion: clamp01(
      NEUTRAL_PARAMS.expansion +
        reach * 0.46 +
        movement * 0.17 +
        positive(signals.proximity) * 0.08 +
        wristDifference * 0.11,
    ),
    rhythm: clamp01(
      NEUTRAL_PARAMS.rhythm +
        rhythmSignal * 0.56 +
        speech * 0.14 +
        voice * 0.12 +
        memory * 0.08,
    ),
    continuity: clamp01(
      NEUTRAL_PARAMS.continuity +
        stillness * 0.2 +
        memory * 0.13 -
        sudden * 0.36 -
        movementChange * 0.08,
    ),
    symmetry: clamp01(
      NEUTRAL_PARAMS.symmetry +
        delta(signals.symmetry) * 0.2 -
        wristDifference * 0.27 -
        magnitude(signals.shoulderTilt) * 0.12,
    ),
    volatility: clamp01(
      NEUTRAL_PARAMS.volatility +
        sudden * 0.54 +
        variation * 0.2 +
        movementChange * 0.14 +
        magnitude(signals.headShift) * 0.08,
    ),
    density: clamp01(
      NEUTRAL_PARAMS.density +
        positive(signals.proximity) * 0.28 +
        stillness * 0.17 +
        variation * 0.12 +
        memory * 0.15 -
        reach * 0.08,
    ),
    memory,
    silence: clamp01(
      NEUTRAL_PARAMS.silence +
        Math.max(0, silenceChange) * 0.2 -
        Math.max(0, -silenceChange) * 0.24 -
        speech * 0.38 -
        voice * 0.17,
    ),
    illumination: clamp01(
      NEUTRAL_PARAMS.illumination +
        voice * 0.38 +
        movement * 0.14 +
        rhythmSignal * 0.11 +
        memory * 0.12 -
        Math.max(0, silenceChange) * 0.12,
    ),
  };

  if (reducedMotion) {
    target.energy = clamp01(NEUTRAL_PARAMS.energy + (target.energy - NEUTRAL_PARAMS.energy) * 0.45);
    target.volatility = clamp01(
      NEUTRAL_PARAMS.volatility +
        (target.volatility - NEUTRAL_PARAMS.volatility) * 0.35,
    );
    target.rhythm = clamp01(NEUTRAL_PARAMS.rhythm + (target.rhythm - NEUTRAL_PARAMS.rhythm) * 0.55);
  }

  if (!previous) return target;

  return {
    energy: blend(previous.energy, target.energy, smoothing),
    expansion: blend(previous.expansion, target.expansion, smoothing),
    rhythm: blend(previous.rhythm, target.rhythm, smoothing),
    continuity: blend(previous.continuity, target.continuity, smoothing),
    symmetry: blend(previous.symmetry, target.symmetry, smoothing),
    volatility: blend(previous.volatility, target.volatility, smoothing),
    density: blend(previous.density, target.density, smoothing),
    memory: blend(previous.memory, target.memory, smoothing),
    silence: blend(previous.silence, target.silence, smoothing),
    illumination: blend(previous.illumination, target.illumination, smoothing),
  };
}

export const mapSignalsToParameters = mapSignals;
