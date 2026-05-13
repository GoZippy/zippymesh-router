// Cloud sync removed for security — all functions are no-op stubs.
// These exports are kept so existing importers don't break.
// Return explicit error objects so callers can distinguish "disabled" from "failed".

export function getCloudUrl() {
  return { success: false, reason: "Cloud sync disabled in this build", code: "CLOUD_DISABLED" };
}

export async function callCloudWithMachineId() {
  return { success: false, reason: "Cloud sync disabled in this build", code: "CLOUD_DISABLED" };
}

export function startProviderSync() {
  return { success: false, reason: "Cloud sync disabled in this build", code: "CLOUD_DISABLED" };
}
