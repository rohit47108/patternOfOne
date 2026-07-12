# Pattern of One

An interactive, browser-based portrait shaped by movement, sound, pauses, and change.

[Open the project](https://patternofone.vercel.app)

## About

Pattern of One is a small experiment in making a portrait without using appearance as the subject. During a short session, a canvas form responds to movement and sound, then settles into an abstract record of that one encounter.

It is an artwork, not an analysis tool. It does not use face recognition or try to infer identity, emotion, personality, or health.

## Try it

Choose the input that feels comfortable:

- **Camera + microphone** for the full interaction.
- **Movement only** if you would rather not use audio.
- **Demo mode** to see the same experience without granting permissions.

A session takes about 20 seconds: a brief calibration, three prompts, and a final formation. You can leave or start again at any point.

## Built with

- Next.js, React, and TypeScript
- Canvas 2D for the portrait
- Web Audio for the optional local soundscape
- MediaPipe Pose Landmarker, with a local motion fallback

## Run locally

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

Useful checks:

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

## Privacy

Camera and microphone access are requested only after you choose a mode. The project processes those signals in the browser and does not upload or save raw video or audio. Resetting a session stops the media tracks and clears the current session data.

## A few notes

- The camera response depends on lighting and browser permission support.
- The microphone is optional; the visual experience still works with movement or demo mode.
- Rendering quality can be adjusted from the project information panel when a device needs a lighter setting.

For implementation notes, see [the architecture overview](docs/architecture.md). The visual references behind the project are collected in [design notes](docs/design-research.md).
