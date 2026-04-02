import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiErrors.js";
import {
  getRoutingFilters,
  getRoutingControls,
  getPeerMetadata
} from "@/lib/localDb.js";
import { getTrustScore } from "@/lib/trustScore.js";
import { checkAuth } from "@/lib/auth/middleware.js";

/**
 * Evaluate if a peer passes all active filters
 * @param {Object} peer - Peer object
 * @param {Array} filters - Active routing filters
 * @param {Object} controls - Global routing controls
 * @returns {Object} { allowed: boolean, blockedBy: string|null, reason: string|null }
 */
async function evaluatePeerFilters(peer, filters, controls) {
  const peerId = peer.id || peer.peer_id;
  const metadata = await getPeerMetadata(peerId);
  const trustScore = await getTrustScore(peerId);

  // Check global controls first
  if (controls.minTrustScore !== null && trustScore !== null) {
    if (trustScore < controls.minTrustScore) {
      return {
        allowed: false,
        blockedBy: "global",
        reason: `Trust score ${trustScore} below minimum ${controls.minTrustScore}`
      };
    }
  }

  // Check cost/latency from peer data or metadata
  const peerCost = peer.pricing?.base_price_per_token || peer.cost;
  if (controls.maxCostPer1k !== null && peerCost !== undefined) {
    const costPer1k = peerCost * 1000;
    if (costPer1k > controls.maxCostPer1k) {
      return {
        allowed: false,
        blockedBy: "global",
        reason: `Cost ${costPer1k.toFixed(4)} exceeds max ${controls.maxCostPer1k}`
      };
    }
  }

  const peerLatency = peer.latency || metadata?.avgLatency;
  if (controls.maxLatencyMs !== null && peerLatency !== undefined) {
    if (peerLatency > controls.maxLatencyMs) {
      return {
        allowed: false,
        blockedBy: "global",
        reason: `Latency ${peerLatency}ms exceeds max ${controls.maxLatencyMs}ms`
      };
    }
  }

  // Check country restrictions
  const countryCode = metadata?.countryCode || peer.country;
  if (countryCode) {
    if (controls.allowedCountries?.length > 0) {
      if (!controls.allowedCountries.includes(countryCode)) {
        return {
          allowed: false,
          blockedBy: "global",
          reason: `Country ${countryCode} not in allowed list`
        };
      }
    }
    if (controls.blockedCountries?.length > 0) {
      if (controls.blockedCountries.includes(countryCode)) {
        return {
          allowed: false,
          blockedBy: "global",
          reason: `Country ${countryCode} is blocked`
        };
      };
    }
  }

  // Check IP range restrictions
  const ipAddress = metadata?.ipAddress || peer.ip;
  if (ipAddress && (controls.allowedIpRanges?.length > 0 || controls.blockedIpRanges?.length > 0)) {
    // Simple CIDR matching for blocked ranges
    if (controls.blockedIpRanges?.length > 0) {
      for (const cidr of controls.blockedIpRanges) {
        if (ipInCidr(ipAddress, cidr)) {
          return {
            allowed: false,
            blockedBy: "global",
            reason: `IP ${ipAddress} matches blocked range ${cidr}`
          };
        }
      }
    }

    // If allowed ranges specified, IP must match at least one
    if (controls.allowedIpRanges?.length > 0) {
      let inAllowedRange = false;
      for (const cidr of controls.allowedIpRanges) {
        if (ipInCidr(ipAddress, cidr)) {
          inAllowedRange = true;
          break;
        }
      }
      if (!inAllowedRange) {
        return {
          allowed: false,
          blockedBy: "global",
          reason: `IP ${ipAddress} not in allowed ranges`
        };
      }
    }
  }

  // Evaluate individual filter rules (sorted by priority)
  const sortedFilters = [...filters].sort((a, b) => a.priority - b.priority);

  for (const filter of sortedFilters) {
    const matches = evaluateFilter(peer, filter, { trustScore, countryCode, ipAddress, peerCost, peerLatency });

    if (matches) {
      if (filter.action === "block") {
        return {
          allowed: false,
          blockedBy: filter.id,
          reason: `Blocked by filter: ${filter.name}`
        };
      } else if (filter.action === "allow") {
        // Explicit allow - stop processing further filters
        return { allowed: true, blockedBy: null, reason: null };
      }
    }
  }

  // No filters matched - use default action
  return {
    allowed: controls.defaultAction !== "block",
    blockedBy: controls.defaultAction === "block" ? "default" : null,
    reason: controls.defaultAction === "block" ? "Blocked by default policy" : null
  };
}

/**
 * Evaluate if a peer matches a single filter
 */
