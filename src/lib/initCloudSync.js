// Cloud sync removed for security — this is a no-op.
// Kept as a module so `import "@/lib/initCloudSync"` in page.js doesn't break.

export async function ensureCloudSyncInitialized() {
  return true;
}

export default ensureCloudSyncInitialized;
