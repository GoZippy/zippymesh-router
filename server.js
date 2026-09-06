/**
 * Repo-root `server.js` — the DEV / SOURCE-TREE entry point.
 *
 * THIS IS NOT WHAT A RELEASE SHIPS. A release ships
 * `.next/standalone/server.js`, which `next build` regenerates from Next's own
 * template on every build and which `scripts/prepare-standalone.cjs` then
 * patches (loopback-first bind, port 20128, `.env` loading, bootstrap secrets).
 * Nothing regenerates THIS file; it is checked in and hand-maintained.
 *
 * It is not dead code, and it must not be deleted or replaced with a shim:
 *   - `scripts/run-with-bootstrap.js` (shipped as `run.js`) imports it;
 *   - `scripts/e2e/run-standalone.mjs` prefers `run.js` -> this file.
 * (An install-audit note recommending deletion on the grounds that "nothing
 * runs it" was wrong — adversarial review 2026-08-30, item 11.)
 *
 * The `nextConfig` literal below is a snapshot serialized by a `next build` on
 * some past machine. Its two absolute path fields — `outputFileTracingRoot` and
 * `turbopack.root` — used to carry that machine's home directory, a foreign
 * absolute path baked into a repo that publishes an open-core tree. They now
 * compute `process.cwd()`, matching what `next.config.mjs` does at build time.
 * Everything else in the literal is left byte-identical, as is the hand-patched
 * bind logic above it. `npm run secrets:check` now scans the repo root, so a
 * path like that cannot land here again without failing a PR.
 */
performance.mark('next-start');
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import module from 'node:module'
import {
  resolveBindHost,
  isDangerousExposure,
  dangerousExposureWarning,
} from './src/lib/net/bindHost.js'
const require = module.createRequire(import.meta.url)
const __dirname = fileURLToPath(new URL('.', import.meta.url))


const dir = path.join(__dirname)

process.env.NODE_ENV = 'production'
process.chdir(__dirname)

const currentPort = parseInt(process.env.PORT, 10) || 3000

// Secure-by-default bind host. resolveBindHost honors ZIPPY_BIND_HOST, then
// HOST, then defaults to loopback (127.0.0.1). HOSTNAME is still honored for
// backwards compatibility, but only when neither of the above is set.
const hostname = resolveBindHost({
  ZIPPY_BIND_HOST: process.env.ZIPPY_BIND_HOST,
  HOST: process.env.HOST ?? process.env.HOSTNAME,
})

// Best-effort: warn loudly if the node is reachable off-box (non-loopback)
// while login is disabled (requireLogin === false => open/superadmin mode).
// We read the settings file directly (read-only, no app imports) and SKIP the
// check silently if it is not readily available — never a false alarm.
function readRequireLoginBestEffort() {
  try {
    const candidates = []
    if (process.env.DATA_DIR) candidates.push(path.join(process.env.DATA_DIR, 'db.json'))
    candidates.push(path.join(__dirname, 'data', 'db.json'))
    if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, 'zippy-mesh', 'db.json'))
    for (const file of candidates) {
      if (!fs.existsSync(file)) continue
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      const rl = parsed?.settings?.requireLogin
      if (typeof rl === 'boolean') return rl
    }
  } catch {
    // ignore — settings not readily available; skip the warning
  }
  return undefined
}

const requireLogin = readRequireLoginBestEffort()
if (isDangerousExposure(hostname, requireLogin)) {
  console.warn(dangerousExposureWarning(hostname))
}

