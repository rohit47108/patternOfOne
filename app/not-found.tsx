import Link from "next/link";

export default function NotFound() {
  return (
    <main className="route-message">
      <p className="eyebrow">Nothing was recorded here</p>
      <h1>This path has returned to darkness.</h1>
      <Link className="primary-action" href="/">Return to Pattern of One</Link>
    </main>
  );
}
