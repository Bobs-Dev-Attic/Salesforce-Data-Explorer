import { NextRequest, NextResponse } from "next/server";

/**
 * Per-request nonce-based Content-Security-Policy.
 *
 * Next injects its own inline bootstrap scripts, and layout.tsx has an inline
 * theme-init script, so a strict CSP needs a nonce rather than a static host
 * allowlist. We generate a nonce, expose it to the app via the `x-nonce`
 * request header (Next reads the request CSP header to nonce its own scripts,
 * and layout.tsx reads x-nonce for the theme script), and set the CSP on the
 * response. `strict-dynamic` lets the nonced scripts load their chunks.
 *
 * Static, non-nonce headers (X-Frame-Options, nosniff, etc.) live in
 * next.config.js so they also cover /api and static assets.
 */
export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // React inline style props + CSS-variable theming require inline styles.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Apply to page documents; skip API, Next static assets, and the favicon.
    // The `missing` clause avoids running on prefetches so cached HTML keeps a
    // usable nonce.
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
