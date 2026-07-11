import { NEUTRAL_PARAMS } from "./types";
import type { ArtisticParameters } from "./types";

export type SoundscapeState =
  | "idle"
  | "starting"
  | "ready"
  | "suspended"
  | "unavailable"
  | "error";

export interface SoundscapeStatus {
  state: SoundscapeState;
  muted: boolean;
  volume: number;
  message?: string;
}

export interface SoundscapeOptions {
  muted?: boolean;
  volume?: number;
  /** Mute preference is kept only in localStorage, never sent anywhere. */
  muteStorageKey?: string | false;
  /** Volume is a local browser preference and is never sent anywhere. */
  volumeStorageKey?: string | false;
  onStatus?: (status: Readonly<SoundscapeStatus>) => void;
}

type StatusListener = (status: Readonly<SoundscapeStatus>) => void;

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : 0));
}

function safeParameters(parameters: ArtisticParameters): ArtisticParameters {
  return {
    energy: clamp(parameters.energy),
    expansion: clamp(parameters.expansion),
    rhythm: clamp(parameters.rhythm),
    continuity: clamp(parameters.continuity),
    symmetry: clamp(parameters.symmetry),
    volatility: clamp(parameters.volatility),
    density: clamp(parameters.density),
    memory: clamp(parameters.memory),
    silence: clamp(parameters.silence),
    illumination: clamp(parameters.illumination),
  };
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
 * A quiet generative Web Audio layer. The constructor is deliberately inert;
 * call `start()` from a click/tap/key action. Parameter changes are smoothed on
 * AudioParams and never create a source per render frame.
 */
export class SoundscapeController {
  private readonly muteStorageKey: string | false;
  private readonly volumeStorageKey: string | false;
  private readonly statusListeners = new Set<StatusListener>();
  private currentStatus: SoundscapeStatus;
  private parameters: ArtisticParameters = { ...NEUTRAL_PARAMS };
  private volume: number;
  private hidden = false;

  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private colourFilter: BiquadFilterNode | null = null;
  private toneAGain: GainNode | null = null;
  private toneBGain: GainNode | null = null;
  private memoryGain: GainNode | null = null;
  private textureGain: GainNode | null = null;
  private pulseGain: GainNode | null = null;
  private toneA: OscillatorNode | null = null;
  private toneB: OscillatorNode | null = null;
  private memoryTone: OscillatorNode | null = null;
  private pulseTone: OscillatorNode | null = null;
  private texture: AudioBufferSourceNode | null = null;
  private scheduler: number | null = null;
  private nextPulseAt = 0;
  private startPromise: Promise<boolean> | null = null;

  constructor(options: SoundscapeOptions = {}) {
    this.muteStorageKey =
      options.muteStorageKey === undefined
        ? "pattern-of-one:sound-muted"
        : options.muteStorageKey;
    this.volumeStorageKey =
      options.volumeStorageKey === undefined
        ? "pattern-of-one:sound-volume"
        : options.volumeStorageKey;
    this.volume = this.readStoredVolume() ?? clamp(options.volume ?? 0.58);
    const storedMute = this.readStoredMute();
    this.currentStatus = {
      state: "idle",
      muted: storedMute ?? options.muted ?? false,
      volume: this.volume,
      message: "Sound waits for a participant gesture.",
    };
    if (options.onStatus) this.statusListeners.add(options.onStatus);
  }

  get isStarted(): boolean {
    return this.context !== null;
  }

  get isMuted(): boolean {
    return this.currentStatus.muted;
  }

  get status(): SoundscapeStatus {
    return { ...this.currentStatus };
  }

  subscribe(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  /** Must be invoked from a user gesture; no AudioContext exists beforehand. */
  async start(): Promise<boolean> {
    if (this.startPromise) return this.startPromise;
    const pending = this.startInternal();
    this.startPromise = pending;
    try {
      return await pending;
    } finally {
      if (this.startPromise === pending) this.startPromise = null;
    }
  }

  private async startInternal(): Promise<boolean> {
    if (this.context) return this.resume();

    const AudioContextConstructor = getAudioContextConstructor();
    if (!AudioContextConstructor) {
      this.setStatus("unavailable", "Web Audio is unavailable in this browser.");
      return false;
    }

    if (typeof navigator !== "undefined" && navigator.userActivation) {
      const activation = navigator.userActivation;
      if (!activation.isActive && !activation.hasBeenActive) {
        this.setStatus("suspended", "Tap the sound control to begin audio.");
        return false;
      }
    }

    this.setStatus("starting", "Preparing the session soundscape.");
    try {
      const context = new AudioContextConstructor({ latencyHint: "interactive" });
      this.context = context;
      this.buildGraph(context);
      this.hidden = typeof document !== "undefined" && document.hidden;
      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", this.handleVisibility);
      }
      context.addEventListener("statechange", this.handleContextStateChange);
      this.scheduler = window.setInterval(this.schedulePulse, 100);
      this.update(this.parameters);
      await context.resume();
      this.applyMasterGain();
      const running = context.state === "running";
      this.setStatus(
        running ? "ready" : "suspended",
        running ? "Soundscape ready." : "Tap the sound control to resume audio.",
      );
      return running;
    } catch {
      await this.disposeContext();
      this.setStatus("error", "The soundscape could not start. Visuals remain complete.");
      return false;
    }
  }

  async resume(): Promise<boolean> {
    const context = this.context;
    if (!context) return false;
    try {
      await context.resume();
      this.applyMasterGain();
      const running = context.state === "running";
      this.setStatus(
        running ? "ready" : "suspended",
        running ? "Soundscape ready." : "Tap the sound control to resume audio.",
      );
      return running;
    } catch {
      this.setStatus("suspended", "Tap the sound control to resume audio.");
      return false;
    }
  }

  setMuted(muted: boolean): void {
    this.currentStatus = { ...this.currentStatus, muted };
    this.storeMute(muted);
    this.applyMasterGain();
    this.emitStatus();
  }

  toggleMuted(): boolean {
    this.setMuted(!this.isMuted);
    return this.isMuted;
  }

  setVolume(volume: number): void {
    this.volume = clamp(volume);
    this.currentStatus = { ...this.currentStatus, volume: this.volume };
    this.storeVolume(this.volume);
    this.applyMasterGain();
    this.emitStatus();
  }

  update(parameters: ArtisticParameters): void {
    this.parameters = safeParameters(parameters);
    const context = this.context;
    if (!context || !this.colourFilter) return;

    const now = context.currentTime;
    const params = this.parameters;
    const baseFrequency = 68 + params.expansion * 26 + params.memory * 8;
    const consonance = 1.5 + (1 - params.symmetry) * 0.025;

    this.smooth(this.toneA?.frequency, baseFrequency, now, 0.7);
    this.smooth(this.toneB?.frequency, baseFrequency * consonance, now, 0.8);
    this.smooth(
      this.memoryTone?.frequency,
      baseFrequency * (2 + (1 - params.symmetry) * 0.018),
      now,
      1.1,
    );
    this.smooth(
      this.pulseTone?.frequency,
      118 + params.expansion * 54,
      now,
      0.35,
    );

    this.smooth(
      this.toneAGain?.gain,
      0.026 + params.continuity * 0.018 + params.silence * 0.017,
      now,
      0.7,
    );
    this.smooth(
      this.toneBGain?.gain,
      0.009 + params.energy * 0.019 + params.density * 0.007,
      now,
      0.55,
    );
    this.smooth(
      this.memoryGain?.gain,
      params.memory * (0.009 + params.illumination * 0.017),
      now,
      1.15,
    );
    this.smooth(
      this.textureGain?.gain,
      0.002 + params.density * 0.006 + params.volatility * 0.0045,
      now,
      0.75,
    );
    this.smooth(
      this.colourFilter.frequency,
      420 + params.illumination * 760 + params.density * 240,
      now,
      0.65,
    );
    this.smooth(
      this.colourFilter.Q,
      0.2 + params.continuity * 0.42,
      now,
      0.8,
    );
  }

  async stop(): Promise<void> {
    this.detachLifecycle();

    const context = this.context;
    if (context && this.masterGain && context.state !== "closed") {
      const now = context.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(0, now, 0.018);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 55));
    }
    await this.disposeContext();
    this.setStatus("idle", "Soundscape stopped.");
  }

  private buildGraph(context: AudioContext): void {
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 20;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.025;
    compressor.release.value = 0.32;

    this.masterGain = context.createGain();
    this.masterGain.gain.value = 0;
    this.masterGain.connect(compressor);
    compressor.connect(context.destination);

    this.colourFilter = context.createBiquadFilter();
    this.colourFilter.type = "lowpass";
    this.colourFilter.frequency.value = 900;
    this.colourFilter.Q.value = 0.35;
    this.colourFilter.connect(this.masterGain);

    this.toneAGain = context.createGain();
    this.toneBGain = context.createGain();
    this.memoryGain = context.createGain();
    this.textureGain = context.createGain();
    this.pulseGain = context.createGain();
    this.toneAGain.gain.value = 0;
    this.toneBGain.gain.value = 0;
    this.memoryGain.gain.value = 0;
    this.textureGain.gain.value = 0;
    this.pulseGain.gain.value = 0.0001;
    this.toneAGain.connect(this.colourFilter);
    this.toneBGain.connect(this.colourFilter);
    this.memoryGain.connect(this.colourFilter);
    this.textureGain.connect(this.colourFilter);
    this.pulseGain.connect(this.colourFilter);

    this.toneA = context.createOscillator();
    this.toneA.type = "sine";
    this.toneA.frequency.value = 72;
    this.toneA.connect(this.toneAGain);

    this.toneB = context.createOscillator();
    this.toneB.type = "triangle";
    this.toneB.frequency.value = 108;
    this.toneB.connect(this.toneBGain);

    this.memoryTone = context.createOscillator();
    this.memoryTone.type = "sine";
    this.memoryTone.frequency.value = 144;
    this.memoryTone.connect(this.memoryGain);

    this.pulseTone = context.createOscillator();
    this.pulseTone.type = "sine";
    this.pulseTone.frequency.value = 132;
    this.pulseTone.connect(this.pulseGain);

    const textureFilter = context.createBiquadFilter();
    textureFilter.type = "bandpass";
    textureFilter.frequency.value = 520;
    textureFilter.Q.value = 0.55;
    textureFilter.connect(this.textureGain);
    this.texture = context.createBufferSource();
    this.texture.buffer = this.createTextureBuffer(context);
    this.texture.loop = true;
    this.texture.connect(textureFilter);

    this.toneA.start();
    this.toneB.start();
    this.memoryTone.start();
    this.pulseTone.start();
    this.texture.start();
  }

  private createTextureBuffer(context: AudioContext): AudioBuffer {
    const length = Math.max(1, Math.floor(context.sampleRate * 1.25));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const samples = buffer.getChannelData(0);
    let seed = 0x51f15e;
    let previous = 0;
    for (let index = 0; index < samples.length; index += 1) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      const white = ((seed >>> 0) / 0xffffffff) * 2 - 1;
      // Browned noise keeps the texture soft and avoids brittle high frequencies.
      previous = previous * 0.985 + white * 0.015;
      samples[index] = previous * 0.72;
    }
    return buffer;
  }

  private readonly schedulePulse = (): void => {
    const context = this.context;
    const pulseGain = this.pulseGain;
    if (
      !context ||
      !pulseGain ||
      context.state !== "running" ||
      this.hidden ||
      this.isMuted
    ) {
      return;
    }

    const params = this.parameters;
    if (params.rhythm < 0.08 || params.silence > 0.92) {
      this.nextPulseAt = context.currentTime + 0.25;
      return;
    }

    if (this.nextPulseAt === 0) this.nextPulseAt = context.currentTime + 0.12;
    if (context.currentTime + 0.08 < this.nextPulseAt) return;

    const at = Math.max(context.currentTime + 0.015, this.nextPulseAt);
    const peak = 0.007 + params.energy * 0.017 + params.rhythm * 0.008;
    const release = 0.32 + params.continuity * 0.3;
    pulseGain.gain.cancelScheduledValues(at);
    pulseGain.gain.setValueAtTime(0.0001, at);
    pulseGain.gain.linearRampToValueAtTime(peak, at + 0.04);
    pulseGain.gain.exponentialRampToValueAtTime(0.0001, at + release);

    const interval = 1.55 - params.rhythm * 1.08;
    this.nextPulseAt = at + clamp(interval, 0.36, 1.5);
  };

  private readonly handleVisibility = (): void => {
    if (typeof document === "undefined") return;
    this.hidden = document.hidden;
    const context = this.context;
    if (!context) return;

    this.applyMasterGain();
    if (this.hidden) {
      void context
        .suspend()
        .then(() => {
          if (this.context === context) {
            this.setStatus("suspended", "Sound paused while the page is hidden.");
          }
        })
        .catch(() => {
          // Some mobile browsers reject lifecycle suspension during teardown.
        });
    } else {
      void context
        .resume()
        .then(() => {
          if (this.context === context) {
            this.applyMasterGain();
            const running = context.state === "running";
            this.setStatus(
              running ? "ready" : "suspended",
              running ? "Soundscape ready." : "Tap the sound control to resume audio.",
            );
          }
        })
        .catch(() => {
          if (this.context === context) {
            this.setStatus("suspended", "Tap the sound control to resume audio.");
          }
        });
    }
  };

  private readonly handleContextStateChange = (): void => {
    const context = this.context;
    if (!context || context.state === "closed") return;
    if (context.state === "running") {
      this.applyMasterGain();
      this.setStatus("ready", "Soundscape ready.");
    } else if (!this.hidden) {
      this.setStatus("suspended", "Tap the sound control to resume audio.");
    }
  };

  private applyMasterGain(): void {
    const context = this.context;
    const gain = this.masterGain?.gain;
    if (!context || !gain || context.state === "closed") return;
    const target = this.isMuted || this.hidden ? 0 : this.volume * 0.68;
    const now = context.currentTime;
    gain.cancelScheduledValues(now);
    gain.setTargetAtTime(target, now, target === 0 ? 0.045 : 0.18);
  }

  private smooth(
    parameter: AudioParam | undefined,
    value: number,
    at: number,
    timeConstant: number,
  ): void {
    if (!parameter) return;
    parameter.cancelScheduledValues(at);
    parameter.setTargetAtTime(value, at, timeConstant);
  }

  private async disposeContext(): Promise<void> {
    this.detachLifecycle();
    const context = this.context;
    this.context = null;
    context?.removeEventListener("statechange", this.handleContextStateChange);

    for (const source of [
      this.toneA,
      this.toneB,
      this.memoryTone,
      this.pulseTone,
      this.texture,
    ]) {
      try {
        source?.stop();
      } catch {
        // A source can already be stopped by a browser-level context failure.
      }
      source?.disconnect();
    }

    this.masterGain?.disconnect();
    this.colourFilter?.disconnect();
    this.toneAGain?.disconnect();
    this.toneBGain?.disconnect();
    this.memoryGain?.disconnect();
    this.textureGain?.disconnect();
    this.pulseGain?.disconnect();
    this.masterGain = null;
    this.colourFilter = null;
    this.toneAGain = null;
    this.toneBGain = null;
    this.memoryGain = null;
    this.textureGain = null;
    this.pulseGain = null;
    this.toneA = null;
    this.toneB = null;
    this.memoryTone = null;
    this.pulseTone = null;
    this.texture = null;
    this.nextPulseAt = 0;

    if (context && context.state !== "closed") {
      try {
        await context.close();
      } catch {
        // Closing is best effort after browser/device teardown.
      }
    }
  }

  private setStatus(state: SoundscapeState, message: string): void {
    this.currentStatus = { ...this.currentStatus, state, message };
    this.emitStatus();
  }

  private emitStatus(): void {
    const snapshot = this.status;
    for (const listener of this.statusListeners) listener(snapshot);
  }

  private readStoredMute(): boolean | undefined {
    if (!this.muteStorageKey || typeof window === "undefined") {
      return undefined;
    }
    try {
      const stored = window.localStorage.getItem(this.muteStorageKey);
      return stored === null ? undefined : stored === "1";
    } catch {
      return undefined;
    }
  }

  private storeMute(muted: boolean): void {
    if (!this.muteStorageKey || typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(this.muteStorageKey, muted ? "1" : "0");
    } catch {
      // Storage can be unavailable in privacy modes; in-memory state still works.
    }
  }

  private detachLifecycle(): void {
    if (this.scheduler !== null && typeof window !== "undefined") {
      window.clearInterval(this.scheduler);
    }
    this.scheduler = null;
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.handleVisibility);
    }
  }

  private readStoredVolume(): number | undefined {
    if (!this.volumeStorageKey || typeof window === "undefined") return undefined;
    try {
      const stored = window.localStorage.getItem(this.volumeStorageKey);
      if (stored === null) return undefined;
      const parsed = Number(stored);
      return Number.isFinite(parsed) ? clamp(parsed) : undefined;
    } catch {
      return undefined;
    }
  }

  private storeVolume(volume: number): void {
    if (!this.volumeStorageKey || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(this.volumeStorageKey, String(clamp(volume)));
    } catch {
      // Storage can be unavailable in privacy modes; in-memory state still works.
    }
  }
}

export function createSoundscape(
  options?: SoundscapeOptions,
): SoundscapeController {
  return new SoundscapeController(options);
}
