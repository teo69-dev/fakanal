import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Recipe images are external https URLs, so img-src allows https. Scripts and styles are Next's own (inline bootstrap
// scripts need 'unsafe-inline'); in development React needs 'unsafe-eval', so the strict policy is production only.
const csp = [
  "default-src 'self'",
  "img-src 'self' https: data:",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          // no includeSubDomains: the site lives on a *.vercel.app name that is not ours to pin
          ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default config;
