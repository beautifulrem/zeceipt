import Link from "next/link";

// The console's own 404 (slice S4c): Next's built-in one styles itself inline, which the page policy refuses
// (style-src without 'unsafe-inline'), so it would render unstyled and log violations.
export default function NotFound() {
  return (
    <section className="space-y-3">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-slate-700">There is nothing at this address in the console.</p>
      <p>
        <Link href="/" className="text-sky-700 underline">
          Back to batches
        </Link>
      </p>
    </section>
  );
}
