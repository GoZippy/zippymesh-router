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
      '**/.config/**',
      '**/AOMEI*/**',
      '**/Roaming/AOMEI*/**',
    ],
  },
  outputFileTracingRoot: process.cwd(),
  webpack: (config, { isServer, dev }) => {
    config.resolve.symlinks = false;
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ['**/node_modules/**', '**/.next/**', '**/AppData/**', '**/AOMEI*/**'],
    };
    config.plugins = config.plugins || [];
    config.plugins.push({
      apply(compiler) {
        compiler.hooks.compilation.tap('ReadlinkEpermGuard', (compilation) => {
          const orig = compilation.inputFileSystem?.readlink;
          if (!orig) return;
          compilation.inputFileSystem.readlink = function (path, callback) {
            if (typeof path === 'string' && (path.includes('AppData') || path.includes('AOMEI'))) {
              return callback(null, null);
            }
            orig.call(this, path, (err, link) => {
              if (err && (err.code === 'EPERM' || err.syscall === 'readlink')) return callback(null, null);
              callback(err, link);
            });
          };
        });
      },
    });
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
