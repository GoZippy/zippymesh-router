/**
 * Trust score for mesh peers. Fetches from sidecar or ServiceRegistry (when configured).
 */

import { fetchSidecarWithTimeout } from "./sidecar.js";

/**
 * Default trust score for peers without explicit trust data.
 * Set to neutral (50) so peers without history don't get extreme treatment.
 */
const DEFAULT_TRUST_SCORE = 50;

/**
 * Get trust score for a peer.
 * @param {string} peerId - Peer/node ID
 * @returns {Promise<number>} Trust score 0-100 (returns default if unavailable)
 */
export async function getTrustScore(peerId) {
  if (!peerId) return DEFAULT_TRUST_SCORE;

  try {
    const res = await fetchSidecarWithTimeout("/trust", 3000);

    if (!res.ok) return DEFAULT_TRUST_SCORE;

    const data = await res.json();
    const nodeId = data.node_id || "";

    // If this is the local node, return its actual trust score
    if (nodeId && peerId === nodeId) {
      return data.trust_score ?? 100;
    }

    // For remote peers: try to get per-peer trust data from sidecar
    // This is a temporary implementation until ServiceRegistry integration
    try {
        const peerRes = await fetchSidecarWithTimeout(`/trust/${peerId}`, 3000);
        if (peerRes.ok) {
            const peerData = await peerRes.json();
            return peerData.trust_score ?? DEFAULT_TRUST_SCORE;
        }
    } catch {
        // Ignore errors and fall back to default
    }

    // Fall back to default trust score
    return DEFAULT_TRUST_SCORE;
  } catch {
    // On error, return default to avoid blocking peers due to transient issues
    return DEFAULT_TRUST_SCORE;
  }
}

/**
 * Check if a peer meets the minimum trust threshold.
 * @param {string} peerId - Peer/node ID
 * @param {number} minTrustScore - Minimum required trust score (0-100)
 * @returns {Promise<boolean>}
 */
export async function meetsTrustThreshold(peerId, minTrustScore) {
  if (!minTrustScore || minTrustScore <= 0) return true;
  const trustScore = await getTrustScore(peerId);
  return trustScore >= minTrustScore;
}
