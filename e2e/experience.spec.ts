import { expect, test, type Locator, type Page } from "@playwright/test";

const FAST_DEBUG_ROUTE = "/?debug=1&speed=8";
const SESSION_STORAGE_KEY = "pattern-of-one:sessions:v1";

type MediaMockResult = "allow" | "deny";

async function installMediaMock(page: Page, result: MediaMockResult) {
  await page.addInitScript((mockResult) => {
    const requests: MediaStreamConstraints[] = [];
    const streams: MediaStream[] = [];
    Object.defineProperty(window, "__patternOfOneMediaRequests", {
      configurable: true,
      value: requests,
    });
    Object.defineProperty(window, "__patternOfOneMediaStreams", {
      configurable: true,
      value: streams,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async (constraints: MediaStreamConstraints) => {
          requests.push(constraints);
          if (mockResult === "deny") {
            throw new DOMException("Permission declined by the test", "NotAllowedError");
          }
          const canvas = document.createElement("canvas");
          canvas.width = 8;
          canvas.height = 8;
          canvas.getContext("2d")?.fillRect(0, 0, 8, 8);
          const stream = canvas.captureStream(8);
          if (constraints.audio) {
            const AudioContextConstructor =
              window.AudioContext ??
              (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (AudioContextConstructor) {
              const context = new AudioContextConstructor();
              const oscillator = context.createOscillator();
              const destination = context.createMediaStreamDestination();
              oscillator.connect(destination);
              oscillator.start();
              const audioTrack = destination.stream.getAudioTracks()[0];
              if (audioTrack) stream.addTrack(audioTrack);
            }
          }
          streams.push(stream);
          return stream;
        },
      },
    });
  }, result);
}

async function mediaTrackStates(page: Page) {
  return page.evaluate(() =>
    ((window as typeof window & { __patternOfOneMediaStreams?: MediaStream[] }).__patternOfOneMediaStreams ?? [])
      .flatMap((stream) => stream.getTracks().map((track) => track.readyState)),
  );
}

async function mediaRequests(page: Page) {
  return page.evaluate(() => {
    return (
      window as typeof window & {
        __patternOfOneMediaRequests?: MediaStreamConstraints[];
      }
    ).__patternOfOneMediaRequests ?? [];
  });
}

async function gotoExperience(page: Page, route: string) {
  await page.goto(route);
  // Experience sets this inline variable from an effect after React has
  // hydrated. Waiting on it prevents SSR-era clicks from being swallowed.
  await page.waitForFunction(
    () => document.documentElement.style.getPropertyValue("--accent").length > 0,
  );
}

async function openConsent(page: Page, route = "/") {
  await gotoExperience(page, route);
  await page.getByTestId("begin-portrait").click();
  await expect(
    page.getByRole("heading", { name: "Your presence, not your likeness." }),
  ).toBeVisible();
}

async function expectInsideViewport(page: Page, locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
});

