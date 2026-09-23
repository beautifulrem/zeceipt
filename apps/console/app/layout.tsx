import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata = { title: "Zeceipt payout console" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-white text-slate-900 antialiased">
        <header className="border-b border-slate-200">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
            <Link href="/" className="text-lg font-semibold">
              Zeceipt payout console
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
