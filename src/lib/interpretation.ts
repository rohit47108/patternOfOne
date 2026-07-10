import { mixSeed } from "./random";
import type { ArtisticParameters, Motif, Observation, RecordedFrame } from "./types";
import { NEUTRAL_PARAMS } from "./types";

export interface SessionMetrics {
  frameCount: number;
  durationMs: number;
  averages: ArtisticParameters;
  early: ArtisticParameters;
  late: ArtisticParameters;
  energyChange: number;
  expansionChange: number;
  continuityChange: number;
  symmetryChange: number;
  longestSilenceMs: number;
  motifCount: number;
  recurrentMotifs: number;
  gestureOccurrences: number;
  pulseOccurrences: number;
  stillnessOccurrences: number;
  fractureOccurrences: number;
  returnOccurrences: number;
}

export interface SessionInterpretation {
  title: string;
  observations: Observation[];
  metrics: SessionMetrics;
}

const PARAMETER_KEYS = [
  "energy",
  "expansion",
  "rhythm",
  "continuity",
  "symmetry",
  "volatility",
  "density",
  "memory",
  "silence",
  "illumination",
] as const satisfies readonly (keyof ArtisticParameters)[];

function averageParameters(frames: readonly RecordedFrame[]): ArtisticParameters {
  if (frames.length === 0) return { ...NEUTRAL_PARAMS };
  const result = Object.fromEntries(PARAMETER_KEYS.map((key) => [key, 0])) as unknown as ArtisticParameters;
  for (const frame of frames) {
    for (const key of PARAMETER_KEYS) {
      result[key] += Number.isFinite(frame.params[key]) ? frame.params[key] : 0;
    }
  }
  for (const key of PARAMETER_KEYS) result[key] /= frames.length;
  return result;
}

function occurrencesFor(motifs: readonly Motif[], kind: Motif["kind"]): number {
  return motifs
    .filter((motif) => motif.kind === kind)
    .reduce((sum, motif) => sum + motif.occurrences, 0);
}

function calculateLongestSilence(frames: readonly RecordedFrame[]): number {
  if (frames.length < 2) return 0;
  let start: number | undefined;
  let longest = 0;
  for (const frame of frames) {
    if (frame.params.silence >= 0.72) {
      start ??= frame.t;
      longest = Math.max(longest, frame.t - start);
    } else {
      start = undefined;
    }
  }
  return Math.max(0, longest);
}

export function analyzeSession(
  frames: readonly RecordedFrame[],
  motifs: readonly Motif[],
): SessionMetrics {
  const ordered = [...frames].sort((left, right) => left.t - right.t);
  const split = Math.max(1, Math.floor(ordered.length / 3));
  const earlyFrames = ordered.slice(0, split);
  const lateFrames = ordered.slice(Math.max(0, ordered.length - split));
  const early = averageParameters(earlyFrames);
  const late = averageParameters(lateFrames);

  return {
    frameCount: ordered.length,
    durationMs:
      ordered.length > 1
        ? Math.max(0, ordered[ordered.length - 1].t - ordered[0].t)
        : 0,
    averages: averageParameters(ordered),
    early,
    late,
    energyChange: late.energy - early.energy,
    expansionChange: late.expansion - early.expansion,
    continuityChange: late.continuity - early.continuity,
    symmetryChange: late.symmetry - early.symmetry,
    longestSilenceMs: calculateLongestSilence(ordered),
    motifCount: motifs.length,
    recurrentMotifs: motifs.filter((motif) => motif.occurrences >= 3).length,
    gestureOccurrences: occurrencesFor(motifs, "gesture"),
    pulseOccurrences: occurrencesFor(motifs, "pulse"),
    stillnessOccurrences: occurrencesFor(motifs, "stillness"),
    fractureOccurrences: occurrencesFor(motifs, "fracture"),
    returnOccurrences: occurrencesFor(motifs, "return"),
  };
}

interface TitleCandidate {
  title: string;
  score: number;
  rule: string;
}

function titleCandidates(metrics: SessionMetrics): TitleCandidate[] {
  const duration = Math.max(1, metrics.durationMs);
  const silenceShare = Math.min(1, metrics.longestSilenceMs / duration);
  const recurrence = Math.min(
    1,
    (metrics.recurrentMotifs + metrics.returnOccurrences * 0.6) / 5,
  );

  return [
    {
      title: "A Field Returning",
      score: recurrence * 0.42 + metrics.averages.memory * 0.12,
      rule: "recurrent motifs and session memory",
    },
    {
      title: "The Long Interval",
      score: metrics.averages.silence * 0.3 + silenceShare * 1.4,
      rule: "sustained negative space",
    },
    {
      title: "An Unfinished Rhythm",
      score: metrics.averages.rhythm * 0.7 + Math.min(1, metrics.pulseOccurrences / 8) * 0.42,
      rule: "periodic voice structures",
    },
    {
      title: "Moving Through Stillness",
      score:
        metrics.averages.continuity * 0.48 +
        Math.min(1, metrics.stillnessOccurrences / 5) * 0.38 +
        Math.abs(metrics.energyChange) * 0.22,
      rule: "continuity carrying changes in energy",
    },
    {
      title: "Divided Current",
      score:
        (1 - metrics.averages.symmetry) * 0.64 +
        Math.abs(metrics.symmetryChange) * 0.46 +
        metrics.averages.energy * 0.18,
      rule: "directional tension",
    },
    {
      title: "Luminous Measure",
      score: metrics.averages.illumination * 0.58 + metrics.averages.rhythm * 0.3,
      rule: "illumination shaped by measured pulses",
    },
    {
      title: "Quiet Orbit",
      score:
        metrics.averages.continuity * 0.26 +
        metrics.averages.silence * 0.2 +
        (1 - metrics.averages.volatility) * 0.2,
      rule: "stable continuity and quiet intervals",
    },
    {
      title: "A Gesture Widening",
      score:
        metrics.averages.expansion * 0.5 +
        Math.max(0, metrics.expansionChange) * 0.5 +
        Math.min(1, metrics.gestureOccurrences / 24) * 0.55,
      rule: "spatial expansion and repeated gesture",
    },
    {
      title: "Echo Without a Face",
      score: 0.34 + metrics.averages.memory * 0.18,
      rule: "fallback artistic interpretation",
    },
  ];
}

