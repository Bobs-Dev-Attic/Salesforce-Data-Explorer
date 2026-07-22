import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { isAuthenticated } from "@/lib/session";

export const metadata: Metadata = {
  title: "Salesforce Data Explorer",
  description:
    "Connect to Salesforce, run SOQL, explore objects, export and import data.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authed = isAuthenticated();
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            ⚡ Salesforce Data Explorer
          </Link>
          {authed && (
            <nav className="nav">
              <Link href="/">Home</Link>
              <Link href="/query">SOQL</Link>
              <Link href="/objects">Objects</Link>
              <Link href="/bulk">Bulk</Link>
              <Link href="/connections">Connections</Link>
              <form action="/api/app-auth/logout" method="post" className="inline">
                <button type="submit" className="linkbtn">
                  Lock
                </button>
              </form>
            </nav>
          )}
        </header>
        <main className="container">{children}</main>
        <footer className="footer">
          Salesforce Data Explorer — data stays in your Supabase &amp; Salesforce.
        </footer>
      </body>
    </html>
  );
}
