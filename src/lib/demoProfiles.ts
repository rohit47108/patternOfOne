import { createSeededRandom, mixSeed } from "./random";
import { PortraitSessionEngine } from "./session";
import { CAPTURE_DURATION_MS } from "./timing";
import type { DemoProfileName, RawSignals, SessionRecord } from "./types";

export const DEFAULT_DEMO_SEED = 0x50a77e;
/** Signal capture is 2s calibration + 15s prompts; formation is UI-only. */
export const DEFAULT_DEMO_DURATION_MS = CAPTURE_DURATION_MS;
export const DEFAULT_DEMO_FRAME_INTERVAL_MS = 100;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function smoothstep(value: number): number {
  const x = clamp01(value);
  return x * x * (3 - 2 * x);
}

function cyclicPosition(seconds: number, period: number, phase: number): number {
  return (((seconds + phase * period) % period) + period) % period / period;
}

/** A soft repeating impulse with no discontinuity at the cycle boundary. */
function cyclicPulse(
  seconds: number,
  period: number,
  center: number,
  width: number,
  phase: number,
): number {
  const position = cyclicPosition(seconds, period, phase);
  const direct = Math.abs(position - center);
  const distance = Math.min(direct, 1 - direct);
  return Math.exp(-(distance * distance) / Math.max(0.0001, width * width));
}

function activeWindow(position: number, start: number, end: number, edge = 0.04): number {
  if (position < start || position > end) return 0;
  const fadeIn = smoothstep((position - start) / edge);
  const fadeOut = smoothstep((end - position) / edge);
  return Math.min(fadeIn, fadeOut);
}

function profilePhases(profile: DemoProfileName, seed: number): number[] {
  const random = createSeededRandom(mixSeed(seed, profile));
  return Array.from({ length: 12 }, () => random());
}

/**
 * Sample a deterministic synthetic participant. Values use the same raw signal
 * shape as sensors; no renderer or interpretation code has a demo-only path.
 */
export function generateDemoSignals(
  profile: DemoProfileName,
  elapsedMs: number,
  seed = DEFAULT_DEMO_SEED,
): RawSignals {
  const timestamp = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
  const seconds = timestamp / 1_000;
  const phase = profilePhases(profile, seed);

  if (profile === "measured") {
    const speechPosition = cyclicPosition(seconds, 17.5, phase[0]);
    const speech = activeWindow(speechPosition, 0.08, 0.39, 0.055);
    const gesture = cyclicPulse(seconds, 10.5, 0.54, 0.075, phase[1]);
    const gentlePulse = cyclicPulse(seconds, 3.8, 0.34, 0.11, phase[2]);
    const movement =
      0.09 +
      0.018 * Math.sin(seconds * 0.42 + phase[3] * Math.PI * 2) +
      0.026 * Math.sin(seconds * 0.13 + phase[4] * Math.PI * 2) +
      gesture * 0.13;
    const loudness = speech * (0.16 + gentlePulse * 0.08);

    return {
      timestamp,
      movement: clamp01(movement),
      leftWrist: clamp01(0.075 + gesture * 0.1 + Math.sin(seconds * 0.33 + phase[5] * 6) * 0.012),
      rightWrist: clamp01(0.08 + gesture * 0.085 + Math.sin(seconds * 0.29 + phase[6] * 6) * 0.011),
      reach: clamp01(0.27 + Math.sin(seconds * 0.18 + phase[7] * 6) * 0.035 + gesture * 0.08),
      headShift: clamp01(0.055 + Math.sin(seconds * 0.21 + phase[8] * 6) * 0.014),
      shoulderTilt: clamp01(0.035 + Math.sin(seconds * 0.16 + phase[9] * 6) * 0.012),
      symmetry: clamp01(0.79 + Math.sin(seconds * 0.12 + phase[10] * 6) * 0.035),
      proximity: clamp01(0.41 + Math.sin(seconds * 0.08 + phase[11] * 6) * 0.025),
      stillness: clamp01(0.78 - movement * 0.42 - gesture * 0.18),
      loudness: clamp01(loudness),
      speech: clamp01(speech * 0.74),
      silence: clamp01(1 - speech * 0.9),
      vocalVariation: clamp01(speech * (0.12 + gentlePulse * 0.07)),
      rhythm: clamp01(speech * (0.12 + gentlePulse * 0.18)),
      sudden: clamp01(gesture * 0.09),
    };
  }

  const speechPosition = cyclicPosition(seconds, 3.1, phase[0]);
  const speech = activeWindow(speechPosition, 0.035, 0.76, 0.055);
  const gesture = Math.max(
    cyclicPulse(seconds, 2.7, 0.23, 0.09, phase[1]),
    cyclicPulse(seconds, 4.4, 0.68, 0.075, phase[2]),
  );
  const oppositeGesture = cyclicPulse(seconds, 3.3, 0.58, 0.11, phase[3]);
  const beat = cyclicPulse(seconds, 0.76, 0.22, 0.12, phase[4]);
  const fracture = cyclicPulse(seconds, 6.2, 0.72, 0.035, phase[5]);
  const movement =
    0.39 +
    Math.sin(seconds * 1.74 + phase[6] * 6) * 0.105 +
    Math.sin(seconds * 3.17 + phase[7] * 6) * 0.075 +
    gesture * 0.25;
  const loudness = speech * (0.36 + beat * 0.25 + Math.sin(seconds * 2.4) * 0.05);

  return {
    timestamp,
    movement: clamp01(movement),
    leftWrist: clamp01(0.32 + gesture * 0.38 + Math.sin(seconds * 2.1 + phase[8] * 6) * 0.11),
    rightWrist: clamp01(0.29 + oppositeGesture * 0.42 + Math.sin(seconds * 2.7 + phase[9] * 6) * 0.1),
    reach: clamp01(0.52 + gesture * 0.28 + Math.sin(seconds * 0.91 + phase[10] * 6) * 0.1),
    headShift: clamp01(0.21 + Math.abs(Math.sin(seconds * 1.23 + phase[11] * 6)) * 0.18),
    shoulderTilt: clamp01(0.16 + Math.abs(Math.sin(seconds * 0.83 + phase[2] * 6)) * 0.17),
    symmetry: clamp01(0.5 + Math.sin(seconds * 1.08 + phase[3] * 6) * 0.18),
    proximity: clamp01(0.56 + Math.sin(seconds * 0.61 + phase[4] * 6) * 0.12),
    stillness: clamp01(0.29 - movement * 0.24 - gesture * 0.08),
    loudness: clamp01(loudness),
    speech: clamp01(speech * 0.9),
    silence: clamp01(1 - speech * 0.94),
    vocalVariation: clamp01(speech * (0.48 + Math.abs(Math.sin(seconds * 1.9)) * 0.29)),
    rhythm: clamp01(speech * (0.5 + beat * 0.42)),
    sudden: clamp01(fracture * 0.86 + gesture * 0.14),
  };
}

