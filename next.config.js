/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // App-auth and Salesforce token exchange happen server-side only.
  poweredByHeader: false,
};

module.exports = nextConfig;