function evaluateFilter(peer, filter, context) {
  const { trustScore, countryCode, ipAddress, peerCost, peerLatency } = context;

  let value;
  switch (filter.filter_type) {
    case "trust_score":
      value = trustScore;
      break;
    case "ip_address":
      value = ipAddress;
      break;
    case "country":
      value = countryCode;
      break;
    case "cost":
      value = peerCost !== undefined ? peerCost * 1000 : undefined; // Convert to per-1k
      break;
    case "latency":
      value = peerLatency;
      break;
    default:
      return false;
  }

  if (value === undefined || value === null) {
    return false;
  }

  const filterValue = filter.value;

  switch (filter.operator) {
    case "eq":
      return value === filterValue;
    case "gte":
      return value >= filterValue;
    case "lte":
      return value <= filterValue;
    case "in_range":
      return Array.isArray(filterValue) &&
             filterValue.length === 2 &&
             value >= filterValue[0] &&
             value <= filterValue[1];
    case "in_list":
      return Array.isArray(filterValue) && filterValue.includes(value);
    case "not_in_list":
      return Array.isArray(filterValue) && !filterValue.includes(value);
    default:
      return false;
  }
}

/**
 * Check if an IP address is within a CIDR range
 * Supports IPv4 CIDR notation (e.g., "192.168.1.0/24")
 */
function ipInCidr(ip, cidr) {
  try {
    const [rangeIp, prefix] = cidr.split("/");
    const prefixLength = parseInt(prefix, 10);

    if (!rangeIp || isNaN(prefixLength)) {
      return false;
    }

    const ipParts = ip.split(".").map(Number);
    const rangeParts = rangeIp.split(".").map(Number);

    if (ipParts.length !== 4 || rangeParts.length !== 4) {
      return false;
    }

    // Convert to 32-bit unsigned integers using multiplication to avoid bitwise overflow
    // JavaScript bitwise operators convert to 32-bit SIGNED integers, causing issues
    // for IP addresses where the first octet >= 128 (values > 0x7FFFFFFF)
    const ipInt = (ipParts[0] * 16777216) + (ipParts[1] * 65536) + (ipParts[2] * 256) + ipParts[3];
    const rangeInt = (rangeParts[0] * 16777216) + (rangeParts[1] * 65536) + (rangeParts[2] * 256) + rangeParts[3];

    // Create mask using multiplication to avoid bitwise overflow
    // For /24 prefix: mask = 0xFFFFFFFF << 8 = 0xFFFFFF00
    const mask = Math.pow(2, 32) - Math.pow(2, 32 - prefixLength);

    return (ipInt & mask) === (rangeInt & mask);
  } catch {
    return false;
  }
}

/**
 * POST /api/mesh/peers/filtered
 * Filter a list of peers based on active routing rules
 */
export async function POST(request) {
  try {
    if (!(await checkAuth())) {
      return apiError(request, 401, "Unauthorized");
    }

    const { peers } = await request.json();

    if (!Array.isArray(peers)) {
      return apiError(request, 400, "Request body must include a 'peers' array");
    }

    // Get active filters and controls
    const [filters, controls] = await Promise.all([
      getRoutingFilters(true),
      getRoutingControls()
    ]);

    // Evaluate each peer
    const results = await Promise.all(
      peers.map(async (peer) => {
        const evaluation = await evaluatePeerFilters(peer, filters, controls);
        return {
          peer,
          ...evaluation
        };
      })
    );

    const allowedPeers = results.filter(r => r.allowed).map(r => r.peer);
    const blockedPeers = results.filter(r => !r.allowed).map(r => ({
      peer: r.peer,
      blockedBy: r.blockedBy,
      reason: r.reason
    }));

    return NextResponse.json({
      allowed: allowedPeers,
      blocked: blockedPeers,
      summary: {
        total: peers.length,
        allowed: allowedPeers.length,
        blocked: blockedPeers.length,
        activeFilters: filters.length
      }
    });
  } catch (error) {
    console.error("Failed to filter peers:", error);
    return apiError(request, 500, "Internal Server Error");
  }
}

/**
 * GET /api/mesh/peers/filtered
 * Get filter status for all known peers
 */
export async function GET(request) {
  try {
    if (!(await checkAuth())) {
      return apiError(request, 401, "Unauthorized");
    }

    // Fetch current peers from network status
    const port = process.env.ZIPPY_PORT || 20128;
    const baseUrl = process.env.INTERNAL_API_URL || `http://localhost:${port}`;
    const statusRes = await fetch(`${baseUrl}/api/v1/network/status`, {
      headers: { "Content-Type": "application/json" }
    }).catch(() => null);

    if (!statusRes?.ok) {
      return NextResponse.json(
        { error: "Failed to fetch network status" },
        { status: 503 }
      );
    }

    const status = await statusRes.json();
    const peers = status.peers || [];

    // Get active filters and controls
    const [filters, controls] = await Promise.all([
      getRoutingFilters(true),
      getRoutingControls()
    ]);

    // Evaluate each peer
    const results = await Promise.all(
      peers.map(async (peer) => {
        const evaluation = await evaluatePeerFilters(peer, filters, controls);
        return {
          peerId: peer.id || peer.peer_id,
          ...evaluation
        };
      })
    );

    return NextResponse.json({
      peers: results,
      filters: filters.map(f => ({ id: f.id, name: f.name, action: f.action })),
      controls: {
        defaultAction: controls.defaultAction,
        minTrustScore: controls.minTrustScore,
        maxCostPer1k: controls.maxCostPer1k,
        maxLatencyMs: controls.maxLatencyMs
      }
    });
  } catch (error) {
    console.error("Failed to get filtered peers:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 }
    );
  }
}
