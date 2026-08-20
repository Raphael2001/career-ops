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
  // by IP (192.168.0.121:4000), not localhost.
  allowedDevOrigins: ["192.168.0.121", "linux-claw", "linux-claw.local"],
};

export default nextConfig;
