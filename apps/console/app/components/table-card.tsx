import type { ReactNode } from "react";

// A data table's card (slice F4). When a table is wider than its card (a phone), the card scrolls sideways: it is a
// named, focusable region so keyboard users can scroll it, and edge shadows (globals.css .table-card) show that
// there is more (review F round 3).
export function TableCard({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return (
    // tabIndex 0: a scrollable region must be reachable by keyboard (WCAG 2.1.1; axe's scrollable-region-focusable).
    <div role="region" aria-label={label} tabIndex={0} className={`table-card ${className}`}>
      {children}
    </div>
  );
}
