"use client";

import { useEffect, useRef, type ReactNode } from "react";

// A data table's card (slice F4). When a table is wider than its card (a phone), the card scrolls sideways: it is a
// named, focusable region so keyboard users can scroll it, and edge shadows (globals.css .table-card) show that
// there is more (review F round 3). The server renders it focusable, so it works without JavaScript; once the script
// runs, a card that does not scroll stops being a Tab stop and a landmark (review F round 4).
export function TableCard({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      const scrolls = el.scrollWidth > el.clientWidth + 1;
      if (scrolls) {
        el.setAttribute("tabindex", "0");
        el.setAttribute("role", "region");
      } else {
        el.removeAttribute("tabindex");
        el.removeAttribute("role");
      }
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    // tabIndex 0: a scrollable region must be reachable by keyboard (WCAG 2.1.1; axe's scrollable-region-focusable).
    <div ref={ref} role="region" aria-label={label} tabIndex={0} className={`table-card ${className}`}>
      {children}
    </div>
  );
}
