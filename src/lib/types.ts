export type ExperienceStage =
  | "attract"
  | "consent"
  | "calibration"
  | "session"
  | "forming"
  | "reveal"
  | "compare"
  | "resetting";

export type InputMode = "full" | "movement" | "demo";
export type DemoProfileName = "measured" | "kinetic";
export type DemoChoice = DemoProfileName | "contrast";
export type QualityTier = "auto" | "high" | "balanced" | "low";
export type EffectiveQuality = Exclude<QualityTier, "auto">;

export interface RawSignals {
  timestamp: number;
  movement: number;
  leftWrist: number;
  rightWrist: number;
  reach: number;
  headShift: number;
  shoulderTilt: number;
  symmetry: number;
  proximity: number;
  stillness: number;
  loudness: number;
  speech: number;
  silence: number;
  vocalVariation: number;
  rhythm: number;
  sudden: number;
}

export type SignalKey = Exclude<keyof RawSignals, "timestamp">;
export type NormalizedSignals = Record<SignalKey, number> & { timestamp: number };

export interface BaselineStat {
  mean: number;
  variance: number;
  initialized: boolean;
}

export type BaselineModel = Record<SignalKey, BaselineStat>;

export interface ArtisticParameters {
  energy: number;
  expansion: number;
  rhythm: number;
  continuity: number;
  symmetry: number;
  volatility: number;
  density: number;
  memory: number;
  silence: number;
  illumination: number;
}

export type MotifKind = "gesture" | "pulse" | "stillness" | "fracture" | "return";

export interface Motif {
  id: string;
  kind: MotifKind;
  strength: number;
  persistence: number;
  createdAt: number;
  lastSeenAt: number;
  occurrences: number;
  phase: number;
}

export interface RecordedFrame {
  t: number;
  signals: NormalizedSignals;
  params: ArtisticParameters;
}

export interface SignalFrame {
  raw: RawSignals;
  normalized: NormalizedSignals;
  params: ArtisticParameters;
  motifs: Motif[];
}

export interface Observation {
  text: string;
  evidence: string;
  score: number;
}

export interface SessionRecord {
  version: 1;
  id: string;
  seed: number;
  startedAt: number;
  duration: number;
  inputMode: InputMode;
  profile?: DemoProfileName;
  accentHue: number;
  title: string;
  observations: Observation[];
  frames: RecordedFrame[];
  motifs: Motif[];
  finalParams: ArtisticParameters;
}

export interface SensorStatus {
  camera: "idle" | "loading" | "ready" | "denied" | "unavailable" | "error";
  microphone: "idle" | "loading" | "ready" | "denied" | "unavailable" | "error";
  pose: "idle" | "loading" | "ready" | "fallback" | "error";
  message?: string;
}

export interface PromptDefinition {
  label: string;
  text: string;
  duration: number;
}

export const NEUTRAL_SIGNALS: RawSignals = {
  timestamp: 0,
  movement: 0.12,
  leftWrist: 0.1,
  rightWrist: 0.1,
  reach: 0.25,
  headShift: 0.08,
  shoulderTilt: 0.05,
  symmetry: 0.72,
  proximity: 0.42,
  stillness: 0.55,
  loudness: 0,
  speech: 0,
  silence: 1,
  vocalVariation: 0,
  rhythm: 0,
  sudden: 0,
};

export const NEUTRAL_PARAMS: ArtisticParameters = {
  energy: 0.16,
  expansion: 0.28,
  rhythm: 0.08,
  continuity: 0.7,
  symmetry: 0.68,
  volatility: 0.12,
  density: 0.42,
  memory: 0,
  silence: 0.8,
  illumination: 0.32,
};
