import { cleanupProviderConnections, initLocalProviderConnections } from "@/lib/localDb";

/**
 * Cloud sync scheduler removed for security.
 * Still runs provider connection cleanup and local provider sync on startup.
 */
export async function initializeCloudSync() {
  try {
    await cleanupProviderConnections();
  } catch (error) {
    console.error("[Init] Error during provider cleanup:", error);
  }

  // Sync local provider connections (Ollama, LM Studio) for unified routing
  try {
    const synced = await initLocalProviderConnections();
    if (synced > 0) {
      console.log(`[Init] Synced ${synced} local provider connections`);
    }
  } catch (error) {
    console.error("[Init] Error syncing local providers:", error);
  }
}

export default initializeCloudSync;
