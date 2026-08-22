/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: { root: import.meta.dirname },
  ...(process.env.BUILD_DIST ? { distDir: process.env.BUILD_DIST } : {}),
  // Reached over the LAN by IP when run on the same host as litellm/career-ops.
  allowedDevOrigins: ["192.168.0.121", "linux-claw", "linux-claw.local"],
};

export default nextConfig;
