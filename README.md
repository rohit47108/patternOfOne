# Pattern of One

**A portrait of how you move, speak, pause, and change.**

Pattern of One is a browser-based interactive artwork that builds a temporary abstract portrait from changes in movement, gesture, sound, rhythm, and silence. It represents how one encounter unfolds rather than what a participant looks like.

The portrait is an artistic interpretation. It does not identify a participant, recognize faces, classify emotions, diagnose health, or describe personality.

> Live production: [patternofone.vercel.app](https://patternofone.vercel.app) — deployed from this repository and browser-verified on July 10, 2026.

## Concept

Traditional portraits hold appearance at one moment. Pattern of One instead uses real-time computation, a participant-specific baseline, and persistent motif memory to make rhythm and change visible. Its creative direction is a near-dark digital gallery in which one restrained, luminous organism wakes as a seed, gathers traces, and settles into a form that remains alive without becoming figurative.

## Live experience flow

The application is one immersive route with a finite sequence of states:

| Stage | What happens |
| --- | --- |
| Attract | A seeded Canvas 2D organism moves before any sensor permission is requested. Pointer or touch provides a subtle response. |
| Consent | The participant chooses camera plus microphone, movement only, or a deterministic demo. |
| Calibration | A 4.2-second visual calibration starts the selected input and establishes the first personal baseline. |
| Guided session | Three 27-second prompts explore presence, memory, and gesture. The artwork reacts without showing raw metrics. |
| Final formation | For about 4.8 seconds, recent behavior and persistent motifs are reconciled into a stable-but-living form. |
| Reveal | A deterministic title, three evidence-based observations, session timeline, replay, PNG export, and new-session controls appear. |
| Compare | Two locally available portraits are shown with equal weight and a descriptive, non-ranking comparison. |
| Reset | Media and sound resources stop, the portrait dissolves, and requested local records are cleared. |

The standard guided portion lasts 81 seconds, excluding calibration and final formation. **Finish portrait** can end it early.

## How it works

All input modes use the same typed signal-to-art pipeline:

~~~text
camera / microphone / deterministic demo
                  |
                  v
          sanitized raw signals
                  |
                  v
       adaptive personal baselines
                  |
                  v
       normalized change + events
                  |
                  v
          persistent motif memory
                  |
                  v
        artistic parameter mapping
           /        |         \
          v         v          v
   Canvas 2D    soundscape   session record
                                 |
                                 v
                    replay / compare / PNG
~~~

The current mapping combines raw features into a smaller visual vocabulary: energy, expansion, rhythm, continuity, symmetry, volatility, density, memory, silence, and illumination. A movement or pause matters relative to the participant's own evolving mean and variance, rather than a universal personality-like threshold.

### Live input

- **Camera:** MediaPipe Pose Landmarker data can contribute movement, wrist motion, reach, head displacement, shoulder angle, symmetry, proximity, stillness, and sudden change. Up to two poses are checked so the interface can warn when another person enters; the first tracked participant drives the portrait.
- **Camera fallback:** if MediaPipe cannot load or infer reliably, a local 32 × 24 luminance-difference grid supplies coarse pixel-motion features.
- **Microphone:** the Web Audio API derives smoothed loudness, speech activity, silence duration, envelope variation, onset/rhythm density, and conservative spectral variation.
- **Transcription:** browser speech transcription is not used. The core artwork, title, and observations do not depend on words or an external language service.

Camera features are sampled independently from rendering. The current controller emits features at up to 16 Hz and attempts pose inference at up to 9 Hz; the canvas renders through <code>requestAnimationFrame</code>.

### Portrait renderer and sound

The living form is rendered entirely with **Canvas 2D**, seeded randomness, pooled particle/trail structures, persistent filaments, pulse rings, and silence-shaped negative space. WebGL and Three.js are not used.

Rendering quality can be set to **Auto**, **High**, **Balanced**, or **Low** in **About this work**. Auto starts from viewport and hardware concurrency, then steps down when measured frame rate falls. Device pixel ratio and particle counts are capped, compact screens use the lower tier, and hidden tabs pause rendering work.

The optional soundscape is synthesized with Web Audio after a user gesture. It starts off, has no copyrighted audio asset, and carries no information that is missing from the visual interface.

## Architecture

| Area | Implementation |
| --- | --- |
| Experience controller | <code>src/components/Experience.tsx</code> owns the stage machine, timers, input selection, fallback notices, reveal actions, and query controls. |
| Live media | <code>src/lib/media.ts</code> owns permission requests, camera/microphone streams, MediaPipe loading, pixel motion, audio analysis, visibility handling, and cleanup. |
| Baseline and memory | <code>src/lib/baseline.ts</code> normalizes within-session change; <code>src/lib/memory.ts</code> detects events and accumulates persistent motifs. |
| Mapping | <code>src/lib/mapping.ts</code> turns normalized signals and memory into renderer-independent artistic parameters. |
| Deterministic demos | <code>src/lib/demoProfiles.ts</code> generates measured and kinetic signal sequences and routes them through the normal session engine. |
| Session and interpretation | <code>src/lib/session.ts</code> records compact derived frames and provides replay/storage/cleanup helpers; <code>src/lib/interpretation.ts</code> selects traceable titles and observations. |
| Visual engine | <code>src/components/PortraitCanvas.tsx</code> owns the seeded Canvas 2D simulation, quality tiers, pointer response, reduced motion, and PNG composition. |
| Sound | <code>src/lib/soundscape.ts</code> owns the optional generated Web Audio layer. |
| Interface | Semantic React components provide consent, information, timeline, comparison, and query-gated diagnostics around the canvas. |

See [docs/architecture.md](docs/architecture.md) for the detailed implementation contract and [docs/design-research.md](docs/design-research.md) for the reference study and deliberate creative constraints.

## Technology

- Next.js 16 App Router
- React 19
- strict TypeScript
- Canvas 2D
- MediaPipe Tasks Vision, loaded only after camera consent
- Web Audio API
- CSS custom properties and responsive CSS
- Manrope Variable and Newsreader Variable, bundled through Fontsource
- Vitest and Testing Library
- Playwright

There is no application backend, API route, database, account system, analytics service, or required environment secret.

## Local setup

### Requirements

- Node.js 20.9 or newer
- npm
- A modern browser; current Chromium is the primary live-media and automated-test target
- Optional camera and microphone for the live path

### Start the application

~~~bash
npm ci
npm run dev
~~~

Open [http://localhost:3000](http://localhost:3000).

No <code>.env</code> file is required. <code>.env.example</code> documents the intentional absence of application secrets. Localhost is accepted by browsers as a secure context for media capture; non-local deployments must use HTTPS.

## Commands

| Command | Purpose |
| --- | --- |
| <code>npm run dev</code> | Start the Next.js development server. |
| <code>npm run lint</code> | Run ESLint across the repository. |
| <code>npm run typecheck</code> | Run strict TypeScript checking without emitting files. |
| <code>npm test</code> | Run the Vitest suite once. |
| <code>npm run test:watch</code> | Run Vitest in watch mode. |
| <code>npm run test:e2e</code> | Run Playwright against a managed local dev server or <code>PLAYWRIGHT_BASE_URL</code>. |
| <code>npm run build</code> | Create the production Next.js build. |
| <code>npm start</code> | Serve an existing production build. |

## Demo mode

Demo mode is not a recording or alternate renderer. Synthetic signals enter the same baseline, memory, mapping, interpretation, replay, comparison, and export pipeline as live input.

From the consent screen, choose:

- **Measured:** low movement, longer pauses, and gradual changes.
- **Kinetic:** frequent gestures, faster rhythm, and high variation.
- **Contrasting pair:** generates measured and kinetic sessions with the normal pipeline, then opens comparison.

The root route also accepts exact, deterministic demo query parameters:

~~~text
http://localhost:3000/?demo=measured
http://localhost:3000/?demo=kinetic
http://localhost:3000/?demo=contrast
~~~

<code>?demo=measured</code> and <code>?demo=kinetic</code> begin calibration automatically with a fixed seed. <code>?demo=contrast</code> creates two complete 90-second synthetic records immediately, runs final formation, and opens comparison. These routes request neither camera nor microphone.

### Diagnostics and QA controls

Add <code>?debug=1</code> to mount the query-gated diagnostics panel:

~~~text
http://localhost:3000/?debug=1
http://localhost:3000/?demo=kinetic&debug=1
~~~

The panel provides:

- the current stage selector;
- **Measured** and **Kinetic** profile buttons;
- measured frames per second;
- camera, microphone, and pose status;
- current energy, expansion, rhythm, memory, and silence values.

When debug is enabled, <code>speed</code> accelerates calibration, session, and formation timing and is clamped from 1× to 24×:

~~~text
http://localhost:3000/?demo=measured&debug=1&speed=12
~~~

The visual-QA shortcut <code>?preview=STATE</code> accepts <code>attract</code>, <code>consent</code>, <code>calibration</code>, <code>session</code>, <code>forming</code>, <code>reveal</code>, <code>compare</code>, or <code>resetting</code>. Reveal/forming and compare previews create deterministic sample records; calibration/session previews are static state inspections and do not start sensors or their normal timers. Diagnostics are absent from the normal route unless <code>?debug=1</code> is supplied.

## Permissions

No media permission is requested on initial load or when **Begin your portrait** is selected. A request occurs only after the participant selects an input mode.

| Choice | Camera | Microphone | Network model assets |
| --- | --- | --- | --- |
| Enable camera and microphone | Requested | Requested | MediaPipe is attempted after camera access |
| Movement only | Requested | Not requested | MediaPipe is attempted after camera access |
| Demo mode | Not requested | Not requested | Not needed |

The optional generated sound output uses an <code>AudioContext</code> after the sound control is activated; it does not add another device permission.

If a device is denied or unavailable, the interface offers demo mode and can continue with whatever signals remain. Finishing a portrait, resetting, changing to demo mode, or unmounting the experience stops active tracks and releases analysis resources.

## Privacy and local data

- Raw video and raw audio are neither uploaded nor saved.
- Camera analysis runs in this tab using landmarks or a transient downsampled luminance grid.
- Microphone analysis runs in this tab using a Web Audio analyser.
- MediaPipe's WASM and pose model are optional static files fetched from jsDelivr and Google-hosted model storage. Participant media is not part of those requests.
- No facial recognition, identity matching, emotion detection, protected-trait inference, personality scoring, or mental-health analysis is performed.
- No speech recognition or transcription is currently started, and no transcript is stored.
- No backend receives signals, session records, exports, or telemetry.

To support replay and comparison, the browser may retain at most two compact **derived** records in <code>localStorage</code> under <code>pattern-of-one:sessions:v1</code>. Each contains a seed, selected input mode/profile, accent, up to 360 normalized parameter frames, motifs, title, observations, duration, and final artistic parameters. It contains no raw camera frame, audio sample, or transcript.

**Create another** keeps the prior derived record so a second portrait can be compared. **Clear session** or **Clear both** removes the stored records and returns the work to its seed. PNG export is composed locally and downloaded directly by the browser.

## Browser support and graceful degradation

Current Chromium on desktop or mobile is the primary target and the configured automated browser matrix. Firefox and Safari are not in that automated matrix; the Canvas/demo path should use standards-based APIs, but live permissions, autoplay policy, MediaPipe WASM, and download behavior can vary and require manual verification.

| Condition | Behavior |
| --- | --- |
| MediaPipe, its CDN, or the model is unavailable | Camera input falls back to local pixel-motion analysis. |
| Camera is denied or absent | Sound can still contribute when available; the interface offers deterministic demo mode. |
| Microphone is denied or absent | The portrait continues from movement. |
| No body, multiple bodies, or very low light | Calm guidance asks the participant to reposition, simplify the frame, or add light; available signals continue. |
| Camera and microphone are unavailable | The participant can switch to demo; continuing without signals produces only neutral evolution. |
| Browser speech APIs are absent | No change: transcription is not used. |
| WebGL is absent | No change: rendering uses Canvas 2D. |
| Canvas 2D is absent | The surrounding interface remains, but the artwork and PNG export cannot function; Canvas 2D is a hard requirement. |
| Media APIs are used on an insecure remote origin | Live capture will normally be blocked; use HTTPS or localhost. |
| Low measured frame rate or a compact device | Auto quality reduces particle count, compositing, and pixel ratio. |
| <code>prefers-reduced-motion</code> is enabled | Canvas velocity and interface transitions are reduced while gradual living change remains. |
| The tab is hidden | Camera sampling and canvas rendering are paused or reduced until visible. |
| <code>localStorage</code> is blocked | A current portrait still completes, but cross-session retention and normal two-session comparison may be unavailable. |
| PNG creation/download is blocked | The reveal and local session remain available and an actionable export message is shown. |

## Replay, export, and comparison

- **Replay** advances through recorded normalized frames on a deterministic clock and returns to the final parameters.
- **Export PNG** produces an 1800 × 1200 composition with the portrait, generated title, Pattern of One wordmark, and artistic-interpretation disclaimer.
- **Create another** retains one prior derived record.
- **Compare two** appears when two records are available and presents equal canvases, timelines, one observation per portrait, and a non-ranking difference summary.
- The contrast demo is the quickest reliable route for a judging comparison.

There is no cloud gallery, share URL, server-rendered export, WebM export, or remote sync.

## Testing

The Vitest suite covers personal baselines and variance safeguards, mapping, event and motif memory, deterministic randomness, demo profiles, interpretation, session replay/compaction/storage helpers, media failure classification, movement-only permissions, and cleanup.

<code>e2e/experience.spec.ts</code> covers the pre-permission attract/consent path, an accelerated measured session through reveal, contrasting-pair comparison, mocked movement-only media, denied-media recovery, the information/quality dialog, replay/create-another/clear behavior, reduced motion, PNG download, and control reachability without horizontal overflow at 390 × 844.

Run the release checks from the repository root:

~~~bash
npm run lint
npm run typecheck
npm test
npm run build
~~~

Install Playwright's Chromium runtime once, then run the browser suite:

~~~bash
npx playwright install chromium
npm run test:e2e
~~~

Playwright starts <code>npm run dev</code> automatically for local runs and defines desktop Chromium plus Pixel 5 projects. To test a deployed preview in PowerShell:

~~~powershell
$env:PLAYWRIGHT_BASE_URL="https://your-preview-url"
npm run test:e2e
~~~

Automated mocks are useful for navigation and denial states, but they do not replace manual camera/microphone checks on the actual presentation machine. Before a live demo, verify full media, movement only, both deterministic profiles, contrast, sound, replay, PNG export, clear/reset, reduced motion, and track shutdown.

## Deploying on Vercel

This is a standard Next.js application. The recommended deployment path is:

1. Push the repository to GitHub.
2. Import the repository into Vercel.
3. Set the project root to this repository directory if it is part of a larger workspace.
4. Keep the detected framework as **Next.js**, use the checked-in lockfile, and use Node.js 20 or newer.
5. Do not add environment variables for the current application; none are required.
6. Deploy a preview, run the verification commands and browser checks against its HTTPS URL, then promote that verified deployment to production.

For a manual CLI deployment with an installed, authenticated Vercel CLI:

~~~bash
vercel
vercel --prod
~~~

For controlled CI, build and test before <code>vercel deploy --prebuilt</code>, pin the Vercel CLI version, and keep <code>VERCEL_TOKEN</code>, <code>VERCEL_ORG_ID</code>, and <code>VERCEL_PROJECT_ID</code> in CI secrets rather than the repository. Those values are deployment credentials, not runtime application configuration.

After deployment, verify:

- the root route and all three <code>?demo=...</code> routes;
- camera and microphone prompts on the HTTPS origin;
- MediaPipe success and forced pixel fallback;
- movement-only and permission-denial recovery;
- replay, comparison, PNG export, and stored-record clearing;
- reduced motion, mobile layout, console errors, and stopped device indicators after reset.

The primary production alias is [patternofone.vercel.app](https://patternofone.vercel.app). Deterministic judging routes can be opened by adding <code>?demo=measured</code>, <code>?demo=kinetic</code>, or <code>?demo=contrast</code> to that URL.

## Project structure

~~~text
app/
  globals.css              visual tokens, layout, responsive and reduced-motion rules
  layout.tsx               metadata, viewport, and bundled fonts
  page.tsx                 single immersive route
src/
  components/
    Experience.tsx         state machine and end-to-end experience controller
    PortraitCanvas.tsx     Canvas 2D renderer and PNG composition
    InformationPanel.tsx   premise, privacy, limitations, and quality setting
    DebugPanel.tsx         query-gated diagnostics and QA controls
    SessionTimeline.tsx    derived session history
    ComparisonView.tsx     equal two-portrait comparison
  lib/
    baseline.ts            adaptive means, variance, and normalized change
    demoProfiles.ts        deterministic measured and kinetic input
    interpretation.ts      title and evidence-backed observations
    mapping.ts             normalized signals to artistic parameters
    media.ts               permissions, pose/pixel motion, and audio features
    memory.ts              event detection and persistent motifs
    random.ts              seeded randomness
    session.ts             recording, replay, local storage, and cleanup
    soundscape.ts          generated Web Audio layer
    types.ts               shared contracts
tests/                     Vitest unit and browser-API tests
e2e/                       Playwright experience and viewport tests
docs/
  architecture.md          detailed system and privacy contract
  design-research.md       reference observations and creative synthesis
artifacts/screenshots/     non-production visual-QA evidence
~~~

## Known limitations

- Optional MediaPipe WASM and model files are fetched over the network after consent. When unavailable, pixel motion keeps the camera path alive but cannot provide wrist, posture, reach, or symmetry detail.
- Pose analysis follows the first participant, warns when a second body is visible, and remains sensitive to lighting, occlusion, framing, and camera position.
- Browser speech transcription is not implemented, so repeated-word and phrase-derived motifs are not part of the current portrait.
- The audio analysis estimates activity and variation; it is not speech understanding, emotion recognition, or studio-grade pitch tracking.
- Canvas 2D is required. There is no second non-canvas renderer.
- Only two compact derived sessions are retained, in the current browser. There is no account, cloud backup, cross-device transfer, hosted gallery, or shareable seed UI.
- PNG is the only export format. Video and sound export are not implemented.
- The automated browser matrix is Chromium-based; Firefox and Safari need manual media/export verification.
- Hardware permissions cannot be fully represented by synthetic browser mocks. A real-device smoke test remains part of release preparation.

## License

This repository is licensed under the terms in [LICENSE](LICENSE).
