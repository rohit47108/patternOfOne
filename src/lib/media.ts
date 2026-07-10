import type { PoseLandmarker } from "@mediapipe/tasks-vision";

import { NEUTRAL_SIGNALS } from "./types";
import type { InputMode, RawSignals, SensorStatus } from "./types";

const DEFAULT_POSE_WASM_ROOT =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const DEFAULT_POSE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

const MOTION_WIDTH = 32;
const MOTION_HEIGHT = 24;
const POSE_FRESHNESS_MS = 1_200;

type DeviceState = "denied" | "unavailable" | "error";
type SignalListener = (signals: Readonly<RawSignals>) => void;
type StatusListener = (status: Readonly<SensorStatus>) => void;

interface PosePoint {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

interface PoseFeatures {
  movement: number;
  leftWrist: number;
  rightWrist: number;
  reach: number;
  headShift: number;
  shoulderTilt: number;
  symmetry: number;
  proximity: number;
  sudden: number;
}

interface AudioFeatures {
  loudness: number;
  speech: number;
  silence: number;
  vocalVariation: number;
  rhythm: number;
  sudden: number;
}

export interface MediaSensorOptions {
  /** Overall feature delivery rate. Kept independent from the render loop. */
  sampleRateHz?: number;
  /** Pose inference rate. Pixel motion continues between pose samples. */
  poseRateHz?: number;
  enablePose?: boolean;
  poseWasmRoot?: string;
  poseModelAssetPath?: string;
  videoElement?: HTMLVideoElement | null;
  onSignals?: SignalListener;
  onStatus?: StatusListener;
}

export interface MediaSensorStartResult {
  mode: InputMode;
  cameraReady: boolean;
  microphoneReady: boolean;
  poseReady: boolean;
  hasLiveInput: boolean;
  status: SensorStatus;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clamp01(value: number): number {
  return clamp(Number.isFinite(value) ? value : 0, 0, 1);
}

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function distance(a: PosePoint, b: PosePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isVisible(point: PosePoint | undefined): point is PosePoint {
  return Boolean(point && (point.visibility ?? 1) >= 0.35);
}

function idleStatus(message?: string): SensorStatus {
  return {
    camera: "idle",
    microphone: "idle",
    pose: "idle",
    message,
  };
}

function freshNeutralSignals(): RawSignals {
  return { ...NEUTRAL_SIGNALS, timestamp: Date.now() };
}

/** Maps browser media exceptions to calm, actionable UI states. */
export function classifyMediaError(error: unknown): DeviceState {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name?: unknown }).name)
      : "";

  if (
    name === "NotAllowedError" ||
    name === "PermissionDeniedError" ||
    name === "SecurityError"
  ) {
    return "denied";
  }

  if (
    name === "NotFoundError" ||
    name === "DevicesNotFoundError" ||
    name === "OverconstrainedError"
  ) {
    return "unavailable";
  }

  return "error";
}

function getAudioContextConstructor(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  return (
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  );
}

/**
 * Owns a session's browser media resources. Construction is inert: permission
 * prompts and media capture can only begin through `start`, which should be
 * called directly from the participant's consent action.
 */
export class MediaSensorController {
  private readonly sampleIntervalMs: number;
  private readonly poseIntervalMs: number;
  private readonly enablePose: boolean;
  private readonly poseWasmRoot: string;
  private readonly poseModelAssetPath: string;
  private readonly signalListeners = new Set<SignalListener>();
  private readonly statusListeners = new Set<StatusListener>();

  private currentMode: InputMode = "movement";
  private currentStatus: SensorStatus = idleStatus();
  private latestSignals: RawSignals = freshNeutralSignals();
  private active = false;
  private generation = 0;
  private frameRequest: number | null = null;
  private lastSampleAt = 0;
  private lastPoseInferenceAt = 0;
  private lastPoseSeenAt = 0;
  private poseMissingSince: number | null = null;

  private cameraStream: MediaStream | null = null;
  private microphoneStream: MediaStream | null = null;
  private video: HTMLVideoElement | null;
  private ownsVideoElement = false;
  private motionCanvas: HTMLCanvasElement | null = null;
  private motionContext: CanvasRenderingContext2D | null = null;
  private previousLuminance: Uint8Array | null = null;

