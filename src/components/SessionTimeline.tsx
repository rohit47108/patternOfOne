"use client";

import type { RecordedFrame } from "@/src/lib/types";

interface SessionTimelineProps {
  frames: RecordedFrame[];
  accentHue: number;
  progress?: number;
  compact?: boolean;
}

export function SessionTimeline({ frames, accentHue, progress, compact = false }: SessionTimelineProps) {
  const buckets = Array.from({ length: compact ? 22 : 42 }, (_, index) => {
    const frame = frames[Math.min(frames.length - 1, Math.floor((index / (compact ? 21 : 41)) * frames.length))];
    return frame
      ? {
          energy: frame.params.energy,
          silence: frame.params.silence,
          memory: frame.params.memory,
        }
      : { energy: 0.1, silence: 0.8, memory: 0 };
  });

  return (
    <div className={`session-timeline${compact ? " session-timeline--compact" : ""}`}>
      <div className="timeline-bars" aria-hidden="true">
        {buckets.map((bucket, index) => (
          <span
            key={index}
            style={{
              height: `${18 + bucket.energy * 62 + bucket.memory * 20}%`,
              opacity: 0.2 + (1 - bucket.silence) * 0.62,
              backgroundColor: `hsl(${(accentHue + index * 0.9) % 360} 58% ${58 + bucket.memory * 18}%)`,
            }}
          />
        ))}
      </div>
      {typeof progress === "number" ? (
        <span className="timeline-playhead" style={{ left: `${Math.min(100, Math.max(0, progress * 100))}%` }} aria-hidden="true" />
      ) : null}
      <p className="sr-only">Session timeline showing energy, silence, and persistent memory across the encounter.</p>
    </div>
  );
}
