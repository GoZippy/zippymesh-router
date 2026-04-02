/**
 * No-op stub — imported by ~14 API routes that call syncToCloud() after mutations.
 * Previously sent all provider credentials to the old cloud service. Now does nothing.
 */
export async function syncToCloud(_machineId) {
  return { success: true, message: "Cloud sync disabled" };
}
