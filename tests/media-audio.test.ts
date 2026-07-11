import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  classifyMediaError,
  MediaSensorController,
} from "../src/lib/media";
import {
  SoundscapeController,
  type SoundscapeState,
} from "../src/lib/soundscape";

interface FakeTrack {
  kind: "audio" | "video";
  addEventListener: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

interface FakeAudioContextOptions {
  resumeGate?: Promise<void>;
  resumeState?: AudioContextState;
  resumeError?: Error;
  failMediaSource?: boolean;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function fakeTrack(kind: FakeTrack["kind"]): FakeTrack {
  return {
    kind,
    addEventListener: vi.fn(),
    stop: vi.fn(),
  };
}

function fakeStream(
  videoTracks: FakeTrack[] = [],
  audioTracks: FakeTrack[] = [],
): MediaStream {
  return {
    getTracks: () => [...videoTracks, ...audioTracks],
    getVideoTracks: () => videoTracks,
    getAudioTracks: () => audioTracks,
  } as unknown as MediaStream;
}

function fakeAudioParam(initialValue = 0): AudioParam {
  const parameter = {
    value: initialValue,
    cancelAndHoldAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    setValueAtTime: vi.fn(),
    setValueCurveAtTime: vi.fn(),
  };
  return parameter as unknown as AudioParam;
}

function fakeAudioNode<T extends object>(extra: T) {
  return Object.assign(
    {
      connect: vi.fn(),
      disconnect: vi.fn(),
    },
    extra,
  );
}

class FakeAudioContext {
  state: AudioContextState = "suspended";
  currentTime = 0;
  sampleRate = 800;
  destination = fakeAudioNode({});
  readonly sourceNodes: Array<{
    disconnect: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }> = [];

  readonly addEventListener = vi.fn();
  readonly removeEventListener = vi.fn();
  readonly close: ReturnType<typeof vi.fn>;
  readonly resume: ReturnType<typeof vi.fn>;
  readonly suspend: ReturnType<typeof vi.fn>;
  readonly createAnalyser: ReturnType<typeof vi.fn>;
  readonly createBiquadFilter: ReturnType<typeof vi.fn>;
  readonly createBuffer: ReturnType<typeof vi.fn>;
  readonly createBufferSource: ReturnType<typeof vi.fn>;
  readonly createDynamicsCompressor: ReturnType<typeof vi.fn>;
  readonly createGain: ReturnType<typeof vi.fn>;
  readonly createMediaStreamSource: ReturnType<typeof vi.fn>;
  readonly createOscillator: ReturnType<typeof vi.fn>;

  constructor(private readonly options: FakeAudioContextOptions = {}) {
    this.close = vi.fn(async () => {
      this.state = "closed";
    });
    this.resume = vi.fn(async () => {
      if (this.options.resumeGate) await this.options.resumeGate;
      if (this.options.resumeError) throw this.options.resumeError;
      this.state = this.options.resumeState ?? "running";
    });
    this.suspend = vi.fn(async () => {
      this.state = "suspended";
    });
    this.createAnalyser = vi.fn(() =>
      fakeAudioNode({
        fftSize: 1_024,
        smoothingTimeConstant: 0,
        getFloatTimeDomainData: vi.fn(),
      }),
    );
    this.createBiquadFilter = vi.fn(() =>
      fakeAudioNode({
        type: "lowpass",
        frequency: fakeAudioParam(),
        Q: fakeAudioParam(),
      }),
    );
    this.createBuffer = vi.fn((_channels: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    }));
    this.createBufferSource = vi.fn(() => {
      const node = fakeAudioNode({
        buffer: null,
        loop: false,
        start: vi.fn(),
        stop: vi.fn(),
      });
      this.sourceNodes.push(node);
      return node;
    });
    this.createDynamicsCompressor = vi.fn(() =>
      fakeAudioNode({
        threshold: fakeAudioParam(),
        knee: fakeAudioParam(),
        ratio: fakeAudioParam(),
        attack: fakeAudioParam(),
        release: fakeAudioParam(),
      }),
    );
    this.createGain = vi.fn(() =>
      fakeAudioNode({ gain: fakeAudioParam() }),
    );
    this.createMediaStreamSource = vi.fn(() => {
      if (this.options.failMediaSource) {
        throw new Error("media source construction failed");
      }
      return fakeAudioNode({});
    });
    this.createOscillator = vi.fn(() => {
      const node = fakeAudioNode({
        type: "sine",
        frequency: fakeAudioParam(),
        start: vi.fn(),
        stop: vi.fn(),
      });
      this.sourceNodes.push(node);
      return node;
    });
  }
}

function installAudioContext(options: FakeAudioContextOptions = {}) {
  const instances: FakeAudioContext[] = [];
  class InstalledAudioContext extends FakeAudioContext {
    constructor() {
      super(options);
      instances.push(this);
    }
  }
  vi.stubGlobal("AudioContext", InstalledAudioContext as unknown as typeof AudioContext);
  return instances;
}

function setMediaDevices(value: MediaDevices | undefined) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value,
  });
}

