import Link from "next/link";

// The console's own 404 (slice S4c): Next's built-in one styles itself inline, which the page policy refuses
// (style-src without 'unsafe-inline'), so it would render unstyled and log violations.
export default function NotFound() {
  return (
    <section className="card mx-auto max-w-xl space-y-3 py-10 text-center">
      <p className="eyebrow">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-muted">There is nothing at this address in the console.</p>
      <p>
        <Link href="/" className="btn btn-secondary">
          Back to batches
        </Link>
      </p>
    </section>
  );
}
