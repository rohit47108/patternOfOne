"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ComparisonView } from "./ComparisonView";
import { DebugPanel } from "./DebugPanel";
import { InformationPanel } from "./InformationPanel";
import { PortraitCanvas, type PortraitCanvasHandle } from "./PortraitCanvas";
import { SessionTimeline } from "./SessionTimeline";
import {
  generateDemoSignals,
  simulateContrastingSessions,
  simulateDemoSession,
} from "@/src/lib/demoProfiles";
import {
  accentHueForSeed,
  clearStoredSessions,
  loadStoredSessions,
  PortraitSessionEngine,
  saveSession,
} from "@/src/lib/session";
import { MediaSensorController } from "@/src/lib/media";
import { SoundscapeController } from "@/src/lib/soundscape";
import type {
  DemoChoice,
  DemoProfileName,
  EffectiveQuality,
  ExperienceStage,
  InputMode,
  NormalizedSignals,
  PromptDefinition,
  QualityTier,
  RawSignals,
  SensorStatus,
  SessionRecord,
} from "@/src/lib/types";
import { NEUTRAL_PARAMS, NEUTRAL_SIGNALS } from "@/src/lib/types";

const PROMPTS: PromptDefinition[] = [
  { label: "Presence", text: "Introduce yourself without saying your name.", duration: 27 },
  { label: "Memory", text: "Describe a place you can still picture clearly.", duration: 27 },
  { label: "Gesture", text: "Show the portrait something words cannot.", duration: 27 },
];

const INITIAL_STATUS: SensorStatus = {
  camera: "idle",
  microphone: "idle",
  pose: "idle",
};

const STAGE_LABELS: Record<ExperienceStage, string> = {
  attract: "Attract state",
  consent: "Permission choices",
  calibration: "Calibration",
  session: "Guided portrait session",
  forming: "Final formation",
  reveal: "Portrait reveal",
  compare: "Portrait comparison",
  resetting: "Resetting the portrait",
};

function newSeed() {
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor((Date.now() * 2654435761) % 4294967295);
}

function initialNormalized(): NormalizedSignals {
  return { ...NEUTRAL_SIGNALS };
}

function sessionDuration() {
  return PROMPTS.reduce((total, prompt) => total + prompt.duration, 0);
}

