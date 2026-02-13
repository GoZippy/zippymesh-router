import { cleanupProviderConnections } from "@/lib/localDb";

/**
 * Cloud sync scheduler removed for security.
 * Still runs provider connection cleanup on startup.
 */
export async function initializeCloudSync() {
  try {
    await cleanupProviderConnections();
  } catch (error) {
    console.error("[Init] Error during provider cleanup:", error);
  }
}

export default initializeCloudSync;
