/**
 * Mesh Heartbeat — schema definition and 30-second broadcaster.
 *
 * Payload schema (v1):
 *   nodeId      string   — stable UUID for this node
 *   version     string   — ZMLR software version
 *   endpoint    string   — http://host:port base URL peers can use
 *   timestamp   number   — Unix epoch ms
 *   models      Array    — models this node is currently serving
 *     { provider, modelId, degraded, avgLatencyMs, ttftColdMs, ttftHotMs }
 *   metrics     Object   — aggregate stats since last heartbeat
 *     { requestsTotal, errorsTotal, uptimeSec }
 *
 * Transport: UDP broadcast on port 20129 (same as discovery beacon),
 * plus an in-process last-heartbeat cache for the HTTP endpoint.
 *
 * Receiving side (peerState.js) reads this payload and stores it in
 * the peers SQLite table.
 */

import dgram from 'node:dgram';
import os from 'node:os';
import { getNodeIdentity, getProviderNodes } from '../localDb.js';
import { getModelHealthSummary } from '../modelHealth.js';

const HEARTBEAT_PORT     = 20129;
const HEARTBEAT_INTERVAL = 30_000;   // 30 s
const VERSION = process.env.npm_package_version || '1.1.0';

// Rolling counters reset on each interval
let _requestsTotal = 0;
let _errorsTotal   = 0;
const _startedAt   = Date.now();

// Last built heartbeat (cached for HTTP endpoint)
let _lastHeartbeat = null;

// UDP socket (shared with send)
let _socket = null;

/**
 * Increment request counter — called from orchestrator on success.
 */
export function heartbeatCountRequest() {
  _requestsTotal++;
}

/**
 * Increment error counter — called from orchestrator on failure.
 */
export function heartbeatCountError() {
  _errorsTotal++;
}

/**
 * Return the last-built heartbeat payload (for HTTP endpoint).
 * Returns null if the heartbeat hasn't run yet.
 */
export function getLastHeartbeat() {
  return _lastHeartbeat;
}

/**
 * Detect the best LAN IP to advertise as our endpoint.
 */
function getLanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

/**
 * Build the heartbeat payload.
 */
async function buildHeartbeat() {
  const identity = await getNodeIdentity().catch(() => ({ id: 'unknown' }));
  const nodes = await getProviderNodes({ type: 'local' }).catch(() => []);
  const health = getModelHealthSummary();

  const models = health.map((m) => ({
    provider:     m.provider,
    modelId:      m.modelId,
    degraded:     m.degraded,
    ttftColdMs:   null,   // P1.1 prober will populate these in future passes
    ttftHotMs:    null,
    avgLatencyMs: null,
  }));

  // Also include nodes that have no health data yet (newly configured)
  for (const node of nodes) {
    const provider = node.name || node.id;
    if (!models.some((m) => m.provider === provider)) {
      models.push({
        provider,
        modelId: '*',
        degraded: false,
        ttftColdMs: null,
        ttftHotMs: null,
        avgLatencyMs: null,
      });
    }
  }

  const port = process.env.PORT || 20128;
  const ip   = getLanIp();

  const payload = {
    type:      'zippymesh-heartbeat',
    nodeId:    identity.id || 'unknown',
    version:   VERSION,
    endpoint:  `http://${ip}:${port}`,
    timestamp: Date.now(),
    models,
    metrics: {
      requestsTotal: _requestsTotal,
      errorsTotal:   _errorsTotal,
      uptimeSec:     Math.round((Date.now() - _startedAt) / 1000),
    },
  };

  return payload;
}

/**
 * Broadcast heartbeat over UDP to LAN broadcast address.
 */
function broadcastHeartbeat(payload) {
  if (!_socket) return;

  const msg = Buffer.from(JSON.stringify(payload));
  _socket.send(msg, 0, msg.length, HEARTBEAT_PORT, '255.255.255.255', (err) => {
    if (err) {
      console.warn('[heartbeat] Broadcast error:', err.message);
    }
  });
}

/**
 * Run one heartbeat cycle: build payload, broadcast, cache.
 */
async function runHeartbeat() {
  try {
    const payload = await buildHeartbeat();
    _lastHeartbeat = payload;
    broadcastHeartbeat(payload);
  } catch (err) {
    console.error('[heartbeat] Cycle error:', err.message);
  }
}

let _intervalHandle = null;

/**
 * Start the heartbeat broadcaster.
 * Safe to call multiple times — idempotent.
 */
export function startHeartbeat() {
  if (_intervalHandle) return;

  // Create UDP socket with broadcast enabled
  _socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  _socket.bind(() => {
    try {
      _socket.setBroadcast(true);
    } catch (e) {
      console.warn('[heartbeat] Cannot enable broadcast:', e.message);
    }
  });
  _socket.on('error', (err) => {
    console.error('[heartbeat] Socket error:', err.message);
  });

  // First heartbeat after 5 seconds (let server finish init)
  setTimeout(() => runHeartbeat(), 5_000);

  _intervalHandle = setInterval(runHeartbeat, HEARTBEAT_INTERVAL);
  console.info('[heartbeat] Started — 30s interval, UDP port', HEARTBEAT_PORT);
}

/**
 * Stop the heartbeat broadcaster (clean shutdown).
 */
export function stopHeartbeat() {
  if (_intervalHandle) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
  }
  if (_socket) {
    _socket.close();
    _socket = null;
  }
}

export default { startHeartbeat, stopHeartbeat, getLastHeartbeat, heartbeatCountRequest, heartbeatCountError };
