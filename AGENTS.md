# Contributor notes

Pattern of One is a browser-only interactive artwork. Keep the project small, private by default, and easy to run locally.

## Project boundaries

- Keep the experience on the client. Do not add accounts, a database, telemetry, or media uploads without a clear product reason.
- Ask for camera or microphone access only after an explicit user action.
- Never store raw video or audio. The project does not do face recognition, identity matching, emotion detection, or health/personality inference.
- Camera, movement-only, and demo modes should all follow the same session flow. Demo mode is a real fallback, not a separate mock screen.

## Working in the codebase

- `app/` contains the Next.js route and global styling.
- `src/components/` holds the interface and canvas composition.
- `src/lib/` contains the session flow, media helpers, signal mapping, sound, and rendering support.
- `tests/` and `e2e/` cover the main behavior.

Keep per-frame canvas work out of React state. Reuse rendering buffers where possible, clean up media tracks and audio nodes on exit/reset, and make controls work without a pointer or sound.

## Before sharing a change

Run the checks that match the work:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

For interaction changes, also run `npm run test:e2e` and try the camera, movement-only, and demo paths. Check the experience at a narrow mobile width as well as desktop.
