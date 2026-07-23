/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // App-auth and Salesforce token exchange happen server-side only.
  poweredByHeader: false,
  // Static security headers (the nonce-based CSP is set in src/middleware.ts).
  // These apply to every response, including /api and static assets.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
