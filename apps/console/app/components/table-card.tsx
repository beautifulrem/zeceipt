"use client";

import { useEffect, useRef, type ReactNode } from "react";

// A data table's card (slice F4). When a table is wider than its card (a phone), the card scrolls sideways: it is a
// named, focusable region so keyboard users can scroll it, and edge shadows (globals.css .table-card) show that
// there is more (review F round 3). The server renders it focusable, so it works without JavaScript; once the script
// runs, a card that does not scroll stops being a Tab stop, a landmark and a named element (review F rounds 4 and 5).
export function TableCard({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      const scrolls = el.scrollWidth > el.clientWidth + 1;
      // The name goes with the role: a plain div may not carry aria-label (ARIA 1.2; axe aria-prohibited-attr). The
      // table inside keeps its own <caption> either way (review F round 5).
      if (scrolls) {
        el.setAttribute("tabindex", "0");
        el.setAttribute("role", "region");
        el.setAttribute("aria-label", label);
      } else {
        el.removeAttribute("tabindex");
        el.removeAttribute("role");
        el.removeAttribute("aria-label");
      }
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [label]);
  return (
    // tabIndex 0: a scrollable region must be reachable by keyboard (WCAG 2.1.1; axe's scrollable-region-focusable).
    <div ref={ref} role="region" aria-label={label} data-label={label} tabIndex={0} className={`table-card ${className}`}>
      {children}
    </div>
  );
}
