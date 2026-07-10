import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyMediaError,
  MediaSensorController,
} from "../src/lib/media";
import { SoundscapeController } from "../src/lib/soundscape";

interface FakeTrack {
  addEventListener: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

function fakeStream(track: FakeTrack): MediaStream {
  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
    getAudioTracks: () => [],
  } as unknown as MediaStream;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("browser media lifecycle", () => {
  it("distinguishes permission and device failures", () => {
    expect(classifyMediaError({ name: "NotAllowedError" })).toBe("denied");
    expect(classifyMediaError({ name: "NotFoundError" })).toBe("unavailable");
    expect(classifyMediaError({ name: "NotReadableError" })).toBe("error");
  });

  it("movement-only requests no microphone and releases every camera track", async () => {
    const track: FakeTrack = {
      addEventListener: vi.fn(),
      stop: vi.fn(),
    };
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream(track));
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);

    const controller = new MediaSensorController({ enablePose: false });
    const result = await controller.start("movement");

    expect(result.cameraReady).toBe(true);
    expect(result.microphoneReady).toBe(false);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({ audio: false, video: expect.any(Object) }),
    );

    await controller.stop();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(controller.isActive).toBe(false);
    expect(controller.status.camera).toBe("idle");
  });

  it("permission denial resolves to a fallback instead of rejecting", async () => {
    const getUserMedia = vi.fn().mockRejectedValue({ name: "NotAllowedError" });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    const controller = new MediaSensorController();
    const result = await controller.start("movement");

    expect(result.hasLiveInput).toBe(false);
    expect(result.status.camera).toBe("denied");
    expect(result.status.pose).toBe("fallback");
    expect(result.status.message).toContain("demo input");
  });
});

describe("soundscape startup", () => {
  it("constructs without creating audio and degrades when Web Audio is absent", async () => {
    vi.stubGlobal("AudioContext", undefined);
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: undefined,
    });

    const soundscape = new SoundscapeController({
      muted: true,
      muteStorageKey: false,
    });

    expect(soundscape.isStarted).toBe(false);
    await expect(soundscape.start()).resolves.toBe(false);
    expect(soundscape.status.state).toBe("unavailable");
  });
});
