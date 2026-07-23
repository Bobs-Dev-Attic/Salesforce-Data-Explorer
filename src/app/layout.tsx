import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { isAuthenticated } from "@/lib/session";
import GlobalProgress from "@/components/GlobalProgress";
import ConnectionSwitcher from "@/components/ConnectionSwitcher";
import AppMenu from "@/components/AppMenu";
import pkg from "../../package.json";

// Apply the persisted theme before paint to avoid a flash of the wrong theme.
const themeInit = `(function(){try{var t=localStorage.getItem('sfde.theme')||'dark';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

const appVersion = pkg.version;

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
    <html lang="en" data-theme="dark">
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <GlobalProgress />
        <header className="topbar">
          <Link href="/" className="brand">
            ⚡ Salesforce Data Explorer
            <span className="version">v{appVersion}</span>
          </Link>
          {authed && (
            <nav className="nav">
              <ConnectionSwitcher />
              <Link href="/">Home</Link>
              <Link href="/explorer">Explorer</Link>
              <Link href="/query">SOQL</Link>
              <Link href="/objects">Objects</Link>
              <Link href="/schema">Schema</Link>
              <Link href="/bulk">Bulk</Link>
              <AppMenu />
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