export function generateDemoTimeline(
  profile: DemoProfileName,
  seed = DEFAULT_DEMO_SEED,
  durationMs = DEFAULT_DEMO_DURATION_MS,
  frameIntervalMs = DEFAULT_DEMO_FRAME_INTERVAL_MS,
): RawSignals[] {
  const duration = Math.max(0, Math.floor(durationMs));
  const interval = Math.max(16, Math.floor(frameIntervalMs));
  const frames: RawSignals[] = [];
  for (let elapsed = 0; elapsed <= duration; elapsed += interval) {
    frames.push(generateDemoSignals(profile, elapsed, seed));
  }
  if (frames[frames.length - 1]?.timestamp !== duration) {
    frames.push(generateDemoSignals(profile, duration, seed));
  }
  return frames;
}

/** Run a complete synthetic encounter through the production core pipeline. */
export function simulateDemoSession(
  profile: DemoProfileName,
  seed = DEFAULT_DEMO_SEED,
  durationMs = DEFAULT_DEMO_DURATION_MS,
  frameIntervalMs = DEFAULT_DEMO_FRAME_INTERVAL_MS,
): SessionRecord {
  const startedAt = 1_700_000_000_000 + (mixSeed(seed, profile) % 31_536_000_000);
  const engine = new PortraitSessionEngine({ seed, startedAt });
  for (const signals of generateDemoTimeline(profile, seed, durationMs, frameIntervalMs)) {
    engine.process(signals);
  }
  return engine.finalize("demo", profile);
}

export function simulateContrastingSessions(
  seed = DEFAULT_DEMO_SEED,
  durationMs = DEFAULT_DEMO_DURATION_MS,
  frameIntervalMs = DEFAULT_DEMO_FRAME_INTERVAL_MS,
): [SessionRecord, SessionRecord] {
  return [
    simulateDemoSession("measured", mixSeed(seed, "measured-session"), durationMs, frameIntervalMs),
    simulateDemoSession("kinetic", mixSeed(seed, "kinetic-session"), durationMs, frameIntervalMs),
  ];
}

export const generateContrastingSessions = simulateContrastingSessions;