function stubAnimationFrame() {
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
}

const originalMediaDevices = Object.getOwnPropertyDescriptor(
  navigator,
  "mediaDevices",
);
const originalUserActivation = Object.getOwnPropertyDescriptor(
  navigator,
  "userActivation",
);

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(navigator, "userActivation", {
    configurable: true,
    value: { hasBeenActive: true, isActive: true },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  if (originalMediaDevices) {
    Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
  } else {
    Reflect.deleteProperty(navigator, "mediaDevices");
  }
  if (originalUserActivation) {
    Object.defineProperty(navigator, "userActivation", originalUserActivation);
  } else {
    Reflect.deleteProperty(navigator, "userActivation");
  }
});

describe("browser media lifecycle", () => {
  it("distinguishes permission and device failures", () => {
    expect(classifyMediaError({ name: "NotAllowedError" })).toBe("denied");
    expect(classifyMediaError({ name: "NotFoundError" })).toBe("unavailable");
    expect(classifyMediaError({ name: "NotReadableError" })).toBe("error");
  });

  it("uses one combined request for full media and releases each shared-stream track once", async () => {
    const videoTrack = fakeTrack("video");
    const audioTrack = fakeTrack("audio");
    const stream = fakeStream([videoTrack], [audioTrack]);
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    setMediaDevices({ getUserMedia } as unknown as MediaDevices);
    const contexts = installAudioContext();
    stubAnimationFrame();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(
      () => undefined,
    );

    const controller = new MediaSensorController({ enablePose: false });
    const result = await controller.start("full");

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        audio: expect.any(Object),
        video: expect.any(Object),
      }),
    );
    expect(result.cameraReady).toBe(true);
    expect(result.microphoneReady).toBe(true);
    expect(result.hasLiveInput).toBe(true);
    expect(contexts).toHaveLength(1);

    await controller.stop();
    expect(videoTrack.stop).toHaveBeenCalledOnce();
    expect(audioTrack.stop).toHaveBeenCalledOnce();
    expect(contexts[0].close).toHaveBeenCalledOnce();
    expect(controller.isActive).toBe(false);
  });

  it("movement-only requests no microphone and never creates an AudioContext", async () => {
    const videoTrack = fakeTrack("video");
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream([videoTrack]));
    setMediaDevices({ getUserMedia } as unknown as MediaDevices);
    const contexts = installAudioContext();
    stubAnimationFrame();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(
      () => undefined,
    );

    const controller = new MediaSensorController({ enablePose: false });
    const result = await controller.start("movement");

    expect(result.cameraReady).toBe(true);
    expect(result.microphoneReady).toBe(false);
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({ audio: false, video: expect.any(Object) }),
    );
    expect(contexts).toHaveLength(0);

    await controller.stop();
    expect(videoTrack.stop).toHaveBeenCalledOnce();
  });

  it("closes the prepared audio context when a combined permission request is denied", async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValue(new DOMException("permission declined", "NotAllowedError"));
    setMediaDevices({ getUserMedia } as unknown as MediaDevices);
    const contexts = installAudioContext();

    const controller = new MediaSensorController();
    const result = await controller.start("full");

    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(result.hasLiveInput).toBe(false);
    expect(result.status.camera).toBe("denied");
    expect(result.status.microphone).toBe("denied");
    expect(result.status.message).toContain("Demo mode remains available");
    expect(contexts).toHaveLength(1);
    expect(contexts[0].close).toHaveBeenCalledOnce();
    expect(controller.isActive).toBe(false);
  });

  it("closes the prepared audio context when media capture is unsupported", async () => {
    setMediaDevices(undefined);
    const contexts = installAudioContext();

    const controller = new MediaSensorController();
    const result = await controller.start("full");

    expect(result.hasLiveInput).toBe(false);
    expect(result.status.camera).toBe("unavailable");
    expect(result.status.microphone).toBe("unavailable");
    expect(contexts).toHaveLength(1);
    expect(contexts[0].close).toHaveBeenCalledOnce();
  });

  it("stops a stream that arrives after pending capture is cancelled", async () => {
    const request = deferred<MediaStream>();
    const getUserMedia = vi.fn(() => request.promise);
    setMediaDevices({ getUserMedia } as unknown as MediaDevices);
    const track = fakeTrack("video");
    const controller = new MediaSensorController({ enablePose: false });

    const start = controller.start("movement");
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
    await controller.stop();
    request.resolve(fakeStream([track]));

    const result = await start;
    expect(track.stop).toHaveBeenCalledOnce();
    expect(result.hasLiveInput).toBe(false);
    expect(controller.isActive).toBe(false);
    expect(controller.status.camera).toBe("idle");
  });
});