test.describe("desktop portrait experience", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-chromium",
      "Desktop behavior is exercised once in the desktop project.",
    );
  });

  test("attract state loads with accessible controls before requesting media", async ({
    page,
  }) => {
    await installMediaMock(page, "deny");
    await gotoExperience(page, "/");

    await expect(page.locator("main.stage--attract")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Pattern of One" })).toBeVisible();
    await expect(
      page.getByText("A portrait of how you move, speak, pause, and change."),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: "Evolving abstract portrait" }),
    ).toBeVisible();
    await expect(page.getByTestId("begin-portrait")).toBeEnabled();
    await expect(page.getByRole("button", { name: "Sound off" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(page.getByRole("button", { name: "About this work" })).toHaveAttribute(
      "aria-haspopup",
      "dialog",
    );
    await expect(page.getByText("No face recognition.")).toBeVisible();
    expect(await mediaRequests(page)).toHaveLength(0);
  });

  test("consent explains each input and exposes all non-dead-end choices", async ({
    page,
  }) => {
    await openConsent(page);

    await expect(page.locator("main.stage--consent")).toBeVisible();
    await expect(page.getByText("Permission is requested only after you select an option"))
      .toBeVisible();
    await expect(page.getByText("Movement landmarks and local motion features"))
      .toBeVisible();
    await expect(page.getByText("Volume, rhythm, variation, and silence"))
      .toBeVisible();
    await expect(page.getByText(/not a personality, emotion, or mental-health assessment/))
      .toBeVisible();
    await expect(page.getByTestId("enable-media")).toBeEnabled();
    await expect(page.getByTestId("movement-only")).toBeEnabled();

    const demoToggle = page.getByTestId("use-demo");
    await expect(demoToggle).toHaveAttribute("aria-expanded", "false");
    await demoToggle.click();
    await expect(demoToggle).toHaveAttribute("aria-expanded", "true");

    const chooser = page.getByTestId("demo-chooser");
    await expect(chooser.getByRole("button", { name: /^Measured/ })).toBeVisible();
    await expect(chooser.getByRole("button", { name: /^Kinetic/ })).toBeVisible();
    await expect(chooser.getByRole("button", { name: /^Contrasting pair/ })).toHaveCount(0);
  });

  test("stage navigation returns cleanly without leaving the demo chooser open", async ({ page }) => {
    await openConsent(page);
    await page.getByTestId("use-demo").click();
    await expect(page.getByTestId("demo-chooser")).toBeVisible();
    await page.getByTestId("back-to-attract").click();
    await expect(page.locator("main.stage--attract")).toBeVisible();
    await page.getByTestId("begin-portrait").click();
    await expect(page.getByTestId("demo-chooser")).toBeHidden();
  });

  test("accelerated deterministic demo completes calibration, prompts, and reveal", async ({
    page,
  }) => {
    await openConsent(page, FAST_DEBUG_ROUTE);
    await page.getByTestId("use-demo").click();
    await page
      .getByTestId("demo-chooser")
      .getByRole("button", { name: /^Measured/ })
      .click();

    await expect(page.getByRole("progressbar", { name: "Calibration progress" }))
      .toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Introduce yourself without saying your name.",
      }),
    ).toBeVisible({ timeout: 2_500 });
    await expect(page.getByText("measured demo · simulated movement and sound")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Describe a place you can still picture clearly." }))
      .toBeVisible({ timeout: 2_500 });
    await expect(page.getByRole("heading", { name: "Show the portrait something words cannot." }))
      .toBeVisible({ timeout: 2_500 });

    await expect(page.getByText("Your temporary portrait")).toBeVisible({
      timeout: 8_000,
    });
    await expect(page.locator("main.stage--reveal")).toBeVisible();
    await expect(page.locator("#portrait-title")).toBeVisible();
    await expect(page.locator(".observations > li")).toHaveCount(3);
    await expect(page.getByText(/An artistic interpretation/)).toBeVisible();
  });

  test("demo chooser builds a contrasting pair and reaches comparison", async ({ page }) => {
    await gotoExperience(page, "/?debug=1&speed=24&demo=contrast");

    await expect(
      page.getByRole("heading", { name: "Earlier patterns are returning." }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Difference without judgment." }),
    ).toBeVisible({ timeout: 3_000 });
    await expect(page.locator("main.stage--compare")).toBeVisible();
    await expect(
      page.getByRole("img", { name: /^Living abstract portrait:/ }),
    ).toHaveCount(2);
    await expect(page.locator(".compare-portrait")).toHaveCount(2);
    const titles = await page.locator(".compare-portrait h3").allTextContents();
    expect(new Set(titles).size).toBe(2);
    await expect(page.getByText(/Neither is a score|distinct history/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Back to portrait" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Clear both" })).toBeEnabled();
  });

  test("movement-only requests one mocked camera stream and no microphone", async ({
    page,
  }) => {
    await installMediaMock(page, "allow");
    await openConsent(page, "/?debug=1&speed=4");
    await page.getByTestId("movement-only").click();

    await expect(page.getByText("Sound not requested")).toBeVisible();
    await expect.poll(() => mediaRequests(page)).toHaveLength(1);
    const [request] = await mediaRequests(page);
    expect(request.video).toBeTruthy();
    expect(request.audio).toBe(false);

    await expect(page.getByText("movement ready", { exact: true })).toBeVisible({
      timeout: 3_000,
    });
    await expect(page.getByRole("progressbar", { name: "Portrait session progress" }))
      .toBeVisible();
  });

  test("full mode makes one combined request and exposes live sensor state", async ({ page }) => {
    await installMediaMock(page, "allow");
    await openConsent(page, FAST_DEBUG_ROUTE);
    await page.getByTestId("enable-media").click();

    await expect.poll(() => mediaRequests(page)).toHaveLength(1);
    const [request] = await mediaRequests(page);
    expect(request.video).toBeTruthy();
    expect(request.audio).toBeTruthy();
    await expect(page.locator(".sensor-notes")).toContainText("Movement ready");
    await expect(page.getByRole("progressbar", { name: "Portrait session progress" }))
      .toBeVisible({ timeout: 3_000 });
    await expect(page.locator(".session-status")).toContainText("movement ready");
  });

  test("cancel releases active media and returns to the input choices", async ({ page }) => {
    await installMediaMock(page, "allow");
    await openConsent(page);
    await page.getByTestId("movement-only").click();
    await expect.poll(() => mediaRequests(page)).toHaveLength(1);
    await page.getByTestId("cancel-session").click();

    await expect(page.locator("main.stage--consent")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your presence, not your likeness." }))
      .toBeVisible();
    await expect.poll(() => mediaTrackStates(page)).toEqual(["ended"]);
  });

  test("sound reports real on and off states", async ({ page }) => {
    await gotoExperience(page, "/");
    const sound = page.getByRole("button", { name: "Sound off" });
    await sound.click();
    await expect(page.getByRole("button", { name: "Sound on" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("button", { name: "Sound on" }).click();
    await expect(page.getByRole("button", { name: "Sound off" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  test("sound failure is visible instead of silently pretending to be on", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "AudioContext", { configurable: true, value: undefined });
      Object.defineProperty(window, "webkitAudioContext", { configurable: true, value: undefined });
    });
    await gotoExperience(page, "/");
    await page.getByRole("button", { name: "Sound off" }).click();
    await expect(page.getByRole("button", { name: "Sound unavailable" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(page.getByRole("status")).toContainText("Web Audio is unavailable");
  });

  test("camera and microphone denial presents an actionable demo fallback", async ({
    page,
  }) => {
    await installMediaMock(page, "deny");
    await openConsent(page, "/?debug=1&speed=4");
    await page.getByTestId("enable-media").click();

    const notice = page
      .getByRole("status")
      .filter({ hasText: "Camera access is unavailable." });
    await expect(notice).toContainText(
      "Camera and microphone permission were declined. Demo mode remains available.",
    );
    await expect(notice.getByRole("button", { name: "Use demo mode" })).toBeEnabled();
    await expect(notice.getByRole("button", { name: "Continue" })).toHaveCount(0);
    await expect.poll(() => mediaRequests(page)).toHaveLength(1);
    const [request] = await mediaRequests(page);
    expect(request.video).toBeTruthy();
    expect(request.audio).toBeTruthy();
    await expect(notice.getByRole("button", { name: "Retry devices" })).toBeEnabled();
    await expect(notice.getByRole("button", { name: "Movement only" })).toBeEnabled();

    await notice.getByRole("button", { name: "Use demo mode" }).click();
    await expect(page.getByText("Movement simulated")).toBeVisible();
    await expect(page.getByText("Sound simulated")).toBeVisible();
    expect(await mediaRequests(page)).toHaveLength(1);
  });

  test("project information dialog manages focus and rendering quality", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 });
    });
    await gotoExperience(page, "/");
    const about = page.getByRole("button", { name: "About this work" });
    await about.click();

    const dialog = page.getByRole("dialog", { name: "What changes the portrait." });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close project information" }))
      .toBeFocused();
    await expect(dialog.getByText(/does not recognize faces, identify people/)).toBeVisible();
    await expect(dialog.getByText("Hackathon connection")).toHaveCount(0);

    const quality = dialog.getByRole("combobox", { name: "Rendering quality" });
    await expect(quality).toHaveValue("auto");
    await quality.selectOption("high");
    await expect(page.locator("canvas.portrait-canvas")).toHaveAttribute("data-quality", "high");
    const highBuffer = await page.locator("canvas.portrait-canvas").evaluate((canvas) => ({
      width: (canvas as HTMLCanvasElement).width,
      height: (canvas as HTMLCanvasElement).height,
    }));
    await quality.selectOption("low");
    await expect(quality).toHaveValue("low");
    await expect(page.locator("canvas.portrait-canvas")).toHaveAttribute("data-quality", "low");
    await expect(dialog.getByText("Currently using low quality.")).toBeVisible();
    const lowBuffer = await page.locator("canvas.portrait-canvas").evaluate((canvas) => ({
      width: (canvas as HTMLCanvasElement).width,
      height: (canvas as HTMLCanvasElement).height,
    }));
    expect(highBuffer.width).toBeGreaterThan(lowBuffer.width);
    expect(highBuffer.height).toBeGreaterThan(lowBuffer.height);

    const volume = dialog.getByRole("slider", { name: "Ambient volume" });
    await volume.fill("0.35");
    await expect(volume).toHaveValue("0.35");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(about).toBeFocused();
    await about.click();
    await expect(
      page
        .getByRole("dialog", { name: "What changes the portrait." })
        .getByRole("combobox", { name: "Rendering quality" }),
    ).toHaveValue("low");
    await expect(
      page
        .getByRole("dialog", { name: "What changes the portrait." })
        .getByRole("slider", { name: "Ambient volume" }),
    ).toHaveValue("0.35");
  });

  test("reveal supports replay, create-another, and privacy reset", async ({ page }) => {
    await gotoExperience(page, "/?preview=reveal");
    await expect(page.getByText("Your temporary portrait")).toBeVisible();

    const replay = page.getByRole("button", { name: "Replay" });
    await replay.click();
    await expect(replay).toBeDisabled();
    await expect(page.getByText("Replaying the session")).toBeVisible();

    await page.getByRole("button", { name: "Create another" }).click();
    await expect(
      page.getByRole("heading", { name: "The encounter dissolves." }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Your presence, not your likeness." }),
    ).toBeVisible({ timeout: 2_500 });

    await gotoExperience(page, "/?preview=reveal");
    await expect(page.getByText("Your temporary portrait")).toBeVisible();
    await page.evaluate((key) => {
      window.localStorage.setItem(key, "stored-session-placeholder");
    }, SESSION_STORAGE_KEY);
    await page.getByTestId("reset").click();
    await expect(page.getByTestId("begin-portrait")).toBeVisible({ timeout: 2_500 });
    await expect
      .poll(() => page.evaluate((key) => window.localStorage.getItem(key), SESSION_STORAGE_KEY))
      .toBeNull();
  });

  test("reduced-motion keeps the portrait meaningful and shortens reset", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoExperience(page, "/?preview=reveal");

    await expect(page.getByText("Your temporary portrait")).toBeVisible();
    await expect(
      page.getByRole("img", { name: "Evolving abstract portrait" }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches),
    ).toBe(true);
    const animationDuration = await page.locator(".reveal-layout").evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).animationDuration),
    );
    expect(animationDuration).toBeLessThanOrEqual(0.01);

    await page.getByTestId("reset").click();
    await expect(page.getByTestId("begin-portrait")).toBeVisible({ timeout: 900 });
  });

  test("PNG export emits a completed download", async ({ page }) => {
    await gotoExperience(page, "/?preview=reveal");
    await expect(page.getByText("Your temporary portrait")).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("export-png").click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^[a-z0-9-]+\.png$/);
    expect(await download.failure()).toBeNull();
    await expect(page.getByRole("status")).toHaveText("Portrait exported as PNG.");
  });

  test("all required viewport sizes keep primary controls reachable without overflow", async ({ page }) => {
    const viewports = [
      { width: 1440, height: 900 },
      { width: 1280, height: 720 },
      { width: 1024, height: 768 },
      { width: 768, height: 1024 },
      { width: 390, height: 844 },
      { width: 360, height: 800 },
    ];

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await gotoExperience(page, "/");
      await expectInsideViewport(page, page.getByTestId("begin-portrait"));
      await expectInsideViewport(page, page.getByRole("button", { name: "Sound off" }));
      await expectInsideViewport(page, page.getByRole("button", { name: "About this work" }));
      const overflow = await page.evaluate(() =>
        Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
    }
  });
});

test.describe("390 by 844 mobile experience", () => {
  test.describe.configure({ mode: "serial" });

  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-chromium",
      "The exact mobile viewport is exercised once in the mobile project.",
    );
  });

  test("primary controls and every consent fallback remain reachable without horizontal overflow", async ({
    page,
  }) => {
    await gotoExperience(page, "/");
    expect(await page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([
      390,
      844,
    ]);

    await expectInsideViewport(page, page.getByTestId("begin-portrait"));
    await expectInsideViewport(page, page.getByRole("button", { name: "About this work" }));
    await page.getByTestId("begin-portrait").click();

    for (const testId of ["enable-media", "movement-only", "use-demo"]) {
      await expectInsideViewport(page, page.getByTestId(testId));
    }
    await page.getByTestId("use-demo").click();
    const chooser = page.getByTestId("demo-chooser");
    await expectInsideViewport(
      page,
      chooser.getByRole("button", { name: /^Kinetic/ }),
    );

    const widths = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    expect(widths.document).toBeLessThanOrEqual(widths.viewport + 1);
    expect(widths.body).toBeLessThanOrEqual(widths.viewport + 1);
  });
});