/** Select a traceable curated phrase; the seed only resolves near-equal scores. */
export function generatePortraitTitle(
  frames: readonly RecordedFrame[],
  motifs: readonly Motif[],
  seed: number,
): string {
  const metrics = analyzeSession(frames, motifs);
  const candidates = titleCandidates(metrics);
  candidates.sort((left, right) => {
    const scoreDifference = right.score - left.score;
    if (Math.abs(scoreDifference) > 0.005) return scoreDifference;
    const leftTie = mixSeed(seed, left.title);
    const rightTie = mixSeed(seed, right.title);
    return leftTie - rightTie;
  });
  return candidates[0].title;
}

interface ObservationCandidate extends Observation {
  id: string;
}

function signedPercent(value: number): string {
  const percent = Math.round(Math.abs(value) * 100);
  return `${value >= 0 ? "+" : "-"}${percent}%`;
}

function buildObservationCandidates(metrics: SessionMetrics): ObservationCandidate[] {
  const duration = Math.max(1, metrics.durationMs);
  const longestSilenceSeconds = metrics.longestSilenceMs / 1_000;
  const silenceShare = metrics.longestSilenceMs / duration;
  const expansionDirection = metrics.expansionChange >= 0 ? "expanded" : "contracted";
  const energyDirection = metrics.energyChange >= 0 ? "grew" : "softened";
  const continuityDirection = metrics.continuityChange >= 0 ? "more frequent" : "less frequent";

  return [
    {
      id: "silence",
      text:
        longestSilenceSeconds >= 1
          ? "Long pauses created some of the portrait's widest spaces."
          : "Speech and silence alternated without a single long interval.",
      evidence: `longest silence structure ${longestSilenceSeconds.toFixed(1)}s; mean silence ${metrics.averages.silence.toFixed(2)}`,
      score: 0.26 + Math.min(1, silenceShare) * 0.78 + metrics.averages.silence * 0.12,
    },
    {
      id: "expansion",
      text: `The form ${expansionDirection} as the encounter continued.`,
      evidence: `late minus early expansion ${signedPercent(metrics.expansionChange)}`,
      score: 0.28 + Math.abs(metrics.expansionChange) * 1.8,
    },
    {
      id: "energy",
      text: `Movement energy ${energyDirection} toward the final passage.`,
      evidence: `late minus early energy ${signedPercent(metrics.energyChange)}`,
      score: 0.27 + Math.abs(metrics.energyChange) * 1.7,
    },
    {
      id: "continuity",
      text: `Sustained structure became ${continuityDirection} near the end.`,
      evidence: `late minus early continuity ${signedPercent(metrics.continuityChange)}`,
      score: 0.25 + Math.abs(metrics.continuityChange) * 1.55,
    },
    {
      id: "rhythm",
      text:
        metrics.pulseOccurrences >= 3
          ? "A repeated rhythm became one of the portrait's persistent forms."
          : "Rhythm appeared as brief pulses rather than a persistent pattern.",
      evidence: `${metrics.pulseOccurrences} pulse occurrences; mean rhythm ${metrics.averages.rhythm.toFixed(2)}`,
      score: 0.2 + Math.min(1, metrics.pulseOccurrences / 7) * 0.68,
    },
    {
      id: "recurrence",
      text:
        metrics.recurrentMotifs > 0
          ? "Earlier structures returned and gathered weight over time."
          : "Most structures appeared once, leaving only light traces behind.",
      evidence: `${metrics.recurrentMotifs} recurrent motifs; ${metrics.returnOccurrences} explicit returns`,
      score:
        0.18 +
        Math.min(1, metrics.recurrentMotifs / 4) * 0.64 +
        Math.min(1, metrics.returnOccurrences / 3) * 0.18,
    },
    {
      id: "fracture",
      text:
        metrics.fractureOccurrences > 1
          ? "Sudden changes left controlled fractures in the accumulated form."
          : "Abrupt changes remained rare, so the form kept longer continuous lines.",
      evidence: `${metrics.fractureOccurrences} fracture occurrences; mean volatility ${metrics.averages.volatility.toFixed(2)}`,
      score: 0.16 + Math.min(1, metrics.fractureOccurrences / 5) * 0.58,
    },
  ];
}

/** Return exactly three public statements plus private, debug-only evidence. */
export function generateObservations(
  frames: readonly RecordedFrame[],
  motifs: readonly Motif[],
): Observation[] {
  const metrics = analyzeSession(frames, motifs);
  return buildObservationCandidates(metrics)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, 3)
    .map(({ text, evidence, score }) => ({ text, evidence, score }));
}

export function interpretSession(
  frames: readonly RecordedFrame[],
  motifs: readonly Motif[],
  seed: number,
): SessionInterpretation {
  const metrics = analyzeSession(frames, motifs);
  return {
    title: generatePortraitTitle(frames, motifs, seed),
    observations: generateObservations(frames, motifs),
    metrics,
  };
}

export const selectPortraitTitle = generatePortraitTitle;
