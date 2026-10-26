// Next sends anonymous usage telemetry unless this is set, and career-ops
// promises none. server.mjs sets it for dev and start; this covers `next build`,
// which npm runs directly and which loads this file before it records anything.
process.env.NEXT_TELEMETRY_DISABLED = "1";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Two lockfiles exist on purpose (repo root + web/), so Next would infer the
  // repo root as the workspace root. On Windows that misinference can send
  // Turbopack's postcss workers into an unbounded respawn loop that exhausts
  // all RAM (vercel/next.js#92978) — pin the root to this app.
  turbopack: { root: import.meta.dirname },
  // Allow a throwaway build dir (e.g. BUILD_DIST=.next-prod) so a production
  // `next build` can run without clobbering a live `next dev` .next.
  ...(process.env.BUILD_DIST ? { distDir: process.env.BUILD_DIST } : {}),
  // `next dev` rejects cross-origin requests by default (Server Actions CSRF
  // protection) -- needed here because the container is reached over the LAN
  // by IP (192.168.0.155:4000), not localhost.
  allowedDevOrigins: ["192.168.0.155", "aiserver", "aiserver.local"],
};

export default nextConfig;