function secondsLabel(seconds: number) {
  const value = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

function statusHasError(status: SensorStatus) {
  return [status.camera, status.microphone, status.pose].some((value) => value === "denied" || value === "error");
}

function hasActionableSensorGuidance(status: SensorStatus) {
  return Boolean(status.message && /cannot see|very dark|more than one body|background sound/i.test(status.message));
}

function sensorNoticeHeading(status: SensorStatus) {
  if (status.camera === "denied") return "Camera access is unavailable.";
  if (/more than one body/i.test(status.message ?? "")) return "The portrait found more than one participant.";
  if (/very dark/i.test(status.message ?? "")) return "The portrait needs a little more light.";
  if (/background sound/i.test(status.message ?? "")) return "The room sound is strong.";
  if (/cannot see/i.test(status.message ?? "")) return "The portrait cannot see enough movement yet.";
  return "A sensor became unavailable.";
}

function qualityForDevice(): EffectiveQuality {
  if (typeof window === "undefined") return "balanced";
  const compact = window.matchMedia("(max-width: 700px)").matches;
  const cores = navigator.hardwareConcurrency || 4;
  if (compact || cores <= 4) return "low";
  if (cores >= 10) return "high";
  return "balanced";
}

export function Experience() {
  const [stage, setStage] = useState<ExperienceStage>("attract");
  const [seed, setSeed] = useState(0x50a77e);
  const [inputMode, setInputMode] = useState<InputMode>("demo");
  const [demoProfile, setDemoProfile] = useState<DemoProfileName>("measured");
  const [demoChooserOpen, setDemoChooserOpen] = useState(false);
  const [params, setParams] = useState({ ...NEUTRAL_PARAMS });
  const [signals, setSignals] = useState<NormalizedSignals>(initialNormalized);
  const [motifs, setMotifs] = useState<SessionRecord["motifs"]>([]);
  const [sensorStatus, setSensorStatus] = useState<SensorStatus>(INITIAL_STATUS);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [sessionElapsed, setSessionElapsed] = useState(0);
  const [currentSession, setCurrentSession] = useState<SessionRecord | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [quality, setQuality] = useState<QualityTier>("auto");
  const [autoQuality, setAutoQuality] = useState<EffectiveQuality>("balanced");
  const [fps, setFps] = useState(60);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [debug, setDebug] = useState(false);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [replayProgress, setReplayProgress] = useState(0);
  const [exportMessage, setExportMessage] = useState("");

  const canvasRef = useRef<PortraitCanvasHandle>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef(new PortraitSessionEngine(seed));
  const inputModeRef = useRef<InputMode>(inputMode);
  const profileRef = useRef<DemoProfileName>(demoProfile);
  const demoTimerRef = useRef<number | null>(null);
  const calibrationTimerRef = useRef<number | null>(null);
  const sessionTimerRef = useRef<number | null>(null);
  const formationTimerRef = useRef<number | null>(null);
  const replayTimerRef = useRef<number | null>(null);
  const demoStartedAtRef = useRef(0);
  const sessionStartedAtRef = useRef(0);
  const speedRef = useRef(1);
  const autoStartedRef = useRef(false);
  const previousStageRef = useRef<ExperienceStage>(stage);
  const mediaRef = useRef<MediaSensorController | null>(null);
  const soundscapeRef = useRef<SoundscapeController | null>(null);

  const accentHue = currentSession?.accentHue ?? accentHueForSeed(seed);
  const effectiveQuality = quality === "auto" ? autoQuality : quality;
  const totalDuration = sessionDuration();
  const promptIndex = Math.min(
    PROMPTS.length - 1,
    Math.floor(sessionElapsed / PROMPTS[0].duration),
  );
  const currentPrompt = PROMPTS[promptIndex];
  const sessionProgress = Math.min(1, sessionElapsed / totalDuration);
  const displayParams = replaying ? params : currentSession && stage === "reveal" ? currentSession.finalParams : params;
  const displayMotifs = currentSession && stage === "reveal" ? currentSession.motifs : motifs;

  const comparisonPair = useMemo<[SessionRecord, SessionRecord] | null>(
    () => (sessions.length >= 2 ? [sessions[1], sessions[0]] : null),
    [sessions],
  );

  const clearTimer = useCallback((timer: React.MutableRefObject<number | null>) => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
  }, []);

  const stopTimedWork = useCallback(() => {
    clearTimer(demoTimerRef);
    clearTimer(calibrationTimerRef);
    clearTimer(sessionTimerRef);
    clearTimer(formationTimerRef);
    clearTimer(replayTimerRef);
  }, [clearTimer]);

  const processSignals = useCallback((raw: RawSignals) => {
    const frame = engineRef.current.process(raw);
    setSignals(frame.normalized);
    setParams(frame.params);
    setMotifs(frame.motifs);
  }, []);

  const beginFormation = useCallback(
    (record: SessionRecord, revealStage: "reveal" | "compare" = "reveal") => {
      clearTimer(sessionTimerRef);
      clearTimer(demoTimerRef);
      void mediaRef.current?.stop();
      setCurrentSession(record);
      setParams(record.finalParams);
      setMotifs(record.motifs);
      setStage("forming");
      const saved = saveSession(record);
      setSessions(saved);
      formationTimerRef.current = window.setInterval(() => {
        clearTimer(formationTimerRef);
        setStage(revealStage);
      }, Math.max(900, 4800 / speedRef.current));
    },
    [clearTimer],
  );

  const finishPortrait = useCallback(() => {
    if (stage !== "session" && stage !== "calibration") return;
    const record = engineRef.current.finalize(
      inputModeRef.current,
      inputModeRef.current === "demo" ? profileRef.current : undefined,
    );
    beginFormation(record);
  }, [beginFormation, stage]);

  const enterGuidedSession = useCallback(() => {
    clearTimer(calibrationTimerRef);
    setCalibrationProgress(1);
    setStage("session");
    setSessionElapsed(0);
    sessionStartedAtRef.current = performance.now();
    sessionTimerRef.current = window.setInterval(() => {
      const elapsed = ((performance.now() - sessionStartedAtRef.current) / 1000) * speedRef.current;
      setSessionElapsed(elapsed);
      if (elapsed >= totalDuration) {
        clearTimer(sessionTimerRef);
        const record = engineRef.current.finalize(
          inputModeRef.current,
          inputModeRef.current === "demo" ? profileRef.current : undefined,
        );
        beginFormation(record);
      }
    }, 100);
  }, [beginFormation, clearTimer, totalDuration]);

  const startCalibration = useCallback(
    (mode: InputMode, profile: DemoProfileName, sessionSeed = newSeed()) => {
      stopTimedWork();
      setSeed(sessionSeed);
      setInputMode(mode);
      inputModeRef.current = mode;
      setDemoProfile(profile);
      profileRef.current = profile;
      setDemoChooserOpen(false);
      setNoticeDismissed(false);
      setCurrentSession(null);
      setCalibrationProgress(0);
      setSessionElapsed(0);
      setSignals(initialNormalized());
      setParams({ ...NEUTRAL_PARAMS });
      setMotifs([]);
      engineRef.current = new PortraitSessionEngine({ seed: sessionSeed, startedAt: Date.now() });
      setSensorStatus(
        mode === "demo"
          ? { camera: "unavailable", microphone: "unavailable", pose: "fallback", message: "Deterministic demo signals are active." }
          : {
              camera: "loading",
              microphone: mode === "full" ? "loading" : "unavailable",
              pose: "loading",
            },
      );
      setStage("calibration");

      if (mode === "demo") {
        void mediaRef.current?.stop();
        demoStartedAtRef.current = performance.now();
        demoTimerRef.current = window.setInterval(() => {
          const elapsed = (performance.now() - demoStartedAtRef.current) * speedRef.current;
          processSignals(generateDemoSignals(profile, elapsed, sessionSeed));
        }, 80);
      } else {
        const controller = mediaRef.current;
        if (controller) {
          controller.attachVideoElement(videoRef.current);
          void controller.start(mode).then((result) => {
            setSensorStatus(result.status);
            if (!result.hasLiveInput) setNoticeDismissed(false);
          });
        }
      }

      const calibrationStartedAt = performance.now();
      calibrationTimerRef.current = window.setInterval(() => {
        const progress = ((performance.now() - calibrationStartedAt) / 4200) * speedRef.current;
        setCalibrationProgress(Math.min(1, progress));
        if (progress >= 1) enterGuidedSession();
      }, 90);
    },
    [enterGuidedSession, processSignals, stopTimedWork],
  );

  const startContrast = useCallback(
    (sessionSeed = newSeed()) => {
      stopTimedWork();
      void mediaRef.current?.stop();
      setSeed(sessionSeed);
      setInputMode("demo");
      inputModeRef.current = "demo";
      setDemoChooserOpen(false);
      setSensorStatus({
        camera: "unavailable",
        microphone: "unavailable",
        pose: "fallback",
        message: "Two deterministic signal profiles are using the live portrait pipeline.",
      });
      const pair = simulateContrastingSessions(sessionSeed, 90_000, 220);
      const stored = [saveSession(pair[0]), saveSession(pair[1])];
      void stored;
      setSessions([pair[0], pair[1]]);
      setCurrentSession(pair[1]);
      setParams(pair[1].finalParams);
      setMotifs(pair[1].motifs);
      setStage("forming");
      formationTimerRef.current = window.setInterval(() => {
        clearTimer(formationTimerRef);
        setStage("compare");
      }, Math.max(900, 4800 / speedRef.current));
    },
    [clearTimer, stopTimedWork],
  );

  const chooseDemo = useCallback(
    (choice: DemoChoice) => {
      if (choice === "contrast") startContrast();
      else startCalibration("demo", choice);
    },
    [startCalibration, startContrast],
  );

  const resetVisualState = useCallback(
    (preserveSessions: boolean) => {
      stopTimedWork();
      void mediaRef.current?.stop();
      void soundscapeRef.current?.stop();
      setSoundOn(false);
      setStage("resetting");
      setReplaying(false);
      setReplayProgress(0);
      setExportMessage("");
      if (!preserveSessions) {
        clearStoredSessions();
        setSessions([]);
      }
      window.setTimeout(() => {
        const nextSeed = newSeed();
        setSeed(nextSeed);
        engineRef.current = new PortraitSessionEngine(nextSeed);
        setCurrentSession(null);
        setParams({ ...NEUTRAL_PARAMS });
        setSignals(initialNormalized());
        setMotifs([]);
        setSensorStatus(INITIAL_STATUS);
        setCalibrationProgress(0);
        setSessionElapsed(0);
        setStage(preserveSessions ? "consent" : "attract");
      }, reducedMotion ? 120 : 1050);
    },
    [reducedMotion, stopTimedWork],
  );

  const replaySession = useCallback(() => {
    if (!currentSession || currentSession.frames.length === 0 || replaying) return;
    clearTimer(replayTimerRef);
    setReplaying(true);
    setReplayProgress(0);
    const frames = currentSession.frames;
    const started = performance.now();
    const replayDuration = reducedMotion ? 16_000 : 11_000;
    replayTimerRef.current = window.setInterval(() => {
      const progress = Math.min(1, (performance.now() - started) / replayDuration);
      const index = Math.min(frames.length - 1, Math.floor(progress * frames.length));
      setParams(frames[index].params);
      setSignals(frames[index].signals);
      setReplayProgress(progress);
      if (progress >= 1) {
        clearTimer(replayTimerRef);
        setParams(currentSession.finalParams);
        setReplaying(false);
      }
    }, 60);
  }, [clearTimer, currentSession, reducedMotion, replaying]);

  const exportPortrait = useCallback(async () => {
    if (!currentSession) return;
    setExportMessage("Preparing image…");
    try {
      const blob = await canvasRef.current?.exportPng(currentSession.title);
      if (!blob) throw new Error("The portrait is not ready yet.");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${currentSession.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportMessage("Portrait exported as PNG.");
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : "Export is unavailable in this browser.");
    }
  }, [currentSession]);

  const toggleSound = useCallback(() => {
    const controller = soundscapeRef.current;
    if (!controller) return;
    if (soundOn) {
      controller.setMuted(true);
      setSoundOn(false);
      return;
    }
    controller.setMuted(false);
    void controller.start().then((started) => {
      if (!started) controller.setMuted(true);
      setSoundOn(started);
    });
  }, [soundOn]);

  const handleFrameRate = useCallback(
    (measuredFps: number) => {
      setFps(measuredFps);
      if (quality !== "auto") return;
      if (measuredFps < 34) setAutoQuality("low");
      else if (measuredFps < 49) setAutoQuality("balanced");
    },
    [quality],
  );

  const debugStageChange = useCallback(
    (next: ExperienceStage) => {
      stopTimedWork();
      if ((next === "reveal" || next === "forming") && !currentSession) {
        const record = simulateDemoSession(demoProfile, seed, 42_000, 180);
        setCurrentSession(record);
        setParams(record.finalParams);
        setMotifs(record.motifs);
      }
      if (next === "compare" && sessions.length < 2) {
        const pair = simulateContrastingSessions(seed, 42_000, 200);
        setSessions(pair);
      }
      setStage(next);
    },
    [currentSession, demoProfile, seed, sessions.length, stopTimedWork],
  );

  useEffect(() => {
    const media = new MediaSensorController({ sampleRateHz: 16, poseRateHz: 9 });
    const soundscape = new SoundscapeController({ muted: true, muteStorageKey: false, volume: 0.65 });
    mediaRef.current = media;
    soundscapeRef.current = soundscape;
    media.attachVideoElement(videoRef.current);
    const unsubscribeSignals = media.subscribeSignals(processSignals);
    const unsubscribeStatus = media.subscribeStatus(setSensorStatus);

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReducedMotion(motion.matches);
    motion.addEventListener("change", updateMotion);

    const query = new URLSearchParams(window.location.search);
    const debugEnabled = query.get("debug") === "1";
    const requestedSpeed = Number(query.get("speed"));
    if (debugEnabled && Number.isFinite(requestedSpeed)) {
      speedRef.current = Math.min(24, Math.max(1, requestedSpeed));
    }
    const requestedPreview = query.get("preview") as ExperienceStage | null;
    const requestedDemo = query.get("demo") as DemoChoice | null;
    const validStages: ExperienceStage[] = [
      "attract",
      "consent",
      "calibration",
      "session",
      "forming",
      "reveal",
      "compare",
      "resetting",
    ];
    const initializationTimer = window.setTimeout(() => {
      setSeed(newSeed());
      setAutoQuality(qualityForDevice());
      setSessions(loadStoredSessions().reverse());
      setReducedMotion(motion.matches);
      setDebug(debugEnabled);
      if (autoStartedRef.current) return;
      autoStartedRef.current = true;
      if (requestedPreview && validStages.includes(requestedPreview)) {
        if (requestedPreview === "reveal" || requestedPreview === "forming") {
          const record = simulateDemoSession("measured", 0x50a77e, 42_000, 180);
          setCurrentSession(record);
          setParams(record.finalParams);
          setMotifs(record.motifs);
          setSessions([record]);
        }
        if (requestedPreview === "compare") {
          const pair = simulateContrastingSessions(0x50a77e, 42_000, 200);
          setSessions(pair);
          setCurrentSession(pair[1]);
        }
        setStage(requestedPreview);
      } else if (requestedDemo === "contrast") startContrast(0x50a77e);
      else if (requestedDemo === "measured" || requestedDemo === "kinetic") {
        startCalibration("demo", requestedDemo, 0x50a77e);
      }
    }, 0);

    return () => {
      window.clearTimeout(initializationTimer);
      motion.removeEventListener("change", updateMotion);
      stopTimedWork();
      unsubscribeSignals();
      unsubscribeStatus();
      void media.stop();
      void soundscape.stop();
      mediaRef.current = null;
      soundscapeRef.current = null;
    };
  }, [processSignals, startCalibration, startContrast, stopTimedWork]);

  useEffect(() => {
    inputModeRef.current = inputMode;
    profileRef.current = demoProfile;
  }, [demoProfile, inputMode]);

  useEffect(() => {
    soundscapeRef.current?.update(displayParams);
  }, [displayParams]);

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", `hsl(${accentHue} 68% 68%)`);
  }, [accentHue]);

  useEffect(() => {
    if (previousStageRef.current === stage) return;
    previousStageRef.current = stage;
    const focusTimer = window.setTimeout(() => {
      document.querySelector<HTMLElement>("[data-stage-heading]")?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [stage]);

  const showNotice =
    (statusHasError(sensorStatus) || hasActionableSensorGuidance(sensorStatus)) &&
    !noticeDismissed &&
    (stage === "calibration" || stage === "session");

  return (
    <main
      className={`experience stage--${stage}`}
      style={{ "--session-accent": `hsl(${accentHue} 68% 68%)` } as React.CSSProperties}
    >
      {stage !== "compare" ? (
        <PortraitCanvas
          ref={canvasRef}
          className="portrait-canvas"
          stage={stage}
          params={displayParams}
          motifs={displayMotifs}
          seed={currentSession?.seed ?? seed}
          accentHue={accentHue}
          quality={effectiveQuality}
          reducedMotion={reducedMotion}
          onFrameRate={handleFrameRate}
        />
      ) : null}
      <video ref={videoRef} className="sr-only" muted playsInline aria-hidden="true" />

      <header className="edge-bar">
        <span className="edge-wordmark">Pattern of One</span>
        {stage === "session" ? (
          <button type="button" className="text-control" onClick={finishPortrait}>
            Finish portrait
          </button>
        ) : null}
        <button className="icon-control" type="button" aria-pressed={soundOn} onClick={toggleSound}>
          <span className="sound-glyph" aria-hidden="true"><i /><i /><i /></span>
          <span className="control-label">Sound {soundOn ? "on" : "off"}</span>
        </button>
        <button className="text-control" type="button" onClick={() => setInfoOpen(true)} aria-haspopup="dialog">
          <span className="control-label">About this work</span>
          <span className="info-glyph" aria-hidden="true">i</span>
        </button>
      </header>

      <p className="sr-only" aria-live="polite">{STAGE_LABELS[stage]}</p>

      {showNotice ? (
        <div className="error-notice" role="status">
          <strong>{sensorNoticeHeading(sensorStatus)}</strong>
          {sensorStatus.message ?? "The portrait can continue with the signals that remain, or switch to a deterministic demo."}
          <div className="error-actions">
            <button type="button" onClick={() => startCalibration("demo", "measured")}>Use demo mode</button>
            <button type="button" onClick={() => setNoticeDismissed(true)}>Continue</button>
          </div>
        </div>
      ) : null}

      <div className="stage-content">
        {stage === "attract" ? (
          <section className="poster-copy stage-enter" aria-labelledby="project-title">
            <h1 id="project-title" className="poster-title" data-stage-heading tabIndex={-1}>Pattern of One</h1>
            <p className="poster-statement">A portrait of how you move, speak, pause, and change.</p>
            <button className="primary-action" type="button" data-testid="begin-portrait" onClick={() => setStage("consent")}>
              Begin your portrait
            </button>
            <p className="privacy-line">Camera and microphone signals are processed for this session. No face recognition.</p>
          </section>
        ) : null}

        {stage === "consent" ? (
          <section className="consent-layout stage-enter" aria-labelledby="consent-title">
            <p className="eyebrow">Before the encounter</p>
            <h1 id="consent-title" data-stage-heading tabIndex={-1}>Your presence, not your likeness.</h1>
            <p className="consent-lede">
              Choose what the portrait may observe. Permission is requested only after you select an option, and denial never ends the experience.
            </p>
            <ul className="permission-list">
              <li><strong>Camera</strong><span>Movement landmarks and local motion features. No face recognition or raw video storage.</span></li>
              <li><strong>Microphone</strong><span>Volume, rhythm, variation, and silence. No raw audio storage.</span></li>
              <li><strong>Result</strong><span>An artistic interpretation—not a personality, emotion, or mental-health assessment.</span></li>
            </ul>
            <div className="consent-actions">
              <button className="primary-action" type="button" data-testid="enable-media" onClick={() => startCalibration("full", "measured")}>
                Enable camera and microphone
              </button>
              <button className="secondary-action" type="button" data-testid="movement-only" onClick={() => startCalibration("movement", "measured")}>
                Movement only
              </button>
              <button className="secondary-action" type="button" data-testid="use-demo" onClick={() => setDemoChooserOpen((open) => !open)} aria-expanded={demoChooserOpen}>
                Use demo mode
              </button>
            </div>
            {demoChooserOpen ? (
              <div className="demo-chooser" data-testid="demo-chooser">
                <button className="demo-choice" type="button" onClick={() => chooseDemo("measured")}>
                  <strong>Measured</strong><span>Low movement, longer pauses, gradual change.</span>
                </button>
                <button className="demo-choice" type="button" onClick={() => chooseDemo("kinetic")}>
                  <strong>Kinetic</strong><span>Frequent gestures, faster rhythm, high variation.</span>
                </button>
                <button className="demo-choice" type="button" onClick={() => chooseDemo("contrast")}>
                  <strong>Contrasting pair</strong><span>Two complete portraits, created through the same pipeline.</span>
                </button>
              </div>
            ) : null}
            <p className="privacy-line">Everything essential works without transcription, an account, or a backend.</p>
          </section>
        ) : null}

        {stage === "calibration" ? (
          <section className="calibration-copy stage-enter" aria-labelledby="calibration-title">
            <p className="eyebrow">Calibration · {Math.round(calibrationProgress * 100)}%</p>
            <h1 id="calibration-title" data-stage-heading tabIndex={-1}>Stay as you are. The portrait is finding its first rhythm.</h1>
            <div className="calibration-progress" role="progressbar" aria-label="Calibration progress" aria-valuenow={Math.round(calibrationProgress * 100)} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ transform: `scaleX(${calibrationProgress})` }} />
            </div>
            <div className="sensor-notes" aria-live="polite">
              <span data-ready={sensorStatus.camera === "ready" || inputMode === "demo"}>Movement {inputMode === "demo" ? "simulated" : sensorStatus.camera}</span>
              <span data-ready={sensorStatus.microphone === "ready" || inputMode !== "full"}>Sound {inputMode === "full" ? sensorStatus.microphone : inputMode === "demo" ? "simulated" : "not requested"}</span>
            </div>
          </section>
        ) : null}

        {stage === "session" ? (
          <section className="session-interface stage-enter" aria-labelledby="session-prompt">
            <div className="session-prompt" key={promptIndex}>
              <p className="eyebrow">0{promptIndex + 1} — {currentPrompt.label}</p>
              <h1 id="session-prompt" data-stage-heading tabIndex={-1}>{currentPrompt.text}</h1>
            </div>
            <div className="session-meta">
              <div className="session-progress" role="progressbar" aria-label="Portrait session progress" aria-valuenow={Math.round(sessionProgress * 100)} aria-valuemin={0} aria-valuemax={100}>
                <span style={{ transform: `scaleX(${sessionProgress})` }} />
              </div>
              <span className="session-time">{secondsLabel(totalDuration - sessionElapsed)}</span>
            </div>
            <div className="session-status" aria-live="polite">
              <span className="status-dot" />
              {inputMode === "demo" ? `${demoProfile} signal profile` : inputMode === "movement" ? "movement only" : "movement + sound"}
            </div>
          </section>
        ) : null}

        {stage === "forming" ? (
          <section className="forming-copy stage-enter" aria-labelledby="forming-title">
            <p className="eyebrow">Final formation</p>
            <h1 id="forming-title" data-stage-heading tabIndex={-1}>Earlier patterns are returning.</h1>
            <p>The portrait is reconciling gesture, rhythm, and silence into one living composition.</p>
            <p className="memory-count">{motifs.length} persistent {motifs.length === 1 ? "motif" : "motifs"}</p>
          </section>
        ) : null}

        {stage === "reveal" && currentSession ? (
          <section className="reveal-layout stage-enter" aria-labelledby="portrait-title">
            <div className="reveal-main">
              <p className="eyebrow">Your temporary portrait</p>
              <h1 id="portrait-title" className="reveal-title" data-stage-heading tabIndex={-1}>{currentSession.title}</h1>
              <p className="interpretation-label">An artistic interpretation · {Math.round(currentSession.duration / 1000)} seconds</p>
            </div>
            <div className="reveal-details">
              <ol className="observations">
                {currentSession.observations.slice(0, 3).map((observation) => (
                  <li key={observation.text}>{observation.text}</li>
                ))}
              </ol>
              <div className="replay-label">
                <span>{replaying ? "Replaying the session" : "Session memory"}</span>
                <span>{replaying ? `${Math.round(replayProgress * 100)}%` : `${currentSession.frames.length} traces`}</span>
              </div>
              <SessionTimeline frames={currentSession.frames} accentHue={currentSession.accentHue} progress={replaying ? replayProgress : undefined} />
              <div className="reveal-actions">
                <button className="secondary-action" type="button" onClick={replaySession} disabled={replaying}>Replay</button>
                <button className="secondary-action" type="button" data-testid="export-png" onClick={exportPortrait}>Export PNG</button>
                <button className="secondary-action" type="button" onClick={() => resetVisualState(true)}>Create another</button>
                {comparisonPair ? <button className="secondary-action" type="button" data-testid="compare" onClick={() => setStage("compare")}>Compare two</button> : null}
                <button className="secondary-action" type="button" data-testid="reset" onClick={() => resetVisualState(false)}>Clear session</button>
              </div>
              {exportMessage ? <p className="privacy-line" role="status">{exportMessage}</p> : null}
            </div>
          </section>
        ) : null}

        {stage === "resetting" ? (
          <section className="calibration-copy" aria-live="polite">
            <p className="eyebrow">Returning to the seed</p>
            <h1 data-stage-heading tabIndex={-1}>The encounter dissolves.</h1>
          </section>
        ) : null}
      </div>

      {stage === "compare" && comparisonPair ? (
        <ComparisonView
          sessions={comparisonPair}
          quality={effectiveQuality}
          reducedMotion={reducedMotion}
          onBack={() => setStage(currentSession ? "reveal" : "attract")}
          onReset={() => resetVisualState(false)}
        />
      ) : null}

      <InformationPanel
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        quality={quality}
        onQualityChange={setQuality}
        sensorStatus={sensorStatus}
      />

      {debug ? (
        <DebugPanel
          stage={stage}
          fps={fps}
          status={sensorStatus}
          signals={signals}
          params={params}
          onStageChange={debugStageChange}
          onProfileChange={(profile) => startCalibration("demo", profile, seed)}
        />
      ) : null}
    </main>
  );
}
