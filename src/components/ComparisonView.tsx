"use client";

import { PortraitCanvas } from "./PortraitCanvas";
import { SessionTimeline } from "./SessionTimeline";
import type { EffectiveQuality, SessionRecord } from "@/src/lib/types";

interface ComparisonViewProps {
  sessions: [SessionRecord, SessionRecord];
  quality: EffectiveQuality;
  reducedMotion: boolean;
  onBack: () => void;
  onReset: () => void;
}

function differenceSummary(a: SessionRecord, b: SessionRecord) {
  const energy = b.finalParams.energy - a.finalParams.energy;
  const silence = b.finalParams.silence - a.finalParams.silence;
  const expansion = b.finalParams.expansion - a.finalParams.expansion;
  const fragments = [
    Math.abs(energy) > 0.08 ? `${energy > 0 ? "The right portrait carried more motion" : "The left portrait carried more motion"}` : null,
    Math.abs(silence) > 0.08 ? `${silence > 0 ? "while the right held longer spaces" : "while the left held longer spaces"}` : null,
    Math.abs(expansion) > 0.08 ? `${expansion > 0 ? "and the right opened farther" : "and the left opened farther"}` : null,
  ].filter(Boolean);
  return fragments.length ? `${fragments.join(" ")}. Neither is a score; each is a record of different input.` : "Their inputs differed in smaller ways, but each retained a distinct history of rhythm and pause.";
}

export function ComparisonView({ sessions, quality, reducedMotion, onBack, onReset }: ComparisonViewProps) {
  return (
    <section className="compare-view" aria-labelledby="compare-title">
      <header className="compare-header">
        <div>
          <p className="eyebrow">Two temporary encounters</p>
          <h2 id="compare-title" data-stage-heading tabIndex={-1}>Difference without judgment.</h2>
        </div>
        <div className="edge-actions">
          <button type="button" className="text-control" onClick={onBack}>Back to portrait</button>
          <button type="button" className="text-control" onClick={onReset}>Clear both</button>
        </div>
      </header>
      <div className="compare-grid">
        {sessions.map((session, index) => (
          <article className="compare-portrait" key={session.id}>
            <div className="compare-canvas-wrap">
              <PortraitCanvas
                stage="reveal"
                params={session.finalParams}
                motifs={session.motifs}
                seed={session.seed}
                accentHue={session.accentHue}
                quality={quality === "high" ? "balanced" : quality}
                reducedMotion={reducedMotion}
                interactive={false}
                label={`Living abstract portrait: ${session.title}`}
              />
              <span className="compare-index" aria-hidden="true">0{index + 1}</span>
            </div>
            <div className="compare-caption">
              <h3>{session.title}</h3>
              <SessionTimeline frames={session.frames} accentHue={session.accentHue} compact />
              <p>{session.observations[0]?.text}</p>
            </div>
          </article>
        ))}
      </div>
      <p className="compare-summary">{differenceSummary(sessions[0], sessions[1])}</p>
    </section>
  );
}
