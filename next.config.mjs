/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.IS_TAURI ? 'export' : 'standalone',
  images: {
    unoptimized: true
  },
  outputFileTracingExcludes: {
    '*': [
      '**/*/AppData/**',
      '**/AppData/**',
      '**/.config/**'
    ],
  },
  outputFileTracingRoot: process.cwd(),
  webpack: (config, { isServer }) => {
    // Ignore fs/path modules in browser bundle
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }
    return config;
  },
  async rewrites() {
    return [
      {
        source: "/v1/v1/:path*",
        destination: "/api/v1/:path*"
      },
      {
        source: "/v1/v1",
        destination: "/api/v1"
      },
      {
        source: "/codex/:path*",
        destination: "/api/v1/responses"
      },
      {
        source: "/v1/:path*",
        destination: "/api/v1/:path*"
      },
      {
        source: "/v1",
        destination: "/api/v1"
      }
    ];
  }
};

export default nextConfig;
