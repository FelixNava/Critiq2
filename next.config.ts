import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray parent lockfile makes Next infer the wrong workspace root; pin it to
  // this project so .env.local + output tracing resolve correctly.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
