import type { Metadata } from "next";
import Link from "next/link";
import { Space_Grotesk, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Space Grotesk carries the display/headings — engineered letterforms that give
// the product a measured, technical voice without reading as a generic
// geometric sans. IBM Plex Sans handles body/UI prose, and IBM Plex Mono stays
// for code and data readings; the two Plex faces cohere as one family.
const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
});
const sans = IBM_Plex_Sans({
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
    <html lang="en" className={`${display.variable} ${sans.variable} ${plexMono.variable}`}>
      <body className="min-h-screen font-sans">
        <header className="border-b border-[color:var(--rule)]">
          <div className="mx-auto flex max-w-[1180px] items-center justify-between px-6 py-4">
            <Link href="/" className="font-display text-[19px] font-semibold tracking-tight text-[color:var(--ink)]">
              Groundwork
            </Link>
            <nav className="flex items-center gap-6 text-[length:var(--text-body)]">
              <Link href="/" className="text-[color:var(--slate)] transition-colors hover:text-[color:var(--ink)]">
                Library
              </Link>
              <Link
                href="/#top"
                className="rounded-lg bg-[color:var(--ink)] px-4 py-2 text-[length:var(--text-body)] font-medium text-[color:var(--paper)] transition-colors hover:bg-black"
              >
                Find a guide
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