  private poseLandmarker: PoseLandmarker | null = null;
  private previousPose: PosePoint[] | null = null;
  private poseFeatures: PoseFeatures | null = null;
  private motionMean = NEUTRAL_SIGNALS.movement;
  private stillnessStartedAt: number | null = null;
  private lowLightSince: number | null = null;
  private lowLightWarning = false;
  private multiplePeopleWarning = false;

  private audioContext: AudioContext | null = null;
  private audioSource: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private audioSamples: Float32Array<ArrayBuffer> | null = null;
  private noiseFloor = 0.006;
  private audioStartedAt = 0;
  private noiseWarning = false;
  private previousLoudness = 0;
  private silenceStartedAt: number | null = null;
  private lastOnsetAt = -Infinity;
  private onsetTimes: number[] = [];

  constructor(options: MediaSensorOptions = {}) {
    this.sampleIntervalMs =
      1_000 / clamp(options.sampleRateHz ?? 20, 5, 60);
    this.poseIntervalMs = 1_000 / clamp(options.poseRateHz ?? 10, 1, 30);
    this.enablePose = options.enablePose ?? true;
    this.poseWasmRoot = options.poseWasmRoot ?? DEFAULT_POSE_WASM_ROOT;
    this.poseModelAssetPath =
      options.poseModelAssetPath ?? DEFAULT_POSE_MODEL;
    this.video = options.videoElement ?? null;

    if (options.onSignals) this.signalListeners.add(options.onSignals);
    if (options.onStatus) this.statusListeners.add(options.onStatus);
  }

  get isActive(): boolean {
    return this.active;
  }

  get status(): SensorStatus {
    return { ...this.currentStatus };
  }

  get signals(): RawSignals {
    return { ...this.latestSignals };
  }

  get videoElement(): HTMLVideoElement | null {
    return this.video;
  }

  subscribeSignals(listener: SignalListener): () => void {
    this.signalListeners.add(listener);
    listener(this.signals);
    return () => this.signalListeners.delete(listener);
  }

  subscribeStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  /** Attach a UI-owned video element before or after starting capture. */
  attachVideoElement(element: HTMLVideoElement | null): void {
    if (this.video && this.video !== element && this.ownsVideoElement) {
      this.video.pause();
      this.video.srcObject = null;
    }

    this.video = element;
    this.ownsVideoElement = false;
    if (element && this.cameraStream) this.connectVideo(element);
  }

  async start(mode: InputMode = "full"): Promise<MediaSensorStartResult> {
    await this.stop();
    const token = ++this.generation;
    this.currentMode = mode;
    this.latestSignals = freshNeutralSignals();

    if (mode === "demo") {
      this.updateStatus(
        idleStatus("Demo input is active. No camera or microphone was requested."),
      );
      this.emitSignals();
      return this.startResult(mode);
    }

    this.active = true;
    this.updateStatus({
      camera: "loading",
      microphone: mode === "full" ? "loading" : "idle",
      pose: "loading",
    });

    if (
      typeof window === "undefined" ||
      typeof document === "undefined" ||
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      this.active = false;
      this.updateStatus({
        camera: "unavailable",
        microphone: mode === "full" ? "unavailable" : "idle",
        pose: "fallback",
      });
      this.emitSignals();
      return this.startResult(mode);
    }

    // Creating the context before awaiting permissions preserves the consent
    // click's user activation. Movement-only mode never reaches this branch.
    if (mode === "full") this.prepareAudioContext();

    const requests: Promise<void>[] = [this.openCamera(token)];
    if (mode === "full") requests.push(this.openMicrophone(token));
    await Promise.all(requests);

    if (token !== this.generation || !this.active) {
      return this.startResult(mode);
    }

    if (this.currentStatus.camera === "ready") {
      if (this.enablePose) {
        void this.loadPose(token);
      } else {
        this.updateStatus({ pose: "fallback" });
      }
    } else {
      this.updateStatus({ pose: "fallback" });
    }

    if (
      this.currentStatus.camera === "ready" ||
      this.currentStatus.microphone === "ready"
    ) {
      document.addEventListener("visibilitychange", this.handleVisibility);
      if (!document.hidden) this.scheduleFrame();
    } else {
      this.active = false;
      this.emitSignals();
    }

    return this.startResult(mode);
  }

