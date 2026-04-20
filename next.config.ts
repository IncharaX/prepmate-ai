import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep pdf-parse + pdfjs-dist out of the Turbopack server bundle.
  // pdf-parse loads pdfjs-dist with a worker/fs fallback that expects a real
  // node_modules layout; bundling breaks that resolution.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "@napi-rs/canvas"],
};

export default nextConfig;
