import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.IS_TAURI ? 'export' : 'standalone',
  distDir: process.env.ZIPPY_NEXT_DIST_DIR || '.next',
  serverExternalPackages: ['better-sqlite3'],
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
  typescript: { ignoreBuildErrors: true },
  turbopack: {},
  webpack: (config, { isServer, dev }) => {
    const srcDir = path.join(process.cwd(), 'src');
    // Disable filesystem cache to avoid ResolverCachePlugin + EPERM/readlink .length crash on Windows
    config.cache = false;
    config.resolve.symlinks = false;
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': srcDir,
      'open-sse': path.join(process.cwd(), 'open-sse'),
    };
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
    // WORKAROUND: Windows-specific EPERM handling for restricted directories (AppData, AOMEI)
    // This patches webpack's internal readlink to gracefully handle permission errors.
    // NOTE: We log these errors to help identify if they're expected (AppData/AOMEI) or unexpected.
    // TODO: Revisit when Windows environment permissions are properly configured or upgrade to Node.js that handles this.
    const loggedEpermPaths = new Set(); // Prevent logging the same path repeatedly
    config.plugins.push({
      apply(compiler) {
        compiler.hooks.compilation.tap('ReadlinkEpermGuard', (compilation) => {
          const orig = compilation.inputFileSystem?.readlink;
          if (!orig) return;
          compilation.inputFileSystem.readlink = function (filePath, callback) {
            const pathStr = typeof filePath === 'string' ? filePath : '';
            const skipLink = '';
            orig.call(this, filePath, (err, link) => {
              if (err && (err.code === 'EPERM' || err.syscall === 'readlink')) {
                if (!loggedEpermPaths.has(pathStr) && pathStr.length > 0) {
                  console.warn(`[webpack.ReadlinkEpermGuard] EPERM on path: ${pathStr}`);
                  loggedEpermPaths.add(pathStr);
                }
                return callback(null, skipLink);
              }
              callback(err, link);
            });
          };
        });
      },
    });
    return config;
  },
  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options",          value: "DENY" },
          { key: "X-Content-Type-Options",   value: "nosniff" },
          { key: "X-XSS-Protection",         value: "1; mode=block" },
          { key: "Referrer-Policy",           value: "strict-origin-when-cross-origin" },
          {
            key: "Content-Security-Policy",
            // Allow: self, inline styles (needed by Next.js), eval for dev HMR, known CDNs.
            // Tighten 'unsafe-eval' and 'unsafe-inline' once Tailwind/Next.js build pipeline is
            // configured for nonces or hashed styles (post-launch hardening).
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob: https:",
              "connect-src 'self' wss: ws: https:",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
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
