import { startDiscoveryLoop } from "@/sse/services/discovery";
import { initPlugins } from '@/lib/plugins/pluginRegistry.js';
import { seedMarketplace } from '@/lib/marketplaceSeed.js';
import { startConnectionKeepAlive } from '@/lib/connectionKeepAlive.js';
import { maybeAutoRefreshProviderCatalog } from '@/lib/providers/sync.js';

// This API route is called automatically to initialize the local orchestrator and health checks
export async function GET() {
  startDiscoveryLoop();
  initPlugins().catch(e => console.warn('[Plugins] Init failed:', e.message));
  seedMarketplace();
  startConnectionKeepAlive();
  maybeAutoRefreshProviderCatalog();
  return new Response("ZippyMesh Services Initialized", { status: 200 });
}
