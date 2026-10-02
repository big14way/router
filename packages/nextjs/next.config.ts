import { config as dotenv } from "dotenv";
import type { NextConfig } from "next";
import path from "path";

// The template keeps one .env at the repo root (generated from template.json); load it for the app too.
dotenv({ path: path.join(__dirname, "../../.env") });

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../.."),
  reactStrictMode: true,
  // The router SDK is consumed from source (workspace), so Next transpiles it.
  transpilePackages: ["@sh/router-sdk"],
  serverExternalPackages: ["@hiero-ledger/sdk"],
  devIndicators: false,
  typescript: {
    ignoreBuildErrors: process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR === "true",
  },
  eslint: {
    ignoreDuringBuilds: process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR === "true",
  },
  webpack: (config, { dev }) => {
    config.resolve.fallback = { fs: false, net: false, tls: false };
    // One viem for the app and the workspace SDK (yarn keeps per-workspace node_modules).
    config.resolve.alias = { ...config.resolve.alias, viem: path.resolve(__dirname, "node_modules/viem") };
    config.externals.push("pino-pretty", "lokijs", "encoding");
    if (dev) {
      config.watchOptions = {
        followSymlinks: true,
      };
      config.snapshot = { ...(config.snapshot as object), managedPaths: [] };
    }
    return config;
  },
};

module.exports = nextConfig;
