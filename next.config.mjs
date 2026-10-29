import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  outputFileTracingRoot: __dirname,
  webpack(config) {
    // Ensure the "@/..." alias resolves in every layer (server, client, route
    // handlers). Relying on tsconfig paths alone missed client/route layers.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@": __dirname,
    };
    return config;
  },
};

export default nextConfig;
