"use client";

export default function ErrorBoundary({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="route-message">
      <p className="eyebrow">The encounter paused</p>
      <h1>The portrait lost its thread.</h1>
      <p>No camera or microphone media was saved. You can safely begin the encounter again.</p>
      <button className="primary-action" type="button" onClick={reset}>Try again</button>
    </main>
  );
}
