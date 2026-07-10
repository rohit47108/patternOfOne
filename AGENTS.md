# Pattern of One contributor guide

Pattern of One is a browser-based interactive artwork: a temporary, abstract portrait shaped by how one participant moves, speaks, pauses, and changes. It is not an identity, emotion, personality, or health-analysis product. Every implementation decision should reinforce that distinction.

## Audit baseline

At project kickoff, the committed `main` branch contained only `LICENSE`; there was no application route to run. The existing Vercel alias, `https://pattern-of-you.vercel.app`, returned `DEPLOYMENT_NOT_FOUND` even though a separate deployment record had reached `READY`. Treat that as the starting deployment/alias gap, not as proof that the finished application works.

## Repository structure

- `app/`: the single Next.js App Router experience, global metadata, and visual tokens.
- `src/components/`: semantic React interface, stage composition, controls, and project information.
- `src/lib/`: typed state-machine, signal, baseline, mapping, memory, rendering, sound, session, export, and cleanup logic.
- `tests/`: Vitest setup and unit/component coverage.
- `e2e/`: Playwright user-flow, resilience, accessibility, and viewport checks.
- `docs/`: research record and architectural contract.
- `artifacts/screenshots/`: non-production visual-QA evidence only.

Keep browser-only implementation under these boundaries. Do not introduce API routes, server actions, a database, authentication, cloud persistence, or telemetry unless the product brief is explicitly changed.

## Commands

Run from the repository root:

```bash
npm install
npm run dev
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
npm start
```

Use `npm ci` in CI once a lockfile exists. Do not report a command as passing unless it was run in the current checkout.

## Engineering conventions

- Keep TypeScript strict. Prefer small typed modules and pure functions for normalization, event detection, mapping, title selection, observations, and serialization.
- Route every stage change through the experience state machine. Do not scatter stage booleans across components.
- Keep per-frame data outside React state. The render loop owns mutable canvas state; React receives only low-frequency snapshots needed by the interface.
- Use Canvas 2D as the required renderer. It must produce the complete artwork without WebGL.
- Use deterministic seeded randomness. A recorded or synthetic signal sequence plus the same seed must reproduce the same portrait.
- Demo profiles must enter the same normalization, mapping, memory, rendering, reveal, replay, and export pipeline as live signals.
- Lazy-load MediaPipe after consent. Pose landmarks are optional enhancement; a local pixel-motion fallback and first-class demo path keep the experience functional.
- Use Web Audio only after a user gesture. Sound is additive and the visual experience must remain complete while muted.
- Allocate particle, filament, and transient-effect storage outside animation loops; reuse buffers and cap retained frames.
- Centralize tunable constants. Do not spread unexplained timing, threshold, color, or quality values through components.
- Clean up animation frames, timers, event listeners, media tracks, audio nodes/context, pose workers, and object URLs on exit, reset, and unmount.
- Keep dependencies minimal. Do not add a second animation, state-management, rendering, or audio library for overlapping work.

## Privacy and ethical constraints

- Ask for camera and microphone access only after an explicit action and explain each request first.
- Process video landmarks, pixel motion, and audio features in the browser. Never upload, persist, or log raw video or audio.
- Never perform face recognition, identity matching, emotion detection, protected-trait inference, personality scoring, or mental-health analysis.
- Transcription is optional. The core flow cannot depend on it, and raw transcripts must not be saved; retain only minimal derived tokens when used.
- Movement-only and deterministic demo modes are required. Permission denial must offer a useful continuation, never a dead end.
- Reset must stop media tracks and erase current session data, derived language data, visual memory, and temporary local state.
- Public observations must be evidence-based comparisons within this session. Always describe the result as an artistic interpretation.

## Visual and content constraints

- The canvas is the dominant plane: near-dark gallery space, warm bone type, one controlled session accent, restrained glow, and mostly unboxed controls.
- Begin with an uncertain seed; grow a synthetic organism through immediate response, short-term behavior, and persistent session memory.
- Prefer editorial scale, alignment, typography, contrast, and negative space over cards, borders, badges, or dashboard layouts.
- Reject literal bodies, faces, avatars, brains, galaxies, generic music visualizers, purple AI gradients, glassmorphism, decorative particle noise, and copied reference artwork.
- A supplied concept image with a face-like particle silhouette is a negative reference. Preserve its sense of luminosity only; do not preserve the face.
- Keep public copy sparse, calm, and non-diagnostic. Never claim that the work knows who someone is or what they feel.
- Motion must communicate awakening, sensing, memory, formation, reveal, or reset. Avoid animation that merely decorates controls.

## Accessibility, resilience, and performance

- Use semantic headings and buttons, visible focus, logical focus transfer, screen-reader names, sufficient contrast, and touch-sized controls.
- Support keyboard-only operation, non-audio status, mute, reduced motion, movement-only input, and no-camera demo mode.
- Reduced motion should slow and simplify the living portrait, not replace it with a static or blank view.
- Design explicitly for 1440x900, 1280x720, 1024x768, 768x1024, 390x844, and 360x800. Account for dynamic mobile bars with `svh`-based sizing.
- Cap device pixel ratio, separate sensor inference frequency from rendering, pause or reduce work when hidden, and expose high/balanced/low quality tiers.
- Handle denied/unavailable media, no participant, multiple participants, low light, noise, pose-load failure, unsupported speech, and export failure with calm next actions.

## Verification rules

- Run lint, strict type checking, Vitest, the production build, and Playwright before handoff.
- Unit-test smoothing, variance safeguards, normalization, event detection, motif accumulation, seeded determinism, title and observation rules, demo playback, serialization, and cleanup.
- Exercise attract, consent, every input mode, permission denial, calibration, prompt progression, early exit, formation, reveal, replay, export, second portrait, comparison, and reset.
- Inspect every state at all required desktop/mobile viewports. Save final evidence under `artifacts/screenshots/` and check overflow, focus, contrast, canvas sizing, console errors, hydration warnings, and obvious frame-rate collapse.
- Verify that two contrasting profiles create visibly different portraits and that replay reproduces the recorded result.
- Verify media indicators turn off after exit/reset and no raw media or transcript is persisted.

## Definition of done

The work is done only when the full single-route journey is coherent and verified: attract, informed consent, 3-5 second calibration, three-prompt guided session, final formation, reveal, deterministic replay, PNG export, second session, equal comparison, and complete reset. Full-media, movement-only, denied-permission, and deterministic demo paths must all complete. The artwork must react, retain earlier motifs, and yield traceable titles/observations without diagnosis. Keyboard, reduced-motion, mobile, adaptive-quality, privacy, cleanup, automated tests, production build, deployment, screenshots, and accurate documentation must all pass. No core behavior may remain a TODO.
