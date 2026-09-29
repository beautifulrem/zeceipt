"use client";

// Copy a receipt link or an id (review F round 1: every explorer in the research has one). Rendered only once the
// page's script runs, so a reader without JavaScript never sees a button that cannot work.
import { useState, useSyncExternalStore } from "react";
import { Check, Copy } from "lucide-react";

const noSubscribe = () => () => {};

export function CopyButton({ value, label }: { value: string; label: string }) {
  // False in the server render and before hydration; true in a browser with the Clipboard API.
  const ready = useSyncExternalStore(noSubscribe, () => Boolean(navigator.clipboard), () => false);
  const [copied, setCopied] = useState<"no" | "yes" | "failed">("no");
  if (!ready) return null;
  return (
    <>
    <button
      type="button"
      className="copy-btn"
      aria-label={copied === "yes" ? "Copied" : copied === "failed" ? "Copy failed: select the text instead" : label}
      data-copied={copied === "yes" ? "" : undefined}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied("yes");
        } catch {
          setCopied("failed");
        }
        setTimeout(() => setCopied("no"), 1600);
      }}
    >
      {copied === "yes" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </button>
    {/* A label change on a focused button is not reliably read out; this live region is (review F round 2). */}
    <span role="status" className="sr-only">
      {copied === "yes" ? "Copied" : copied === "failed" ? "Copy failed" : ""}
    </span>
    </>
  );
}
