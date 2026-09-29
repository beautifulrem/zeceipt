"use client";

// The console's navigation (slice F4). The current section is marked with aria-current, which the server render
// already carries (usePathname runs during SSR), so the highlight needs no JavaScript in the browser.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Layers, ReceiptText, Users } from "lucide-react";

const ITEMS = [
  { href: "/", label: "Batches", icon: Layers, match: (p: string) => p === "/" || p.startsWith("/batches") },
  { href: "/recipients", label: "Recipients", icon: Users, match: (p: string) => p.startsWith("/recipients") },
  { href: "/payables", label: "Payables", icon: ReceiptText, match: (p: string) => p.startsWith("/payables") },
];

export function ConsoleNav() {
  const path = usePathname() ?? "/";
  return (
    <nav aria-label="Console" className="flex gap-1 overflow-x-auto lg:flex-col">
      {ITEMS.map(({ href, label, icon: Icon, match }) => (
        <Link key={href} href={href} className="nav-link" aria-current={match(path) ? "page" : undefined}>
          <Icon aria-hidden="true" strokeWidth={1.75} />
          {label}
        </Link>
      ))}
    </nav>
  );
}
