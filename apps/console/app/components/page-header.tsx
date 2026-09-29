import type { ReactNode } from "react";

// Every page opens the same way (slice F4): where you are, what the page is for, and its actions on the right.
export function PageHeader({ eyebrow, title, description, actions, children }: { eyebrow: string; title: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="animate-rise flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="text-[1.7rem] font-semibold leading-tight tracking-tight text-balance">{title}</h1>
        {description && <p className="max-w-2xl text-sm text-muted text-pretty">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