  /** Retry a suspended microphone analyser from a later user gesture. */
  async resumeAudio(): Promise<boolean> {
    if (!this.audioContext) return false;
    try {
      await this.audioContext.resume();
      return this.audioContext.state === "running";
    } catch {
      return false;
    }
  }

  async stop(): Promise<void> {
    this.active = false;
    this.generation += 1;
    if (this.frameRequest !== null && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(this.frameRequest);
    }
    this.frameRequest = null;

    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.handleVisibility);
    }

    this.poseLandmarker?.close();
    this.poseLandmarker = null;
    this.previousPose = null;
    this.poseFeatures = null;
    this.poseMissingSince = null;

    this.stopStream(this.cameraStream);
    this.stopStream(this.microphoneStream);
    this.cameraStream = null;
    this.microphoneStream = null;

    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
      if (this.ownsVideoElement) this.video = null;
    }
    this.ownsVideoElement = false;

    this.audioSource?.disconnect();
    this.analyser?.disconnect();
    this.audioSource = null;
    this.analyser = null;
    this.audioSamples = null;
    this.audioStartedAt = 0;
    this.noiseWarning = false;
    const context = this.audioContext;
    this.audioContext = null;
    if (context && context.state !== "closed") {
      try {
        await context.close();
      } catch {
        // A context may already be closing after a device-level failure.
      }
    }

    this.motionCanvas = null;
    this.motionContext = null;
    this.previousLuminance = null;
    this.lowLightSince = null;
    this.lowLightWarning = false;
    this.multiplePeopleWarning = false;
    this.onsetTimes = [];
    this.updateStatus(idleStatus("Sensors stopped. Camera and microphone released."));
  }

  private readonly handleVisibility = (): void => {
    if (!this.active || typeof document === "undefined") return;
    if (document.hidden) {
      if (this.frameRequest !== null) cancelAnimationFrame(this.frameRequest);
      this.frameRequest = null;
      return;
    }
    this.lastSampleAt = 0;
    this.scheduleFrame();
  };

  private scheduleFrame(): void {
    if (!this.active || this.frameRequest !== null) return;
    this.frameRequest = requestAnimationFrame(this.handleFrame);
  }

  private readonly handleFrame = (frameTime: number): void => {
    this.frameRequest = null;
    if (!this.active) return;

    if (frameTime - this.lastSampleAt >= this.sampleIntervalMs) {
      this.sample(frameTime);
      this.lastSampleAt = frameTime;
    }
    this.scheduleFrame();
  };

  private sample(frameTime: number): void {
    const now = Date.now();
    const pixelMotion = this.readPixelMotion();

    if (
      this.poseLandmarker &&
      this.video &&
      this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      frameTime - this.lastPoseInferenceAt >= this.poseIntervalMs
    ) {
      this.lastPoseInferenceAt = frameTime;
      this.readPose(frameTime);
    }

    const audio = this.readAudio(now);
    const poseFresh =
      this.poseFeatures !== null && now - this.lastPoseSeenAt <= POSE_FRESHNESS_MS;
    const pose = poseFresh ? this.poseFeatures : null;
    const movement = clamp01(
      pose
        ? Math.max(pose.movement, pixelMotion * 0.72)
        : pixelMotion,
    );

    if (movement < 0.045) {
      this.stillnessStartedAt ??= now;
    } else {
      this.stillnessStartedAt = null;
    }
    const stillness = this.stillnessStartedAt
      ? clamp01((now - this.stillnessStartedAt) / 4_000)
      : 0;

    const target: RawSignals = {
      timestamp: now,
      movement,
      leftWrist: pose?.leftWrist ?? clamp01(movement * 0.7),
      rightWrist: pose?.rightWrist ?? clamp01(movement * 0.7),
      reach: pose?.reach ?? clamp01(0.18 + movement * 0.42),
      headShift: pose?.headShift ?? clamp01(movement * 0.45),
      shoulderTilt:
        pose?.shoulderTilt ?? mix(this.latestSignals.shoulderTilt, 0.05, 0.08),
      symmetry:
        pose?.symmetry ?? mix(this.latestSignals.symmetry, 0.62, 0.035),
      proximity:
        pose?.proximity ?? mix(this.latestSignals.proximity, 0.42, 0.025),
      stillness,
      loudness: audio.loudness,
      speech: audio.speech,
      silence: audio.silence,
      vocalVariation: audio.vocalVariation,
      rhythm: audio.rhythm,
      sudden: Math.max(pose?.sudden ?? 0, audio.sudden, pixelMotion * 0.55),
    };

    this.latestSignals = this.smoothSignals(target);
    this.emitSignals();
  }

  private smoothSignals(target: RawSignals): RawSignals {
    const previous = this.latestSignals;
    return {
      timestamp: target.timestamp,
      movement: mix(previous.movement, target.movement, 0.3),
      leftWrist: mix(previous.leftWrist, target.leftWrist, 0.28),
      rightWrist: mix(previous.rightWrist, target.rightWrist, 0.28),
      reach: mix(previous.reach, target.reach, 0.18),
      headShift: mix(previous.headShift, target.headShift, 0.28),
      shoulderTilt: mix(previous.shoulderTilt, target.shoulderTilt, 0.14),
      symmetry: mix(previous.symmetry, target.symmetry, 0.12),
      proximity: mix(previous.proximity, target.proximity, 0.1),
      stillness: mix(previous.stillness, target.stillness, 0.16),
      loudness: mix(previous.loudness, target.loudness, 0.26),
      speech: mix(previous.speech, target.speech, 0.22),
      silence: mix(previous.silence, target.silence, 0.12),
      vocalVariation: mix(
        previous.vocalVariation,
        target.vocalVariation,
        0.2,
      ),
      rhythm: mix(previous.rhythm, target.rhythm, 0.14),
      sudden: mix(previous.sudden, target.sudden, 0.32),
    };
  }

  private async openCamera(token: number): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 960 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });
      if (token !== this.generation || !this.active) {
        this.stopStream(stream);
        return;
      }

      this.cameraStream = stream;
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (!this.active || this.cameraStream !== stream) return;
        this.cameraStream = null;
        this.poseLandmarker?.close();
        this.poseLandmarker = null;
        this.previousLuminance = null;
        this.updateStatus({ camera: "unavailable", pose: "fallback" });
      });
      const video = this.ensureVideoElement();
      this.connectVideo(video);
      this.updateStatus({ camera: "ready" });
    } catch (error) {
      if (token !== this.generation) return;
      this.updateStatus({ camera: classifyMediaError(error) });
    }
  }

  private async openMicrophone(token: number): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          autoGainControl: false,
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      });
      if (token !== this.generation || !this.active) {
        this.stopStream(stream);
        return;
      }

      if (!this.audioContext) {
        this.stopStream(stream);
        this.updateStatus({ microphone: "unavailable" });
        return;
      }

      this.microphoneStream = stream;
      stream.getAudioTracks()[0]?.addEventListener("ended", () => {
        if (!this.active || this.microphoneStream !== stream) return;
        this.microphoneStream = null;
        this.audioSource?.disconnect();
        this.analyser?.disconnect();
        this.audioSource = null;
        this.analyser = null;
        this.audioSamples = null;
        this.updateStatus({ microphone: "unavailable" });
        void this.releaseUnusedAudioContext();
      });
      this.audioSource = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 1_024;
      this.analyser.smoothingTimeConstant = 0.55;
      this.audioSamples = new Float32Array(
        new ArrayBuffer(this.analyser.fftSize * Float32Array.BYTES_PER_ELEMENT),
      );
      this.audioSource.connect(this.analyser);
      this.audioStartedAt = Date.now();
      try {
        await this.audioContext.resume();
      } catch {
        // A later explicit gesture can retry through resumeAudio().
      }
      this.updateStatus({ microphone: "ready" });
    } catch (error) {
      if (token !== this.generation) return;
      this.updateStatus({ microphone: classifyMediaError(error) });
      await this.releaseUnusedAudioContext();
    }
  }

  private prepareAudioContext(): void {
    const AudioContextConstructor = getAudioContextConstructor();
    if (!AudioContextConstructor) return;
    try {
      this.audioContext = new AudioContextConstructor({
        latencyHint: "interactive",
      });
    } catch {
      this.audioContext = null;
    }
  }

  private async releaseUnusedAudioContext(): Promise<void> {
    const context = this.audioContext;
    this.audioContext = null;
    if (!context || context.state === "closed") return;
    try {
      await context.close();
    } catch {
      // Device teardown is best effort; tracks are still stopped separately.
    }
  }

  private ensureVideoElement(): HTMLVideoElement {
    if (this.video) return this.video;
    this.video = document.createElement("video");
    this.ownsVideoElement = true;
    return this.video;
  }

  private connectVideo(video: HTMLVideoElement): void {
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = this.cameraStream;
    void video.play().catch(() => {
      // The analyser retries as soon as the UI-owned video begins playback.
    });
  }

  private readPixelMotion(): number {
    const video = this.video;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return 0;

    if (!this.motionCanvas) {
      this.motionCanvas = document.createElement("canvas");
      this.motionCanvas.width = MOTION_WIDTH;
      this.motionCanvas.height = MOTION_HEIGHT;
      this.motionContext = this.motionCanvas.getContext("2d", {
        alpha: false,
        willReadFrequently: true,
      });
    }
    if (!this.motionContext) return 0;

    try {
      this.motionContext.drawImage(video, 0, 0, MOTION_WIDTH, MOTION_HEIGHT);
      const pixels = this.motionContext.getImageData(
        0,
        0,
        MOTION_WIDTH,
        MOTION_HEIGHT,
      ).data;
      const luminance = new Uint8Array(MOTION_WIDTH * MOTION_HEIGHT);
      let difference = 0;
      let luminanceTotal = 0;
      for (let index = 0; index < luminance.length; index += 1) {
        const offset = index * 4;
        const value =
          pixels[offset] * 0.2126 +
          pixels[offset + 1] * 0.7152 +
          pixels[offset + 2] * 0.0722;
        luminance[index] = value;
        luminanceTotal += value;
        if (this.previousLuminance) {
          difference += Math.abs(value - this.previousLuminance[index]);
        }
      }

      const hasPrevious = this.previousLuminance !== null;
      const averageLuminance = luminanceTotal / luminance.length;
      const now = Date.now();
      if (averageLuminance < 22) {
        this.lowLightSince ??= now;
        if (!this.lowLightWarning && now - this.lowLightSince > 2_200) {
          this.lowLightWarning = true;
          this.updateStatus({
            message: "The image is very dark. Add a little light, step closer, or continue with sound.",
          });
        }
      } else {
        this.lowLightSince = null;
        if (this.lowLightWarning) {
          this.lowLightWarning = false;
          this.updateStatus({ message: undefined });
        }
      }
      // Only this heavily downsampled derived luminance grid survives a frame.
      this.previousLuminance = luminance;
      if (!hasPrevious) return 0;
      return clamp01((difference / luminance.length / 255) * 5.2);
    } catch {
      return 0;
    }
  }

  private async loadPose(token: number): Promise<void> {
    try {
      const { FilesetResolver, PoseLandmarker } = await import(
        "@mediapipe/tasks-vision"
      );
      const fileset = await FilesetResolver.forVisionTasks(this.poseWasmRoot);
      const landmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: this.poseModelAssetPath },
        runningMode: "VIDEO",
        numPoses: 2,
        minPoseDetectionConfidence: 0.45,
        minPosePresenceConfidence: 0.45,
        minTrackingConfidence: 0.45,
      });

      if (token !== this.generation || !this.active) {
        landmarker.close();
        return;
      }
      this.poseLandmarker = landmarker;
      this.poseMissingSince = Date.now();
      this.updateStatus({ pose: "ready" });
    } catch {
      if (token === this.generation && this.active) {
        this.updateStatus({ pose: "fallback" });
      }
    }
  }

  private readPose(frameTime: number): void {
    if (!this.poseLandmarker || !this.video) return;
    try {
      const result = this.poseLandmarker.detectForVideo(this.video, frameTime);
      if (result.landmarks.length > 1) {
        if (!this.multiplePeopleWarning) {
          this.multiplePeopleWarning = true;
          this.updateStatus({
            pose: "ready",
            message: "More than one body is visible. The portrait will follow the first person it found.",
          });
        }
      } else if (this.multiplePeopleWarning) {
        this.multiplePeopleWarning = false;
        this.updateStatus({ message: undefined });
      }
      const landmarks = result.landmarks[0] as PosePoint[] | undefined;
      if (!landmarks) {
        this.markPoseMissing();
        return;
      }
      const features = this.derivePoseFeatures(landmarks);
      if (!features) {
        this.markPoseMissing();
        return;
      }
      this.poseFeatures = features;
      this.lastPoseSeenAt = Date.now();
      if (this.poseMissingSince !== null) {
        this.poseMissingSince = null;
        this.updateStatus({ pose: "ready" });
      }
    } catch {
      this.poseLandmarker?.close();
      this.poseLandmarker = null;
      this.updateStatus({ pose: "fallback" });
    }
  }

  private markPoseMissing(): void {
    const now = Date.now();
    this.poseMissingSince ??= now;
    if (now - this.poseMissingSince < 2_200) return;
    this.updateStatus({
      pose: "ready",
      message:
        "The camera is ready but cannot see enough movement yet. Step back slightly or continue with sound.",
    });
  }

  private derivePoseFeatures(landmarks: PosePoint[]): PoseFeatures | null {
    const nose = landmarks[0];
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    const leftWrist = landmarks[15];
    const rightWrist = landmarks[16];
    const leftHip = landmarks[23];
    const rightHip = landmarks[24];

    if (
      !isVisible(nose) ||
      !isVisible(leftShoulder) ||
      !isVisible(rightShoulder) ||
      !isVisible(leftWrist) ||
      !isVisible(rightWrist)
    ) {
      return null;
    }

    const selected = [
      nose,
      leftShoulder,
      rightShoulder,
      leftWrist,
      rightWrist,
      ...(isVisible(leftHip) && isVisible(rightHip)
        ? [leftHip, rightHip]
        : []),
    ];
    const previous = this.previousPose;
    this.previousPose = selected.map((point) => ({ x: point.x, y: point.y }));

    let movement = 0;
    if (previous?.length === selected.length) {
      for (let index = 0; index < selected.length; index += 1) {
        movement += distance(selected[index], previous[index]);
      }
      movement = clamp01((movement / selected.length) * 7.5);
    }

    const previousLeftWrist = previous?.[3];
    const previousRightWrist = previous?.[4];
    const leftWristMotion = previousLeftWrist
      ? clamp01(distance(leftWrist, previousLeftWrist) * 9)
      : 0;
    const rightWristMotion = previousRightWrist
      ? clamp01(distance(rightWrist, previousRightWrist) * 9)
      : 0;
    const shoulderWidth = Math.max(
      0.04,
      distance(leftShoulder, rightShoulder),
    );
    const wristSpread = distance(leftWrist, rightWrist) / shoulderWidth;
    const reach = clamp01((wristSpread - 0.45) / 2.4);
    const leftExtension = distance(leftWrist, leftShoulder) / shoulderWidth;
    const rightExtension = distance(rightWrist, rightShoulder) / shoulderWidth;
    const symmetry = clamp01(
      1 - Math.abs(leftExtension - rightExtension) / Math.max(1, leftExtension + rightExtension),
    );
    const shoulderTilt = clamp01(
      (Math.abs(leftShoulder.y - rightShoulder.y) / shoulderWidth) * 1.8,
    );
    const previousNose = previous?.[0];
    const headShift = previousNose
      ? clamp01(distance(nose, previousNose) * 8)
      : 0;
    const proximity = clamp01((shoulderWidth - 0.09) / 0.33);

    const previousMean = this.motionMean;
    this.motionMean = mix(this.motionMean, movement, 0.045);
    const sudden = clamp01((movement - previousMean - 0.035) * 4.5);

    return {
      movement,
      leftWrist: leftWristMotion,
      rightWrist: rightWristMotion,
      reach,
      headShift,
      shoulderTilt,
      symmetry,
      proximity,
      sudden,
    };
  }

  private readAudio(now: number): AudioFeatures {
    if (!this.analyser || !this.audioSamples) {
      return {
        loudness: 0,
        speech: 0,
        silence: 1,
        vocalVariation: 0,
        rhythm: 0,
        sudden: 0,
      };
    }

    this.analyser.getFloatTimeDomainData(this.audioSamples);
    let energy = 0;
    for (let index = 0; index < this.audioSamples.length; index += 1) {
      const sample = this.audioSamples[index];
      energy += sample * sample;
    }
    const rms = Math.sqrt(energy / this.audioSamples.length);
    if (this.audioStartedAt > 0 && now - this.audioStartedAt < 2_500) {
      this.noiseFloor = mix(this.noiseFloor, rms, 0.08);
    } else if (!this.noiseWarning && this.noiseFloor > 0.035) {
      this.noiseWarning = true;
      this.updateStatus({
        message: "Background sound is strong. Move away from the noise if you can, or continue with movement.",
      });
    }
    if (rms < this.noiseFloor * 1.8) {
      this.noiseFloor = mix(this.noiseFloor, rms, 0.025);
    }

    const loudness = clamp01((rms - this.noiseFloor * 0.82) * 20);
    const envelopeDelta = Math.abs(loudness - this.previousLoudness);
    const speaking = loudness > 0.075;
    if (speaking) {
      this.silenceStartedAt = null;
    } else {
      this.silenceStartedAt ??= now;
    }
    const silence = this.silenceStartedAt
      ? clamp01((now - this.silenceStartedAt) / 4_000)
      : 0;

    let onsetStrength = 0;
    if (
      loudness > 0.12 &&
      loudness - this.previousLoudness > 0.045 &&
      now - this.lastOnsetAt > 170
    ) {
      this.lastOnsetAt = now;
      this.onsetTimes.push(now);
      onsetStrength = clamp01((loudness - this.previousLoudness) * 4);
    }
    this.onsetTimes = this.onsetTimes.filter((time) => now - time <= 4_000);
    const rhythm = clamp01(this.onsetTimes.length / 9);
    this.previousLoudness = loudness;

    return {
      loudness,
      speech: speaking ? clamp01(0.3 + loudness * 0.9) : 0,
      silence,
      vocalVariation: clamp01(envelopeDelta * 3.2),
      rhythm,
      sudden: onsetStrength,
    };
  }

  private stopStream(stream: MediaStream | null): void {
    stream?.getTracks().forEach((track) => track.stop());
  }

  private startResult(mode: InputMode): MediaSensorStartResult {
    const cameraReady = this.currentStatus.camera === "ready";
    const microphoneReady = this.currentStatus.microphone === "ready";
    return {
      mode,
      cameraReady,
      microphoneReady,
      poseReady: this.currentStatus.pose === "ready",
      hasLiveInput: cameraReady || microphoneReady,
      status: this.status,
    };
  }

  private updateStatus(next: SensorStatus | Partial<SensorStatus>): void {
    const merged = { ...this.currentStatus, ...next };
    merged.message = next.message ?? this.statusMessage(merged);
    const changed =
      merged.camera !== this.currentStatus.camera ||
      merged.microphone !== this.currentStatus.microphone ||
      merged.pose !== this.currentStatus.pose ||
      merged.message !== this.currentStatus.message;
    this.currentStatus = merged;
    if (!changed) return;
    const snapshot = this.status;
    for (const listener of this.statusListeners) listener(snapshot);
  }

  private statusMessage(status: SensorStatus): string {
    if (status.camera === "denied" && status.microphone === "denied") {
      return "Camera and microphone permission were declined. Demo mode remains available.";
    }
    if (status.camera === "denied") {
      return "Camera permission was declined. The portrait can continue from sound or demo input.";
    }
    if (status.microphone === "denied") {
      return "Microphone permission was declined. Movement remains available.";
    }
    if (status.camera === "unavailable") {
      return "No camera is available. Continue with sound or use demo mode.";
    }
    if (status.microphone === "unavailable" && status.camera === "ready") {
      return "No microphone is available. The portrait will grow from movement.";
    }
    if (status.camera === "error" || status.microphone === "error") {
      return "A sensor could not start. Available inputs can still continue the portrait.";
    }
    if (status.pose === "fallback" && status.camera === "ready") {
      return "Camera ready with local pixel-motion fallback. No images leave this device.";
    }
    if (status.camera === "loading" || status.microphone === "loading") {
      return "Waiting for permission. Media is processed only for this session.";
    }
    if (status.camera === "ready" || status.microphone === "ready") {
      return "Sensors ready. Raw camera and microphone media is never stored or uploaded.";
    }
    return "Sensors are idle.";
  }

  private emitSignals(): void {
    const snapshot = this.signals;
    for (const listener of this.signalListeners) listener(snapshot);
  }
}

export function createMediaSensorController(
  options?: MediaSensorOptions,
): MediaSensorController {
  return new MediaSensorController(options);
}
