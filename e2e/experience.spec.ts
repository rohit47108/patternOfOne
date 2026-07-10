import { expect, test, type Locator, type Page } from "@playwright/test";

const FAST_DEBUG_ROUTE = "/?debug=1&speed=24";
const SESSION_STORAGE_KEY = "pattern-of-one:sessions:v1";

type MediaMockResult = "allow" | "deny";

async function installMediaMock(page: Page, result: MediaMockResult) {
  await page.addInitScript((mockResult) => {
    const requests: MediaStreamConstraints[] = [];
    Object.defineProperty(window, "__patternOfOneMediaRequests", {
      configurable: true,
      value: requests,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async (constraints: MediaStreamConstraints) => {
          requests.push(constraints);
          if (mockResult === "deny") {
            throw new DOMException("Permission declined by the test", "NotAllowedError");
          }
          return new MediaStream();
        },
      },
    });
  }, result);
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
    await expect(chooser.getByRole("button", { name: /^Contrasting pair/ })).toBeVisible();
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
    await expect(page.getByText("measured signal profile")).toBeVisible();

    await expect(page.getByText("Your temporary portrait")).toBeVisible({
      timeout: 8_000,
    });
    await expect(page.locator("main.stage--reveal")).toBeVisible();
    await expect(page.locator("#portrait-title")).toBeVisible();
    await expect(page.locator(".observations > li")).toHaveCount(3);
    await expect(page.getByText(/An artistic interpretation/)).toBeVisible();
  });

  test("demo chooser builds a contrasting pair and reaches comparison", async ({ page }) => {
    await openConsent(page, FAST_DEBUG_ROUTE);
    await page.getByTestId("use-demo").click();
    await page
      .getByTestId("demo-chooser")
      .getByRole("button", { name: /^Contrasting pair/ })
      .click();

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

    await expect(page.getByText("movement only", { exact: true })).toBeVisible({
      timeout: 3_000,
    });
    await expect(page.getByRole("progressbar", { name: "Portrait session progress" }))
      .toBeVisible();
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
    await expect(notice.getByRole("button", { name: "Continue" })).toBeEnabled();
    await expect.poll(() => mediaRequests(page)).toHaveLength(2);

    await notice.getByRole("button", { name: "Use demo mode" }).click();
    await expect(page.getByText("Movement simulated")).toBeVisible();
    await expect(page.getByText("Sound simulated")).toBeVisible();
    expect(await mediaRequests(page)).toHaveLength(2);
  });

  test("project information dialog manages focus and rendering quality", async ({ page }) => {
    await gotoExperience(page, "/");
    const about = page.getByRole("button", { name: "About this work" });
    await about.click();

    const dialog = page.getByRole("dialog", { name: "A portrait made from change." });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close project information" }))
      .toBeFocused();
    await expect(dialog.getByText("No face recognition, identity matching"))
      .toBeVisible();

    const quality = dialog.getByRole("combobox", { name: "Rendering quality" });
    await expect(quality).toHaveValue("auto");
    await quality.selectOption("low");
    await expect(quality).toHaveValue("low");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(about).toBeFocused();
    await about.click();
    await expect(
      page
        .getByRole("dialog", { name: "A portrait made from change." })
        .getByRole("combobox", { name: "Rendering quality" }),
    ).toHaveValue("low");
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
      chooser.getByRole("button", { name: /^Contrasting pair/ }),
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
