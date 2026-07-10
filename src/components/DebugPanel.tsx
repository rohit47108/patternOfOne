"use client";

import type {
  ArtisticParameters,
  DemoProfileName,
  ExperienceStage,
  NormalizedSignals,
  SensorStatus,
} from "@/src/lib/types";

interface DebugPanelProps {
  stage: ExperienceStage;
  fps: number;
  status: SensorStatus;
  signals: NormalizedSignals;
  params: ArtisticParameters;
  onStageChange: (stage: ExperienceStage) => void;
  onProfileChange: (profile: DemoProfileName) => void;
}

const STAGES: ExperienceStage[] = [
  "attract",
  "consent",
  "calibration",
  "session",
  "forming",
  "reveal",
  "compare",
  "resetting",
];

export function DebugPanel({
  stage,
  fps,
  status,
  signals,
  params,
  onStageChange,
  onProfileChange,
}: DebugPanelProps) {
  return (
    <aside className="debug-panel" aria-label="Development diagnostics">
      <header>
        <strong>Diagnostics</strong>
        <span>{Math.round(fps)} fps</span>
      </header>
      <label>
        State
        <select value={stage} onChange={(event) => onStageChange(event.target.value as ExperienceStage)}>
          {STAGES.map((item) => (
            <option value={item} key={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
      <div className="debug-actions">
        <button type="button" onClick={() => onProfileChange("measured")}>
          Measured
        </button>
        <button type="button" onClick={() => onProfileChange("kinetic")}>
          Kinetic
        </button>
      </div>
      <dl>
        <div><dt>Camera</dt><dd>{status.camera}</dd></div>
        <div><dt>Microphone</dt><dd>{status.microphone}</dd></div>
        <div><dt>Pose</dt><dd>{status.pose}</dd></div>
        <div><dt>Energy</dt><dd>{params.energy.toFixed(2)}</dd></div>
        <div><dt>Expansion</dt><dd>{params.expansion.toFixed(2)}</dd></div>
        <div><dt>Rhythm</dt><dd>{params.rhythm.toFixed(2)}</dd></div>
        <div><dt>Memory</dt><dd>{params.memory.toFixed(2)}</dd></div>
        <div><dt>Silence</dt><dd>{signals.silence.toFixed(2)}</dd></div>
      </dl>
    </aside>
  );
}
