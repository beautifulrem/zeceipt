"use client";

// The fallback for anything a page did not handle (review E1 round 1). Fixed text only: never the error's
// message or stack, and never a claim about any payment.
export default function ErrorPage() {
  return (
    <section role="alert" className="card space-y-2 border-danger/40 bg-danger-soft">
      <h1 className="section-title">This page could not be shown</h1>
      <p className="text-sm">
        Something went wrong while reading the console&apos;s data. Nothing about any payment can be concluded from this page; reload it,
        and check the batch&apos;s status before acting.
      </p>
    </section>
  );
}
