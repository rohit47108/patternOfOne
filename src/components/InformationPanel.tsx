"use client";

import { useEffect, useRef } from "react";
import type { SoundscapeStatus } from "@/src/lib/soundscape";
import type { EffectiveQuality, QualityTier, SensorStatus } from "@/src/lib/types";

interface InformationPanelProps {
  open: boolean;
  onClose: () => void;
  quality: QualityTier;
  effectiveQuality: EffectiveQuality;
  onQualityChange: (quality: QualityTier) => void;
  sensorStatus: SensorStatus;
  soundStatus: SoundscapeStatus;
  onSoundVolumeChange: (volume: number) => void;
}

export function InformationPanel({
  open,
  onClose,
  quality,
  effectiveQuality,
  onQualityChange,
  sensorStatus,
  soundStatus,
  onSoundVolumeChange,
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
          "button:not([disabled]), select:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
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
          <h2 id="about-title">What changes the portrait.</h2>
          <p>
            Pattern of One responds to the rhythm of one short encounter. Movement, sound, and pauses alter the same living
            form in real time. The result is artwork, not a reading of who you are.
          </p>
        </div>

        <div className="info-grid">
          <article>
            <h3>What changes it</h3>
            <p>
              Broad movement, reach, balance, distance, stillness, sound level, rhythm, and pauses. The portrait responds to
              changes during this session instead of comparing you with other people.
            </p>
          </article>
          <article>
            <h3>What stays here</h3>
            <p>
              Camera and microphone features are processed in this tab. Raw video and audio are not uploaded or saved, and
              media tracks stop when you cancel or reset. A small derived replay and your display settings can remain in this
              browser until you choose Clear session. Demo mode requests neither device.
            </p>
          </article>
          <article>
            <h3>What it means</h3>
            <p>
              It is an artistic interpretation of a temporary interaction. It does not recognize faces, identify people,
              diagnose emotion, or score personality. Lighting, room noise, and browser support can affect the form.
            </p>
          </article>
        </div>

        <footer className="info-footer">
          <div className="settings-group">
            <label className="quality-field">
              <span>Rendering quality</span>
              <select value={quality} onChange={(event) => onQualityChange(event.target.value as QualityTier)}>
                <option value="auto">Auto</option>
                <option value="high">High</option>
                <option value="balanced">Balanced</option>
                <option value="low">Low</option>
              </select>
            </label>
            <p className="settings-readout" aria-live="polite">Currently using {effectiveQuality} quality.</p>
          </div>
          <label className="volume-field">
            <span>Ambient volume</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={soundStatus.volume}
              onChange={(event) => onSoundVolumeChange(Number(event.target.value))}
            />
            <span>{Math.round(soundStatus.volume * 100)}% · {soundStatus.state === "ready" && !soundStatus.muted && soundStatus.volume > 0.01 ? "on" : "off"}</span>
          </label>
          <p className="sensor-summary" aria-live="polite">
            Camera {sensorStatus.camera} · Microphone {sensorStatus.microphone} · Motion {sensorStatus.pose}
          </p>
        </footer>
      </section>
    </div>
  );
}
