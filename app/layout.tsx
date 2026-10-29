import type { Metadata } from "next";
import Link from "next/link";
import { Geist, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Clean geometric sans for everything (headings + body), matching the reference.
// IBM Plex Mono stays for code only.
const geist = Geist({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Groundwork — evidence-backed OAuth integration guides",
  description:
    "The shortest viable path from wanting an integration to a working, launch-ready OAuth connection — researched live and backed by evidence.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${plexMono.variable}`}>
      <body className="min-h-screen font-sans">
        <header className="border-b border-[color:var(--rule)]">
          <div className="mx-auto flex max-w-[1180px] items-center justify-between px-6 py-4">
            <Link href="/" className="text-[18px] font-semibold tracking-tight text-[color:var(--ink)]">
              Groundwork
            </Link>
            <nav className="flex items-center gap-6 text-[15px]">
              <Link href="/" className="text-[color:var(--slate)] transition-colors hover:text-[color:var(--ink)]">
                Library
              </Link>
              <Link
                href="/investigate"
                className="rounded-lg bg-[color:var(--ink)] px-4 py-2 text-[14px] font-medium text-[color:var(--paper)] transition-colors hover:bg-black"
              >
                Investigate a provider
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-[1180px] px-6 py-14">{children}</main>
        <footer className="mx-auto max-w-[1180px] border-t border-[color:var(--rule)] px-6 py-10 text-[13px] leading-relaxed text-[color:var(--slate)]">
          Guides are generated from live web research and may contain estimates or unverified
          requirements. Always confirm against the provider&apos;s own documentation before launch.
        </footer>
      </body>
    </html>
  );
}
