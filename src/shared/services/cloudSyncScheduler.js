/**
 * Cloud sync scheduler — disabled for security.
 * Exports are preserved as no-ops so existing importers don't break.
 */
export class CloudSyncScheduler {
  constructor() {
    this.intervalId = null;
  }

  async start() {}
  stop() {}
  async sync() { return null; }
  isRunning() { return false; }
}

let cloudSyncScheduler = null;

export async function getCloudSyncScheduler() {
  if (!cloudSyncScheduler) {
    cloudSyncScheduler = new CloudSyncScheduler();
  }
  return cloudSyncScheduler;
}