describe("soundscape lifecycle and preferences", () => {
  it("moves from idle through starting to ready and shares one concurrent startup", async () => {
    const resume = deferred<void>();
    const contexts = installAudioContext({ resumeGate: resume.promise });
    const controller = new SoundscapeController({
      muted: false,
      muteStorageKey: false,
      volumeStorageKey: false,
    });
    const states: SoundscapeState[] = [];
    controller.subscribe((status) => states.push(status.state));

    const first = controller.start();
    const second = controller.start();

    expect(contexts).toHaveLength(1);
    expect(contexts[0].resume).toHaveBeenCalledOnce();
    expect(states).toEqual(["idle", "starting"]);

    resume.resolve(undefined);
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(contexts).toHaveLength(1);
    expect(states.at(-1)).toBe("ready");
    expect(controller.status.muted).toBe(false);

    await controller.stop();
  });

  it("reports unavailable without constructing audio when Web Audio is absent", async () => {
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", undefined);
    const controller = new SoundscapeController({
      muteStorageKey: false,
      volumeStorageKey: false,
    });

    expect(controller.isStarted).toBe(false);
    await expect(controller.start()).resolves.toBe(false);
    expect(controller.status.state).toBe("unavailable");
  });

  it("reports suspended when resume resolves without a running context", async () => {
    const contexts = installAudioContext({ resumeState: "suspended" });
    const controller = new SoundscapeController({
      muted: false,
      muteStorageKey: false,
      volumeStorageKey: false,
    });

    await expect(controller.start()).resolves.toBe(false);
    expect(controller.status.state).toBe("suspended");
    expect(contexts).toHaveLength(1);

    await controller.stop();
  });

  it("persists local mute and clamped volume preferences", () => {
    const muteKey = "test:pattern-of-one:mute";
    const volumeKey = "test:pattern-of-one:volume";
    const first = new SoundscapeController({
      muted: true,
      volume: 0.25,
      muteStorageKey: muteKey,
      volumeStorageKey: volumeKey,
    });

    first.setMuted(false);
    first.setVolume(4);
    expect(first.status.muted).toBe(false);
    expect(first.status.volume).toBe(1);
    expect(window.localStorage.getItem(muteKey)).toBe("0");
    expect(window.localStorage.getItem(volumeKey)).toBe("1");

    const restored = new SoundscapeController({
      muted: true,
      volume: 0.1,
      muteStorageKey: muteKey,
      volumeStorageKey: volumeKey,
    });
    expect(restored.status.muted).toBe(false);
    expect(restored.status.volume).toBe(1);

    restored.setVolume(-3);
    expect(restored.status.volume).toBe(0);
    expect(window.localStorage.getItem(volumeKey)).toBe("0");
  });

  it("cleans scheduler, listeners, sources, and context after startup failure", async () => {
    const contexts = installAudioContext({
      resumeError: new Error("audio output failed"),
    });
    const setInterval = vi
      .spyOn(window, "setInterval")
      .mockReturnValue(73 as never);
    const clearInterval = vi.spyOn(window, "clearInterval");
    const addDocumentListener = vi.spyOn(document, "addEventListener");
    const removeDocumentListener = vi.spyOn(document, "removeEventListener");
    const controller = new SoundscapeController({
      muted: false,
      muteStorageKey: false,
      volumeStorageKey: false,
    });

    await expect(controller.start()).resolves.toBe(false);

    expect(controller.status.state).toBe("error");
    expect(controller.isStarted).toBe(false);
    expect(contexts).toHaveLength(1);
    expect(setInterval).toHaveBeenCalledOnce();
    expect(clearInterval).toHaveBeenCalledWith(73);
    expect(addDocumentListener).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
    expect(removeDocumentListener).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
    expect(contexts[0].removeEventListener).toHaveBeenCalledWith(
      "statechange",
      expect.any(Function),
    );
    expect(contexts[0].close).toHaveBeenCalledOnce();
    expect(contexts[0].sourceNodes).toHaveLength(5);
    for (const source of contexts[0].sourceNodes) {
      expect(source.stop).toHaveBeenCalledOnce();
      expect(source.disconnect).toHaveBeenCalledOnce();
    }
  });
});
