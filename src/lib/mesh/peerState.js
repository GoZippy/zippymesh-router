/**
 * Peer State Table — CRDT last-write-wins store for mesh peer heartbeats.
 *
 * SQLite table: peers(nodeId, endpoint, lastSeen, payload JSON)
 * CRDT rule: each nodeId entry is replaced when a newer heartbeat arrives.
 * Expiry: peers not seen for PEER_EXPIRY_MS (90s) are excluded from queries.
 *
 * Also listens on UDP port 20129 for heartbeat packets from LAN peers
 * (same socket as P2P discovery — both types are handled here).
 *
 * Exposes: upsertPeer, getActivePeers, expirePeers, startPeerStateListener
 */

import dgram from 'node:dgram';
import { getSqliteDb, getSettings } from '../localDb.js';

const PEER_EXPIRY_MS = 90_000;   // 90 s — peers not seen in 90s are stale
const BEACON_PORT    = 20129;

let _stmts  = null;
let _socket = null;

// ─── SQLite ───────────────────────────────────────────────────────────────────

function ensureTable() {
  const db = getSqliteDb();
  if (!db) return null;

  db.exec(`
    CREATE TABLE IF NOT EXISTS mesh_peers (
      node_id    TEXT PRIMARY KEY,
      endpoint   TEXT,
      last_seen  INTEGER NOT NULL,
      payload    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mesh_peers_last_seen ON mesh_peers(last_seen);
  `);

  return db;
}

function stmts() {
  if (_stmts) return _stmts;
  const db = ensureTable();
  if (!db) return null;

  _stmts = {
    upsert: db.prepare(`
      INSERT INTO mesh_peers (node_id, endpoint, last_seen, payload)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(node_id) DO UPDATE SET
        endpoint  = excluded.endpoint,
        last_seen = excluded.last_seen,
        payload   = excluded.payload
      WHERE excluded.last_seen >= mesh_peers.last_seen
    `),

    getActive: db.prepare(`
      SELECT node_id, endpoint, last_seen, payload
      FROM mesh_peers
      WHERE last_seen >= ?
      ORDER BY last_seen DESC
    `),

    expire: db.prepare(`
      DELETE FROM mesh_peers WHERE last_seen < ?
    `),

    getAll: db.prepare(`
      SELECT node_id, endpoint, last_seen, payload FROM mesh_peers ORDER BY last_seen DESC
    `),
  };

  return _stmts;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Upsert a peer's heartbeat payload.
 * Applies CRDT rule: only updates if the incoming timestamp is >= stored.
 *
 * @param {string} nodeId
 * @param {string} endpoint  — http://host:port
 * @param {number} timestamp — Unix epoch ms from the heartbeat payload
 * @param {object} payload   — full heartbeat payload object
 */
export function upsertPeer(nodeId, endpoint, timestamp, payload) {
  const s = stmts();
  if (!s) return;

  s.upsert.run(nodeId, endpoint, timestamp, JSON.stringify(payload));
}

/**
 * Returns peers seen within the last PEER_EXPIRY_MS milliseconds.
 * @returns {Array<{nodeId, endpoint, lastSeen, payload}>}
 */
export function getActivePeers() {
  const s = stmts();
  if (!s) return [];

  const cutoff = Date.now() - PEER_EXPIRY_MS;
  return s.getActive.all(cutoff).map((r) => ({
    nodeId:   r.node_id,
    endpoint: r.endpoint,
    lastSeen: r.last_seen,
    payload:  JSON.parse(r.payload),
  }));
}

/**
 * Delete peers not seen for PEER_EXPIRY_MS.
 * Called automatically by the listener loop.
 */
export function expirePeers() {
  const s = stmts();
  if (!s) return;
  s.expire.run(Date.now() - PEER_EXPIRY_MS);
}

// ─── UDP listener ─────────────────────────────────────────────────────────────

/**
 * Check whether a peer is allowed under the current meshMode.
 * private  → only peers in the allowlist (or LAN subnet match)
 * cluster  → only peers in the allowlist
 * public   → all peers
 */
async function isPeerAllowed(nodeId, endpoint) {
  let settings;
  try { settings = await getSettings(); } catch { return true; }

  const mode      = settings?.meshMode || 'private';
  const allowlist = settings?.meshAllowlist || [];

  if (mode === 'public') return true;

  if (allowlist.length > 0) {
    return allowlist.some(
      (e) => e.nodeId === nodeId || e.endpoint === endpoint
    );
  }

  // In 'private' mode with no explicit allowlist: accept LAN peers only
  // (anything reachable on a private RFC-1918 range)
  if (mode === 'private' && endpoint) {
    const ip = endpoint.replace(/^https?:\/\//, '').split(':')[0];
    return (
      ip.startsWith('10.')     ||
      ip.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
      ip === '127.0.0.1'
    );
  }

  return false;
}

/**
 * Handle an incoming UDP packet — either a legacy discovery beacon
 * (type: 'zippymesh-node') or a new heartbeat (type: 'zippymesh-heartbeat').
 */
async function handlePacket(data, rinfo) {
  try {
    const msg = JSON.parse(data.toString());

    if (msg.type === 'zippymesh-heartbeat' && msg.nodeId) {
      const nodeId   = msg.nodeId;
      const endpoint = msg.endpoint || `http://${rinfo.address}:20128`;

      if (await isPeerAllowed(nodeId, endpoint)) {
        upsertPeer(nodeId, endpoint, msg.timestamp || Date.now(), msg);
      }
    }
    // Legacy 'zippymesh-node' beacons are handled by p2pDiscovery.js — ignore here
  } catch {
    // Malformed packet — silently ignore
  }
}

/**
 * Start the UDP listener for peer heartbeats.
 * Safe to call multiple times — idempotent.
 *
 * Note: p2pDiscovery.js also binds to port 20129.  On Linux, two UDP
 * sockets with SO_REUSEADDR/reuseAddr:true on the same port both receive
 * broadcast packets.  If binding fails (e.g. already bound exclusively),
 * peer state just won't be updated from UDP — HTTP polling still works.
 */
export function startPeerStateListener() {
  if (_socket) return;

  _socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  _socket.on('message', (data, rinfo) => {
    handlePacket(data, rinfo).catch(() => {});
  });

  _socket.on('error', (err) => {
    console.warn('[peerState] UDP listener error:', err.message);
    _socket = null;
  });

  _socket.bind(BEACON_PORT, () => {
    try { _socket.setBroadcast(true); } catch {}
    console.info('[peerState] Listening for peer heartbeats on UDP port', BEACON_PORT);
  });

  // Expire stale peers every 60s
  setInterval(expirePeers, 60_000);
}

/**
 * Stop the listener (for clean shutdown).
 */
export function stopPeerStateListener() {
  if (_socket) {
    _socket.close();
    _socket = null;
  }
}

export default { upsertPeer, getActivePeers, expirePeers, startPeerStateListener, stopPeerStateListener };
