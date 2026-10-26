/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: { root: import.meta.dirname },
  ...(process.env.BUILD_DIST ? { distDir: process.env.BUILD_DIST } : {}),
  // Reached over the LAN by IP when run on the same host as litellm/career-ops.
  allowedDevOrigins: ["192.168.0.155", "aiserver", "aiserver.local"],
};

export default nextConfig;