let keepAliveTimeout = parseInt(process.env.KEEP_ALIVE_TIMEOUT, 10)
const nextConfig = {"env":{},"typescript":{"ignoreBuildErrors":true},"typedRoutes":false,"distDir":"./.next","cleanDistDir":true,"assetPrefix":"","cacheMaxMemorySize":52428800,"configOrigin":"next.config.mjs","useFileSystemPublicRoutes":true,"generateEtags":true,"pageExtensions":["tsx","ts","jsx","js"],"poweredByHeader":true,"compress":true,"images":{"deviceSizes":[640,750,828,1080,1200,1920,2048,3840],"imageSizes":[32,48,64,96,128,256,384],"path":"/_next/image","loader":"default","loaderFile":"","domains":[],"disableStaticImages":false,"minimumCacheTTL":14400,"formats":["image/webp"],"maximumRedirects":3,"maximumResponseBody":50000000,"dangerouslyAllowLocalIP":false,"dangerouslyAllowSVG":false,"contentSecurityPolicy":"script-src 'none'; frame-src 'none'; sandbox;","contentDispositionType":"attachment","localPatterns":[{"pathname":"**","search":""}],"remotePatterns":[],"qualities":[75],"unoptimized":true},"devIndicators":{"position":"bottom-left"},"onDemandEntries":{"maxInactiveAge":60000,"pagesBufferLength":5},"basePath":"","sassOptions":{},"trailingSlash":false,"i18n":null,"productionBrowserSourceMaps":false,"excludeDefaultMomentLocales":true,"reactProductionProfiling":false,"reactStrictMode":null,"reactMaxHeadersLength":6000,"httpAgentOptions":{"keepAlive":true},"logging":{},"compiler":{},"expireTime":31536000,"staticPageGenerationTimeout":60,"output":"standalone","modularizeImports":{"@mui/icons-material":{"transform":"@mui/icons-material/{{member}}"},"lodash":{"transform":"lodash/{{member}}"}},"outputFileTracingRoot":process.cwd(),"cacheComponents":false,"cacheLife":{"default":{"stale":300,"revalidate":900,"expire":4294967294},"seconds":{"stale":30,"revalidate":1,"expire":60},"minutes":{"stale":300,"revalidate":60,"expire":3600},"hours":{"stale":300,"revalidate":3600,"expire":86400},"days":{"stale":300,"revalidate":86400,"expire":604800},"weeks":{"stale":300,"revalidate":604800,"expire":2592000},"max":{"stale":300,"revalidate":2592000,"expire":31536000}},"cacheHandlers":{},"experimental":{"useSkewCookie":false,"cssChunking":true,"multiZoneDraftMode":false,"appNavFailHandling":false,"prerenderEarlyExit":true,"serverMinification":true,"linkNoTouchStart":false,"caseSensitiveRoutes":false,"dynamicOnHover":false,"preloadEntriesOnStart":true,"clientRouterFilter":true,"clientRouterFilterRedirects":false,"fetchCacheKeyPrefix":"","proxyPrefetch":"flexible","optimisticClientCache":true,"manualClientBasePath":false,"cpus":5,"memoryBasedWorkersCount":false,"imgOptConcurrency":null,"imgOptTimeoutInSeconds":7,"imgOptMaxInputPixels":268402689,"imgOptSequentialRead":null,"imgOptSkipMetadata":null,"isrFlushToDisk":true,"workerThreads":false,"optimizeCss":false,"nextScriptWorkers":false,"scrollRestoration":false,"externalDir":false,"disableOptimizedLoading":false,"gzipSize":true,"craCompat":false,"esmExternals":true,"fullySpecified":false,"swcTraceProfiling":false,"forceSwcTransforms":false,"largePageDataBytes":128000,"typedEnv":false,"parallelServerCompiles":false,"parallelServerBuildTraces":false,"ppr":false,"authInterrupts":false,"webpackMemoryOptimizations":false,"optimizeServerReact":true,"viewTransition":false,"removeUncaughtErrorAndRejectionListeners":false,"validateRSCRequestHeaders":false,"staleTimes":{"dynamic":0,"static":300},"reactDebugChannel":false,"serverComponentsHmrCache":true,"staticGenerationMaxConcurrency":8,"staticGenerationMinPagesPerWorker":25,"transitionIndicator":false,"inlineCss":false,"useCache":false,"globalNotFound":false,"browserDebugInfoInTerminal":false,"lockDistDir":true,"isolatedDevBuild":true,"proxyClientMaxBodySize":10485760,"hideLogsAfterAbort":false,"mcpServer":true,"turbopackFileSystemCacheForDev":true,"turbopackFileSystemCacheForBuild":false,"turbopackInferModuleSideEffects":false,"optimizePackageImports":["lucide-react","date-fns","lodash-es","ramda","antd","react-bootstrap","ahooks","@ant-design/icons","@headlessui/react","@headlessui-float/react","@heroicons/react/20/solid","@heroicons/react/24/solid","@heroicons/react/24/outline","@visx/visx","@tremor/react","rxjs","@mui/material","@mui/icons-material","recharts","react-use","effect","@effect/schema","@effect/platform","@effect/platform-node","@effect/platform-browser","@effect/platform-bun","@effect/sql","@effect/sql-mssql","@effect/sql-mysql2","@effect/sql-pg","@effect/sql-sqlite-node","@effect/sql-sqlite-bun","@effect/sql-sqlite-wasm","@effect/sql-sqlite-react-native","@effect/rpc","@effect/rpc-http","@effect/typeclass","@effect/experimental","@effect/opentelemetry","@material-ui/core","@material-ui/icons","@tabler/icons-react","mui-core","react-icons/ai","react-icons/bi","react-icons/bs","react-icons/cg","react-icons/ci","react-icons/di","react-icons/fa","react-icons/fa6","react-icons/fc","react-icons/fi","react-icons/gi","react-icons/go","react-icons/gr","react-icons/hi","react-icons/hi2","react-icons/im","react-icons/io","react-icons/io5","react-icons/lia","react-icons/lib","react-icons/lu","react-icons/md","react-icons/pi","react-icons/ri","react-icons/rx","react-icons/si","react-icons/sl","react-icons/tb","react-icons/tfi","react-icons/ti","react-icons/vsc","react-icons/wi"],"trustHostHeader":false,"isExperimentalCompile":false},"htmlLimitedBots":"[\\w-]+-Google|Google-[\\w-]+|Chrome-Lighthouse|Slurp|DuckDuckBot|baiduspider|yandex|sogou|bitlybot|tumblr|vkShare|quora link preview|redditbot|ia_archiver|Bingbot|BingPreview|applebot|facebookexternalhit|facebookcatalog|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|SkypeUriPreview|Yeti|googleweblight","bundlePagesRouterDependencies":false,"configFileName":"next.config.mjs","serverExternalPackages":["better-sqlite3"],"outputFileTracingExcludes":{"*":["**/*/AppData/**","**/AppData/**","**/.config/**","**/AOMEI*/**","**/Roaming/AOMEI*/**"]},"turbopack":{"root":process.cwd()},"distDirRoot":".next","_originalRewrites":{"beforeFiles":[],"afterFiles":[{"source":"/v1/v1/:path*","destination":"/api/v1/:path*"},{"source":"/v1/v1","destination":"/api/v1"},{"source":"/codex/:path*","destination":"/api/v1/responses"},{"source":"/v1/:path*","destination":"/api/v1/:path*"},{"source":"/v1","destination":"/api/v1"}],"fallback":[]}}

process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig)

require('next')
const { startServer } = require('next/dist/server/lib/start-server')

if (
  Number.isNaN(keepAliveTimeout) ||
  !Number.isFinite(keepAliveTimeout) ||
  keepAliveTimeout < 0
) {
  keepAliveTimeout = undefined
}

startServer({
  dir,
  isDev: false,
  config: nextConfig,
  hostname,
  port: currentPort,
  allowRetry: false,
  keepAliveTimeout,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});