# Architecture overview

Pattern of One is one Next.js route with a client-side interaction loop. The aim is to keep the media path local and the visual system understandable.

```text
chosen input → signal cleanup → short-term memory → visual mapping → Canvas 2D portrait
                                      └────────────→ optional local sound
```

## Session flow

The experience moves through a few clear stages: introduction, input choice, brief calibration, three prompts, formation, and reveal. A normal session is about 20 seconds long. The user can cancel, reset, or start another portrait at any time.

Camera + microphone, movement-only, and demo mode all enter the same signal and rendering pipeline. That keeps the demo honest and makes permission denial a useful fallback rather than a dead end.

## Input and privacy

Camera and microphone access only start after a user chooses a mode. Camera motion and microphone levels are processed in the browser. Raw video and audio are not uploaded or stored.

Pose landmarks are an optional enhancement. If they are unavailable, the project can fall back to coarse local motion. The app does not use face recognition, identity matching, emotion detection, or personality/health inference.

## Rendering

The portrait is drawn with Canvas 2D. A session seed and recorded derived frames let the project replay a finished session without keeping raw media. The renderer uses smooth points, trails, and persistent motifs rather than a literal body or face.

Rendering quality is adjustable. Auto mode can lower detail when frames are consistently slow and recover it when the browser has room again. The canvas loop owns its mutable drawing state so React is not asked to update every frame.

## Cleanup

Exit, reset, and unmount share the same cleanup path: stop media tracks, release audio nodes, cancel timers and animation frames, and clear temporary session data. This is especially important on mobile, where a lingering track is visible to the user.

## Useful places to start

- `src/components/Experience.tsx` — session UI and controls
- `src/components/PortraitCanvas.tsx` — Canvas 2D lifecycle
- `src/lib/media.ts` — browser media setup and cleanup
- `src/lib/soundscape.ts` — optional local audio
- `src/lib/mapping.ts` and `src/lib/memory.ts` — turning derived signals into portrait behavior
