import type { ReactNode } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ShieldCheck } from "lucide-react";
import { ConsoleNav } from "./components/nav.tsx";
import "./globals.css";

export const metadata = { title: "Zeceipt payout console" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Every page renders per request, so each gets its own script nonce (slice S4b; /_not-found was static before).
  await connection();
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="font-sans text-fg antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:shadow-raised">
          Skip to content
        </a>
        <div className="lg:grid lg:min-h-dvh lg:grid-cols-[16rem_1fr]">
          <aside className="no-print sticky top-0 z-10 border-b border-line bg-surface/85 backdrop-blur lg:static lg:border-b-0 lg:border-r">
            <div className="flex flex-col gap-4 px-4 py-3 lg:sticky lg:top-0 lg:h-dvh lg:py-6">
            <div className="flex flex-col gap-3 lg:gap-8">
              <Link href="/" className="flex items-center gap-3 rounded-lg lg:px-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG mark; next/image adds nothing here */}
                <img src="/zeceipt-icon.svg" alt="" width={32} height={32} className="size-8 rounded-lg" />
                <span className="leading-tight">
                  <span className="block text-[0.95rem] font-semibold tracking-tight">Zeceipt payout console</span>
                  <span className="hidden font-mono text-[0.68rem] uppercase tracking-[0.08em] text-muted sm:block">Shielded ZEC payouts</span>
                </span>
              </Link>
              <ConsoleNav />
            </div>
            <div className="mt-auto hidden rounded-lg border border-line bg-surface-2 p-3 text-xs text-muted lg:block">
              <p className="flex items-center gap-2 font-medium text-fg">
                <ShieldCheck aria-hidden="true" className="size-4 text-accent-strong" strokeWidth={1.75} />
                Receipts, not viewing keys
              </p>
              <p className="mt-1 leading-relaxed">Each payment gets a receipt anyone can verify for that one output.</p>
            </div>
            </div>
          </aside>
          <main id="main" className="mx-auto w-full max-w-6xl space-y-6 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
