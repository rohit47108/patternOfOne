"use client";

import { useEffect, useRef } from "react";
import type { QualityTier, SensorStatus } from "@/src/lib/types";

interface InformationPanelProps {
  open: boolean;
  onClose: () => void;
  quality: QualityTier;
  onQualityChange: (quality: QualityTier) => void;
  sensorStatus: SensorStatus;
}

export function InformationPanel({
  open,
  onClose,
  quality,
  onQualityChange,
  sensorStatus,
}: InformationPanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
        ) ?? [],
      ).filter((element) => !element.hidden);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      previous?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="info-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={panelRef} className="info-panel" role="dialog" aria-modal="true" aria-labelledby="about-title">
        <header className="info-header">
          <p className="eyebrow">Project information</p>
          <button ref={closeRef} className="text-control" type="button" onClick={onClose} aria-label="Close project information">
            Close <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="info-intro">
          <h2 id="about-title">A portrait made from change.</h2>
          <p>
            Traditional portraits capture appearance at a single moment. Pattern of One creates a living form from rhythm,
            silence, gesture, repetition, and change. It is one computational interpretation of a temporary encounter—not a
            diagnosis or definition of you.
          </p>
        </div>

        <div className="info-grid">
          <article>
            <h3>What it observes</h3>
            <p>
              Movement intensity, reach, balance, proximity, stillness, sound level, vocal rhythm, variation, and pauses. Each
              signal is compared with your own evolving baseline.
            </p>
          </article>
          <article>
            <h3>What it never does</h3>
            <p>
              No face recognition, identity matching, emotion diagnosis, personality scoring, protected-trait inference, or
              raw camera and microphone storage.
            </p>
          </article>
          <article>
            <h3>How privacy works</h3>
            <p>
              Camera landmarks and audio features are processed locally in this tab. Raw video and audio are not uploaded.
              Media tracks stop on exit and reset. A lightweight derived replay can remain in this browser for comparison until
              you clear the session; reset deletes it. Demo mode requires neither camera nor microphone.
            </p>
          </article>
          <article>
            <h3>How it is made</h3>
            <p>
              A deterministic TypeScript signal pipeline, adaptive personal baselines, local pose analysis with a motion
              fallback, Canvas 2D rendering, and an optional Web Audio soundscape.
            </p>
          </article>
          <article>
            <h3>Limitations</h3>
            <p>
              Lighting, room noise, occlusion, assistive devices, camera position, and browser support can change the available
              signals. The artwork makes no claim to objective perception.
            </p>
          </article>
          <article>
            <h3>Hackathon connection</h3>
            <p>
              Real-time computation is the medium: without participant input, adaptive memory, and live synthesis, the portrait
              cannot exist.
            </p>
          </article>
        </div>

        <footer className="info-footer">
          <label className="quality-field">
            <span>Rendering quality</span>
            <select value={quality} onChange={(event) => onQualityChange(event.target.value as QualityTier)}>
              <option value="auto">Auto</option>
              <option value="high">High</option>
              <option value="balanced">Balanced</option>
              <option value="low">Low</option>
            </select>
          </label>
          <p className="sensor-summary" aria-live="polite">
            Camera {sensorStatus.camera} · Microphone {sensorStatus.microphone} · Pose {sensorStatus.pose}
          </p>
          <p>Original software and generative sound. Reference research and implementation notes are documented in the repository.</p>
        </footer>
      </section>
    </div>
  );
}
