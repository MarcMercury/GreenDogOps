import type { NextConfig } from "next";

// Public, unauthenticated capture pages that a partner site may embed in an
// iframe. Everything else (the signed-in app) refuses to be framed.
const FRAMEABLE_PUBLIC_PATHS = "apply|q/|lead/|book/|forms/|ce/signup";

const SECURITY_HEADERS = [
  // HTTPS only, for two years, including subdomains of the serving host.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), payment=(), usb=(), geolocation=(self)",
  },
  // Locks down the dangerous CSP directives without restricting where scripts,
  // styles, images or API calls load from (Supabase, Google Maps, etc.).
  {
    key: "Content-Security-Policy",
    value: "base-uri 'self'; object-src 'none'; upgrade-insecure-requests",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // Policy/resource uploads accept files up to 25 MB (see
      // src/app/(app)/resources/policies/actions.ts). The default Server
      // Action body limit is 1 MB, which rejected larger documents before the
      // action could run, surfacing as an error page.
      bodySizeLimit: "25mb",
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      {
        // Clickjacking protection for every route except the public forms.
        source: `/((?!${FRAMEABLE_PUBLIC_PATHS}).*)`,
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Content-Security-Policy",
            value:
              "base-uri 'self'; object-src 'none'; upgrade-insecure-requests; frame-ancestors 'none'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
