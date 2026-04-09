// Community Edition Stub — upgrade to Pro for full functionality
const PRO_ERROR = { error: "This feature requires ZippyMesh Pro", code: "FEATURE_PRO" };

export class P2PDiscoveryService {
  async scan() { return PRO_ERROR; }
  async startBeacon() { return PRO_ERROR; }
  async stopBeacon() { return PRO_ERROR; }
  async discover() { return PRO_ERROR; }
  async connectPeer() { return PRO_ERROR; }
  async getPeers() { return []; }
  async getStatus() { return { running: false, community: true }; }
  async broadcastPresence() { return PRO_ERROR; }
  async shutdown() {}
}

export const p2pDiscovery = new P2PDiscoveryService();
export default p2pDiscovery;
